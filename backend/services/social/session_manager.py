import asyncio
import logging
from typing import Dict, Optional, Callable, Awaitable
from datetime import datetime
from .models import SocialSession, SocialMessage

# 用于持久化的数据库导入
from database import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from services.memory_service import MemoryService

logger = logging.getLogger(__name__)

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

            async for db_session in get_social_db_session():
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
                
        except Exception as e:
            logger.error(f"Failed to persist social message to independent DB: {e}")

    async def persist_outgoing_message(self, session_id: str, session_type: str, content: str, sender_name: str = "Pero"):
        """
        将发出的消息（Pero 的回复）持久化到独立社交数据库。
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

    async def get_recent_messages(self, session_id: str, session_type: str, limit: int = 20) -> list[SocialMessage]:
        """
        从独立数据库获取最近的消息作为上下文。
        """
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            from sqlmodel import select
            
            messages = []
            async for db_session in get_social_db_session():
                statement = select(QQMessage).where(
                    QQMessage.session_id == session_id,
                    QQMessage.session_type == session_type
                ).order_by(QQMessage.timestamp.desc()).limit(limit)
                
                results = (await db_session.exec(statement)).all()
                
                # 转换回 SocialMessage（或类似的字典）并反转顺序
                for row in reversed(results):
                     # 如果可能的话处理图像？目前数据库存储 raw_event_json，但我们可能不会在这里解析它。
                     # 对于上下文，文本是最重要的。
                     msg = SocialMessage(
                         msg_id=row.msg_id,
                         sender_id=row.sender_id,
                         sender_name=row.sender_name,
                         content=row.content,
                         timestamp=row.timestamp,
                         raw_event={} # 上下文重建不需要
                     )
                     messages.append(msg)
            return messages
            
        except Exception as e:
            logger.error(f"Failed to get recent messages from DB: {e}")
            return []

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
            message_chain = event.get("message", [])
            for segment in message_chain:
                if segment["type"] == "image":
                    url = segment["data"].get("url")
                    if url:
                        images.append(url)
            
            # Create Message Object
            msg = SocialMessage(
                msg_id=msg_id,
                sender_id=sender_id,
                sender_name=sender_name,
                content=content,
                timestamp=datetime.now(),
                raw_event=event,
                images=images
            )
            
            # Get Session
            session = self.get_or_create_session(session_id, msg_type, session_name)
            
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
            
            if is_mentioned:
                session.state = "summoned"
                logger.info(f"[{session_id}] Summoned by mention!")
                await self._trigger_flush(session, reason="summoned")
            elif len(session.buffer) >= self.BUFFER_MAX_SIZE:
                logger.info(f"[{session_id}] Buffer full!")
                await self._trigger_flush(session, reason="buffer_full")
            else:
                # Reset Timer
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
        if "pero" in content.lower() or "Pero" in content:
            return True
            
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

    def get_active_sessions(self, limit: int = 5) -> list[SocialSession]:
        """
        获取活跃会话列表（按活跃时间倒序）。
        """
        # 按 last_active_time 倒序排序
        sorted_sessions = sorted(
            self.sessions.values(), 
            key=lambda s: s.last_active_time, 
            reverse=True
        )
        return sorted_sessions[:limit]
            
        # 刷新逻辑后清除缓冲区（还是应该由回调处理？通常管理器处理缓冲区）
        # 但是如果回调失败，我们可能会丢失消息。
        # 设计选择：立即清除以防止双重处理。
        session.clear_buffer()
