import asyncio
import logging
import hashlib
import os
import aiofiles
import httpx
from typing import Dict, Optional, Callable, Awaitable
from datetime import datetime
from .models import SocialSession, SocialMessage

# 用于持久化的数据库导入
from database import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from services.memory_service import MemoryService

logger = logging.getLogger(__name__)

class ImageCacheManager:
    """
    简单的本地图片缓存管理器。
    用于下载 OneBot 图片到本地，以便转换为 Base64 发送给 LLM。
    """
    def __init__(self, cache_dir: str = None, max_files: int = 50):
        if cache_dir is None:
            # 动态计算绝对路径: .../backend/nit_core/plugins/social_adapter/session_manager.py -> .../backend/data/social_images
            current_dir = os.path.dirname(os.path.abspath(__file__))
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(current_dir)))
            self.cache_dir = os.path.join(backend_dir, "data", "social_images")
        else:
            self.cache_dir = cache_dir
            
        self.max_files = max_files
        self._ensure_dir()
    
    def _ensure_dir(self):
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)
            
    async def download_image(self, url: str) -> Optional[str]:
        """
        下载图片并返回本地绝对路径。
        如果下载失败，返回 None。
        """
        try:
            # 使用 URL 的 MD5 作为文件名
            url_hash = hashlib.md5(url.encode()).hexdigest()
            # 尝试推断扩展名，默认 jpg
            ext = "jpg"
            if ".png" in url: ext = "png"
            elif ".gif" in url: ext = "gif"
            
            filename = f"{url_hash}.{ext}"
            filepath = os.path.join(self.cache_dir, filename)
            abs_path = os.path.abspath(filepath)
            
            # 如果文件已存在，直接返回
            if os.path.exists(filepath):
                return abs_path
                
            # 下载
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    async with aiofiles.open(filepath, "wb") as f:
                        await f.write(resp.content)
                    
                    # 简单的清理策略：如果文件过多，删除最旧的
                    self._cleanup()
                    return abs_path
                else:
                    logger.warning(f"[ImageCache] Failed to download image {url}: {resp.status_code}")
                    return None
        except Exception as e:
            logger.error(f"[ImageCache] Error downloading image: {e}")
            return None
            
    def _cleanup(self):
        """
        清理旧文件，保持缓存大小在 max_files 以内。
        """
        try:
            files = [os.path.join(self.cache_dir, f) for f in os.listdir(self.cache_dir)]
            if len(files) <= self.max_files:
                return
                
            # 按修改时间排序 (最旧的在前)
            files.sort(key=os.path.getmtime)
            
            # 删除多余的
            num_to_delete = len(files) - self.max_files
            for i in range(num_to_delete):
                try:
                    os.remove(files[i])
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"[ImageCache] Cleanup failed: {e}")

class SocialSessionManager:
    def __init__(self, flush_callback: Callable[[SocialSession], Awaitable[None]]):
        """
        参数：
            flush_callback: 缓冲区刷新时调用的异步函数。
        """
        self.sessions: Dict[str, SocialSession] = {}
        self.flush_callback = flush_callback
        
        # 配置
        self.BUFFER_TIMEOUT = 20  # 秒
        self.BUFFER_MAX_SIZE = 10 # 条消息
        self.ACTIVE_DURATION = 120 # 秒（发言后保持“活跃”的时间）
        
        # 图片缓存管理器
        self.image_manager = ImageCacheManager()

    def get_or_create_session(self, session_id: str, session_type: str, session_name: str = "") -> SocialSession:
        if session_id not in self.sessions:
            self.sessions[session_id] = SocialSession(
                session_id=session_id,
                session_type=session_type,
                session_name=session_name
            )
        return self.sessions[session_id]

    async def _persist_message(self, session: SocialSession, msg: SocialMessage, role: str):
        """
        将消息持久化到独立社交数据库 (QQMessage)。
        """
        try:
            # 局部导入以避免循环导入
            from .database import get_social_db_session
            from .models_db import QQMessage
            import json

            # [Optimization] Use a separate task or quick commit to avoid holding lock
            async for db_session in get_social_db_session():
                try:
                    new_msg = QQMessage(
                        msg_id=msg.msg_id,
                        session_id=session.session_id,
                        session_type=session.session_type,
                        sender_id=msg.sender_id,
                        sender_name=msg.sender_name,
                        content=msg.content,
                        timestamp=msg.timestamp,
                        raw_event_json=json.dumps(msg.raw_event, default=str)
                    )
                    db_session.add(new_msg)
                    await db_session.commit()
                except Exception as inner_e:
                    logger.error(f"DB Insert Error: {inner_e}")
                    await db_session.rollback()
                
        except Exception as e:
            logger.error(f"Failed to persist social message to independent DB: {e}")

    async def persist_outgoing_message(self, session_id: str, session_type: str, content: str, sender_name: str = "Assistant"):
        """
        将发出的消息（Agent 的回复）持久化到独立社交数据库。
        """
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            import uuid
            
            async for db_session in get_social_db_session():
                new_msg = QQMessage(
                    msg_id=str(uuid.uuid4()), # 为内部消息生成 ID
                    session_id=session_id,
                    session_type=session_type,
                    sender_id="self", # 如果已知，则为 Pero 的 ID
                    sender_name=sender_name,
                    content=content,
                    timestamp=datetime.now(),
                    raw_event_json="{}"
                )
                db_session.add(new_msg)
                await db_session.commit()
        except Exception as e:
            logger.error(f"Failed to persist outgoing message: {e}")

    async def persist_system_notification(self, session_id: str, session_type: str, content: str, raw_event: dict = None):
        """
        将系统通知（如撤回、禁言）持久化到独立社交数据库。
        """
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            import uuid
            import json
            
            if raw_event is None:
                raw_event = {}

            async for db_session in get_social_db_session():
                new_msg = QQMessage(
                    msg_id=str(uuid.uuid4()),
                    session_id=session_id,
                    session_type=session_type,
                    sender_id="system",
                    sender_name="System",
                    content=content,
                    timestamp=datetime.now(),
                    raw_event_json=json.dumps(raw_event, default=str)
                )
                db_session.add(new_msg)
                await db_session.commit()
        except Exception as e:
            logger.error(f"Failed to persist system notification: {e}")

    async def get_recent_messages(self, session_id: str, session_type: str, limit: int = 20) -> list[SocialMessage]:
        """
        从独立数据库获取最近的消息作为上下文。
        """
        logger.info(f"[{session_id}] 调用 get_recent_messages。类型: {session_type}, 限制: {limit}")
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            from sqlmodel import select
            
            messages = []
            logger.info(f"[{session_id}] 正在请求数据库会话...")
            
            # [Critical Fix] Use run_in_executor to avoid blocking the event loop with synchronous DB calls
            # Even though db_session.exec is awaitable, the underlying aiosqlite/sqlite driver might be blocking the GIL or thread
            loop = asyncio.get_running_loop()
            
            def run_sync_query():
                 # This function will run in a separate thread
                 # We need a NEW synchronous engine and session here because we are crossing thread boundaries
                 # and async engines are not thread-safe in this manner for sync execution.
                 # BUT, we are inside an async function.
                 
                 # Let's try a different approach: forcing a yield to the event loop before execution
                 pass

            async for db_session in get_social_db_session():
                logger.info(f"[{session_id}] 已获取数据库会话。正在执行查询...")
                
                try:
                    # [Critical Debug] Add a sleep to ensure loop is yielding
                    await asyncio.sleep(0.01)
                    
                    statement = select(QQMessage).where(
                        QQMessage.session_id == session_id,
                        QQMessage.session_type == session_type
                    ).order_by(QQMessage.timestamp.desc()).limit(limit)
                    
                    # [Fix] Wrap execution in a shield or check if it's truly awaited
                    logger.info(f"[{session_id}] 正在等待 db_session.exec...")
                    result = await asyncio.wait_for(db_session.exec(statement), timeout=3.0)
                    logger.info(f"[{session_id}] db_session.exec 返回。正在获取所有结果...")
                    results = result.all()
                    
                    logger.info(f"[{session_id}] 查询返回了 {len(results)} 行。")
                    
                    # 转换回 SocialMessage（或类似的字典）并反转顺序
                    for row in reversed(results):
                         msg = SocialMessage(
                             msg_id=row.msg_id,
                             sender_id=row.sender_id,
                             sender_name=row.sender_name,
                             content=row.content,
                             timestamp=row.timestamp,
                             raw_event={} 
                         )
                         messages.append(msg)
                except asyncio.TimeoutError:
                    logger.error(f"[{session_id}] 数据库查询超时 (3s)！")
                    # Don't raise, just return empty list to let the flow continue
                    # [Fallback] If DB fails, return buffer content? No, caller handles fallback.
                    return []
                except Exception as query_e:
                    logger.error(f"[{session_id}] 查询执行错误: {query_e}")
                    raise query_e
                
            logger.info(f"[{session_id}] get_recent_messages 完成。返回 {len(messages)} 条消息。")
            return messages
            
        except Exception as e:
            logger.error(f"Failed to get recent messages from DB: {e}", exc_info=True)
            return []

    async def get_latest_active_group(self, user_id: str) -> str | None:
        """
        查找指定用户最近活跃的群聊 ID。
        """
        try:
            # 使用同步的 session 上下文管理器
            with self.Session() as db_session:
                # 执行查询
                result = db_session.execute(
                    select(QQMessage.session_id)
                    .where(QQMessage.sender_id == user_id)
                    .where(QQMessage.session_type == "group")
                    .order_by(QQMessage.timestamp.desc())
                    .limit(1)
                ).scalar_one_or_none()
                
                if result:
                    return str(result)
                return None
        except Exception as e:
            logger.error(f"Failed to get latest active group for user {user_id}: {e}")
            return None

    async def handle_message(self, event: dict):
        """
        处理传入消息事件的主要入口点。
        """
        # 1. 解析事件
        try:
            msg_type = event.get("message_type") # group 或 private
            self_id = str(event.get("self_id", ""))
            
            if msg_type == "group":
                session_id = str(event.get("group_id"))
                sender_id = str(event.get("user_id"))
                
                # [Fix] 忽略自己发送的消息，防止活跃状态自递归
                if sender_id == self_id:
                    return

                # 理想情况下从事件或 API 获取群名/发送者名称
                sender_name = event.get("sender", {}).get("nickname", "Unknown")
                # 群名并不总是在消息事件中，可能需要 API 或缓存
                session_name = f"Group {session_id}" 
            elif msg_type == "private":
                session_id = str(event.get("user_id"))
                sender_id = str(event.get("user_id"))
                
                # [Fix] 忽略自己发送的消息
                if sender_id == self_id:
                    return

                sender_name = event.get("sender", {}).get("nickname", "Unknown")
                if sender_name == "Unknown":
                    sender_name = f"User{sender_id}"
                session_name = sender_name
            else:
                return # 忽略其他类型

            content = event.get("raw_message", "")
            msg_id = str(event.get("message_id"))
            
            # 提取图像
            images = []
            image_tasks = []
            
            message_chain = event.get("message", [])
            for segment in message_chain:
                if segment["type"] == "image":
                    url = segment["data"].get("url")
                    if url:
                        # [Multimodal] Start async download
                        # We don't await here to avoid blocking WS loop.
                        # The flush logic will wait for these tasks.
                        task = asyncio.create_task(self.image_manager.download_image(url))
                        image_tasks.append(task)
                        
                        # We can store the URL in images temporarily, 
                        # but it will be replaced by local path when task completes and is processed.
                        # However, SocialMessage.images expects a list of strings.
                        # Let's append the URL for now as a fallback/placeholder.
                        images.append(url) 
            
            # Create Message Object
            msg = SocialMessage(
                msg_id=msg_id,
                sender_id=sender_id,
                sender_name=sender_name,
                content=content,
                timestamp=datetime.now(),
                raw_event=event,
                images=images,
                image_tasks=image_tasks
            )
            
            # Get Session
            session = self.get_or_create_session(session_id, msg_type, session_name)
            
            # [Preemption] 检查并取消正在进行的秘书/主动搭话任务
            if session.active_response_task and not session.active_response_task.done():
                logger.info(f"[{session_id}] 检测到用户新输入，正在打断之前的主动搭话任务...")
                session.active_response_task.cancel()
                session.active_response_task = None
            
            # [Dynamic Scan Cycle] 如果是私聊且有新消息，重置下一次扫描周期为短周期 (2-4分钟)
            if msg_type == "private":
                import random
                from datetime import timedelta
                # 设置为 2-4 分钟后
                next_scan = datetime.now() + timedelta(seconds=random.randint(120, 240))
                session.next_scan_time = next_scan
                logger.info(f"[{session_id}] 私聊活跃，下次主动审视时间重置为: {next_scan.strftime('%H:%M:%S')}")
            
            # [Persistence] Save user message immediately
            await self._persist_message(session, msg, "user")
            
            # 2. Check Triggers (Mention / State)
            is_mentioned = self._check_is_mentioned(content, event)
        
            # [Fix] In Private Chat, always consider as mentioned
            if msg_type == "private":
                is_mentioned = True
            
            # 3. Add to Buffer
            session.add_message(msg)
            
            # 4. Determine Action
            # If already summoned/active, or strictly mentioned -> Immediate Flush?
            # Design says: "Summoned -> Immediate response".
            # "Active" -> "More sensitive", maybe shorter buffer or immediate? 
            # For MVP Phase 1: Mention = Immediate Flush.
            
            # [Refactor] Implement accumulation buffer for Summoned state
            # Private chat: 7s, Group chat: 15s
            if is_mentioned:
                if session.state != "summoned":
                    # First mention: Switch state and start FIXED timer
                    session.state = "summoned"
                    
                    # Determine buffer duration based on session type
                    buffer_duration = 7 if msg_type == "private" else 15
                    
                    logger.info(f"[{session_id}] Summoned by mention ({msg_type})! Starting {buffer_duration}s accumulation timer.")
                    
                    # Cancel any existing inactivity timer
                    if session.flush_timer_task:
                        session.flush_timer_task.cancel()
                    
                    # Start fixed timer
                    # This timer will NOT be reset by subsequent messages because of the state check below
                    session.flush_timer_task = asyncio.create_task(self._timer_callback(session, buffer_duration))
                else:
                    # Already summoned: Do nothing (Accumulate)
                    logger.info(f"[{session_id}] Mentioned again while accumulating. Continuing wait.")

            elif len(session.buffer) >= self.BUFFER_MAX_SIZE:
                logger.info(f"[{session_id}] Buffer full!")
                await self._trigger_flush(session, reason="buffer_full")
            else:
                # Normal message
                if session.state == "summoned":
                    # We are in summoned state (waiting for 15s timer).
                    # Do NOT reset the timer. Just let it accumulate.
                    pass
                else:
                    # Standard observing mode -> Reset inactivity timer (20s)
                    self._reset_flush_timer(session)
                
        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)

    def _check_is_mentioned(self, content: str, event: dict) -> bool:
        # Check OneBot "at" segment
        # raw_message usually contains CQ codes like [CQ:at,qq=123]
        # But simpler is checking 'message' array in OneBot v11
        message_chain = event.get("message", [])
        for segment in message_chain:
            if segment["type"] == "at":
                # Check if it is at ME
                # We need self_id. Usually in event['self_id']
                self_id = str(event.get("self_id"))
                target_id = str(segment["data"].get("qq"))
                if target_id == self_id:
                    return True
        
        # Fallback: Check keywords (nickname)
        # if "pero" in content.lower() or "Pero" in content:
        #    return True
            
        return False

    def _reset_flush_timer(self, session: SocialSession, timeout: int = 20):
        # Cancel existing timer
        if session.flush_timer_task:
            session.flush_timer_task.cancel()
        
        # Create new timer
        session.flush_timer_task = asyncio.create_task(self._timer_callback(session, timeout))

    async def _timer_callback(self, session: SocialSession, timeout: int):
        try:
            await asyncio.sleep(timeout)
            # Timer expired
            # Check reason based on state
            reason = "summon_timeout" if session.state == "summoned" else "buffer_timeout"
            await self._trigger_flush(session, reason=reason)
        except asyncio.CancelledError:
            pass # Timer reset or flushed

    async def _trigger_flush(self, session: SocialSession, reason: str):
        # Cancel timer if running
        if session.flush_timer_task:
            session.flush_timer_task.cancel()
            session.flush_timer_task = None
            
        if not session.buffer:
            return

        logger.info(f"[{session.session_id}] Flushing buffer. Reason: {reason}. Messages: {len(session.buffer)}")
        
        # Call the callback (SocialService logic)
        try:
            await self.flush_callback(session)
        except Exception as e:
            logger.error(f"Error in flush callback: {e}", exc_info=True)
        finally:
            # Always clear buffer after flush to avoid duplicates
            session.clear_buffer()

    def get_active_sessions(self, limit: int = 5, session_type: Optional[str] = None) -> list[SocialSession]:
        """
        获取活跃会话列表（按活跃时间倒序）。
        
        Args:
            limit: 返回数量限制
            session_type: 筛选类型 "group" 或 "private"。None 表示不筛选。
        """
        candidates = self.sessions.values()
        
        if session_type:
            candidates = [s for s in candidates if s.session_type == session_type]
            
        # 按 last_active_time 倒序排序
        sorted_sessions = sorted(
            candidates, 
            key=lambda s: s.last_active_time, 
            reverse=True
        )
        return sorted_sessions[:limit]
            
        # 刷新逻辑后清除缓冲区（还是应该由回调处理？通常管理器处理缓冲区）
        # 但是如果回调失败，我们可能会丢失消息。
        # 设计选择：立即清除以防止双重处理。
        session.clear_buffer()
