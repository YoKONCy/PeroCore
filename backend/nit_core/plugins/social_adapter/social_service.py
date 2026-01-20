import asyncio
import logging
import json
import random
import uuid
import base64
import os
import aiofiles
from datetime import datetime, time, timedelta
from typing import Optional, Dict, Any, Set
from contextvars import ContextVar
from fastapi import WebSocket, WebSocketDisconnect
from core.config_manager import get_config_manager

# ContextVar for deduplication
injected_msg_ids_var: ContextVar[Set[str]] = ContextVar("injected_msg_ids", default=set())
from .session_manager import SocialSessionManager
from .models import SocialSession

# 数据库和 Agent 导入
from database import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from services.memory_service import MemoryService
from services.mdp.manager import mdp
# from services.agent_service import AgentService (Moved inside method)
# from services.prompt_service import PromptManager (Moved inside method to avoid circular import)

logger = logging.getLogger(__name__)

# 移除硬编码的 SOCIAL_SYSTEM_PROMPT，改用 PromptManager

class SocialService:
    _instance = None
    
    def __init__(self):
        self.config_manager = get_config_manager()
        self.active_ws: Optional[WebSocket] = None
        self.running = False
        self._enabled = self.config_manager.get("enable_social_mode", False)
        self._thought_task: Optional[asyncio.Task] = None
        
        # [Social Identity] Bot 信息缓存
        self.bot_info: Dict[str, Any] = {}
        
        # 初始化会话管理器
        self.session_manager = SocialSessionManager(flush_callback=self.handle_session_flush)
        
        # [修复] 初始化 pending_requests，防止同步 API 调用崩溃
        self.pending_requests: Dict[str, asyncio.Future] = {}
        
        # 初始化状态机变量
        # [Refactor] 移除全局状态，改为基于 Session 的状态
        # self.last_active_time = datetime.now()
        # self.social_state = "DIVE"
        
    @property
    def enabled(self):
        return self.config_manager.get("enable_social_mode", False)

    async def start(self):
        if not self.enabled:
            logger.info("社交模式已禁用。")
            return

        # 初始化社交专用数据库
        try:
            from .database import init_social_db
            await init_social_db()
            logger.info("[Social] 独立社交数据库已初始化。")
        except Exception as e:
            logger.error(f"[Social] 初始化社交数据库失败: {e}")
        
        # [动态注册工具] 注册 notify_master 为 Agent 可用的工具
        try:
            from core.plugin_manager import plugin_manager
            
            # 定义工具函数
            async def qq_notify_master(content: str):
                """
                【仅限社交模式】发送通知给主人（Owner）。
                当你在与他人聊天时遇到无法处理的情况，或者需要向主人汇报（如收到好友申请、发现有趣的事情）时，请务必使用此工具。
                严禁在与陌生人的聊天窗口中直接呼叫“主人”。
                
                Args:
                    content: 要汇报给主人的内容。
                """
                await self.notify_master(content, "high")
                return f"已将通知发送给主人：{content}"
            
            # 注册到 tools_map
            plugin_manager.tools_map["qq_notify_master"] = qq_notify_master
            
            # 注册到定义列表（为了让 AgentService.social_chat 能筛选到它）
            # 注意：这只是临时的内存注入，重启后需要重新注册。
            # 由于 plugin_manager.get_all_definitions() 是从 self.plugins 动态生成的，
            # 我们需要构造一个伪造的 manifest 或直接修改 get_all_definitions 的行为？
            # 不，AgentService.social_chat 调用 plugin_manager.get_all_definitions()。
            # 我们直接把这个工具定义注入到一个名为 'SocialRuntime' 的虚拟插件中。
            
            if "SocialRuntime" not in plugin_manager.plugins:
                plugin_manager.plugins["SocialRuntime"] = {
                    "name": "SocialRuntime",
                    "_category": "runtime",
                    "capabilities": {
                        "invocationCommands": []
                    }
                }
            
            # 检查是否已存在
            defs = plugin_manager.plugins["SocialRuntime"]["capabilities"]["invocationCommands"]
            if not any(d["function"]["name"] == "qq_notify_master" for d in defs):
                defs.append({
                    "function": {
                        "name": "qq_notify_master",
                        "description": "【仅限社交模式】发送通知给主人（Owner）。当你在与他人聊天时遇到无法处理的情况，或者需要向主人汇报（如收到好友申请、发现有趣的事情）时，请务必使用此工具。严禁在与陌生人的聊天窗口中直接呼叫“主人”。",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "content": {
                                    "type": "string",
                                    "description": "要汇报给主人的内容"
                                }
                            },
                            "required": ["content"]
                        }
                    }
                })
                
            logger.info("[Social] 已注册动态工具: qq_notify_master")
            
        except Exception as e:
            logger.error(f"[Social] 注册动态工具失败: {e}")

        self.running = True
        logger.info("社交服务已启动。等待 WebSocket 连接于 /api/social/ws")
        
        # 启动随机想法循环
        if not self._thought_task:
            self._thought_task = asyncio.create_task(self._random_thought_worker())
        
        # 检查每日总结
        asyncio.create_task(self.check_daily_summary())
        
        # [新增] 启动时处理待处理的好友请求
        # 我们需要等待 WS 连接
        asyncio.create_task(self._startup_check_worker())

    async def _startup_check_worker(self):
        """
        等待 WS 连接，然后执行启动检查：
        1. 检查待处理的好友请求。
        2. 复活历史会话 (Cold Start)。
        """
        # 等待 WS 连接最多 60 秒
        for _ in range(12):
            if self.active_ws:
                break
            await asyncio.sleep(5)
            
        if not self.active_ws:
            logger.warning("[Social] 启动检查跳过: 无 WebSocket 连接。")
            return
            
        logger.info("[Social] 正在执行启动检查...")
        await asyncio.sleep(5) # 等待系统稳定
        
        # 1. 复活历史会话 (确保主动搭话功能可用)
        await self._revive_sessions_from_db()
        
        try:
            # [Optimization] 检测 OneBot 实现类型
            # NapCat 等现代实现通常不支持拉取历史系统消息，而是完全依赖事件推送。
            # 为了避免超时和报错，我们可以检测实现并跳过不必要的检查。
            version_resp = await self._send_api_and_wait("get_version_info", {}, timeout=5)
            if version_resp and version_resp.get("status") == "ok":
                data = version_resp.get("data", {})
                app_name = data.get("app_name", "").lower()
                logger.info(f"[Social] Bot 实现: {data.get('app_name')} {data.get('app_version')}")
                
                if "napcat" in app_name:
                    logger.info("[Social] 检测到 NapCat。跳过轮询待处理系统消息（事件驱动模式）。")
                    return

            # NapCat/OneBot 并不总是具有用于*待处理*请求的 'get_system_msg_new' 或类似的标准化 API
            # 标准 OneBot v11 具有 'get_system_msg' 或 'get_friend_system_msg'，它返回请求列表。
            # 让我们先尝试 'get_system_msg'。
            
            # [Fixed] 尝试多种 API 变体以兼容不同的 OneBot 实现 (NapCat, LLOneBot, Go-CQHTTP)
            resp = None
            api_candidates = ["get_system_msg", "get_friend_system_msg"]
            
            for api_name in api_candidates:
                try:
                    # logger.info(f"[Social] Startup check: Trying API '{api_name}'...")
                    candidate_resp = await self._send_api_and_wait(api_name, {}, timeout=5)
                    
                    # 检查响应状态
                    if candidate_resp and candidate_resp.get("status") == "ok" and candidate_resp.get("retcode") == 0:
                        resp = candidate_resp
                        logger.info(f"[Social] 成功使用 API '{api_name}'")
                        break
                    elif candidate_resp and candidate_resp.get("retcode") == 1404:
                        # API 不存在 (NapCat 等)
                        # logger.debug(f"[Social] API '{api_name}' not supported (1404).")
                        pass
                    else:
                        # 仅在调试时记录，避免刷屏
                        # logger.debug(f"[Social] API '{api_name}' returned error: {candidate_resp}")
                        pass
                except Exception as e:
                    # 超时或其他错误
                    # logger.warning(f"[Social] API '{api_name}' call failed or timed out: {e}")
                    pass
            
            if not resp:
                logger.info("[Social] 启动检查跳过: 无法获取系统消息（API 不支持或超时）。")
                return

            data = resp.get("data", {})
            # 我们只关心好友请求
            requests = []
            
            # 处理标准 OneBot 11 格式变体
            if isinstance(data, list):
                # 某些实现直接返回列表
                requests = data
            elif isinstance(data, dict):
                # 其他实现返回带有键的字典
                requests = data.get("request", []) + data.get("requester", [])
            
            logger.info(f"[Social] 启动时发现 {len(requests)} 条系统消息。")
            
            for req in requests:
                # 仅处理未处理的消息？
                # OneBot 通常返回*最近的*消息，不一定是*待处理的*消息。
                # 标准 v11 中没有简单的 'status' 字段来查看是否处于待处理状态。
                # 但是，如果它有 'flag' 并且我们要么没有将其记录为已处理，我们可以尝试处理它。
                
                # 检查是否为好友请求
                req_type = req.get("request_type")
                if req_type != "friend":
                    continue
                    
                # 检查数据库是否已处理此 flag
                # (可选优化：我们依赖幂等性或仅重新评估)
                # 但如果我们昨天拒绝了它，重新评估可能会很烦人。
                
                # 对于 MVP：让我们不要在启动时自动处理，以避免垃圾邮件/循环旧请求。
                # 用户问：“我们要添加此功能吗？”
                # 回答：是的，我们要添加它。
                # 策略：仅在 'checked' 为 false 时处理？（某些实现提供此功能）
                # 如果没有可用状态，也许我们应该只通知主人“我有 X 个待处理请求”？
                
                # 让我们尝试使用与实时相同的逻辑来处理它们。
                # 为了防止重新处理旧请求，我们可以检查 MemoryService 日志中的此 'flag'。
                
                flag = req.get("flag")
                if not flag: continue
                
                # 检查数据库
                # 这需要搜索日志元数据。
                # 对每个请求执行此操作可能很繁重但很安全。
                
                # 我们暂时跳过此数据库检查，并依赖 OneBot 行为：
                # 通常 get_system_msg 返回最近的消息。
                # 让我们暂时记录它们或仔细处理它们。
                
                # 实际上，让我们直接触发处理逻辑。
                # 如果我们已经处理了它，OneBot 可能会返回错误或忽略。
                # 但我们不想发送垃圾通知。
                
                # 让我们假设我们仅在最近未在日志中看到此 user_id 时才处理它们？
                # 或者更好：直接处理它。如果是旧的，也许我们改变了主意？
                # 但我们应该添加一点延迟。
                
                await self._handle_incoming_friend_request(req)
                await asyncio.sleep(5)
                
        except Exception as e:
            logger.error(f"[Social] 启动检查失败: {e}")

    async def _revive_sessions_from_db(self):
        """
        [Cold Start] 从数据库恢复最近活跃的会话到内存中。
        用于解决重启后内存 Session 丢失导致无法主动搭话的问题。
        """
        logger.info("[Social] 正在从数据库恢复会话...")
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            from sqlmodel import select, desc

            async for db_session in get_social_db_session():
                # 查询最近活跃的 100 条消息以提取活跃会话
                statement = select(QQMessage).order_by(desc(QQMessage.timestamp)).limit(100)
                messages = (await db_session.exec(statement)).all()
                
                revived_count = 0
                processed_ids = set()
                
                for msg in messages:
                    if msg.session_id in processed_ids:
                        continue
                    processed_ids.add(msg.session_id)
                    
                    if msg.session_id not in self.session_manager.sessions:
                        # 恢复会话
                        # session_name 暂时用 ID 或 Sender Name 填充
                        name = f"Session {msg.session_id}"
                        if msg.session_type == "private":
                             name = msg.sender_name # 私聊对方名字通常就是 Session Name
                        elif msg.session_type == "group":
                             name = f"Group {msg.session_id}"

                        session = self.session_manager.get_or_create_session(
                            session_id=msg.session_id,
                            session_type=msg.session_type,
                            session_name=name
                        )
                        # 设置最后活跃时间为消息时间
                        session.last_active_time = msg.timestamp
                        revived_count += 1
                        
                        if revived_count >= 10:
                            break
                
                if revived_count > 0:
                    logger.info(f"[Social] 从数据库恢复了 {revived_count} 个会话。")
                return revived_count
        except Exception as e:
            logger.error(f"[Social] 恢复会话失败: {e}")
            return 0

    async def _random_thought_worker(self):
        """
        定期检查 Pero 是否想自发说话的后台任务。
        实现了基于会话活跃度的状态机逻辑。
        """
        logger.info("[Social] 随机想法流已初始化（基于会话状态）。")
        
        while self.running:
            try:
                # 检查频率：每 30 秒检查一次状态
                await asyncio.sleep(30)
                
                if not self.running or not self.enabled:
                    continue

                # 检查时间限制 (00:00 - 08:00 静音)
                now = datetime.now()
                if 0 <= now.hour < 8:
                    continue

                # 初始化下一次思考时间
                if not hasattr(self, "_next_thought_time"):
                    self._next_thought_time = datetime.now() + timedelta(seconds=random.randint(60, 120))
                
                if now < self._next_thought_time:
                    continue

                # 到了思考时间，尝试冒泡
                # 随机选择一个活跃会话
                sessions = self.session_manager.get_active_sessions(limit=5)
                
                # [Fix] 如果内存中没有活跃会话（例如刚重启），尝试从数据库复活
                if not sessions:
                    revived = await self._revive_sessions_from_db()
                    if revived > 0:
                        sessions = self.session_manager.get_active_sessions(limit=5)

                if not sessions:
                    # 没有活跃会话，休眠久一点 (10-20分钟)
                    interval = random.randint(600, 1200)
                    self._next_thought_time = now + timedelta(seconds=interval)
                    # logger.debug("[Social] No active sessions, sleeping...")
                    continue
                
                target_session = random.choice(sessions)
                
                # 检查该会话的状态
                # 活跃定义：最近 2 分钟内有活动 (用户说话或 Pero 说话)
                time_since_active = (now - target_session.last_active_time).total_seconds()
                is_active = time_since_active < 120
                
                session_state = "ACTIVE" if is_active else "DIVE"
                logger.info(f"[Social] 触发冒泡检查: {target_session.session_name} (状态: {session_state}, 上次活跃: {time_since_active:.0f}秒前)...")
                
                # 尝试说话
                # 注意：_attempt_random_thought 需要修改为返回是否说话了
                spoke = await self._attempt_random_thought(target_session)
                
                # 决定下一次检查时间
                if spoke:
                    # 如果说话了，进入/保持活跃节奏 (2分钟)
                    interval = 120
                elif is_active:
                    # 如果没说话但会话很活跃 (例如插不上话，或者秘书觉得不需要插话)，
                    # 稍微快点回来检查 (1分钟)，以免错过插话机会
                    interval = 60
                else:
                    # 没说话且会话不活跃 (潜水节奏)
                    interval = random.randint(600, 1200)
                    
                self._next_thought_time = now + timedelta(seconds=interval)
                logger.info(f"[Social] 下次冒泡检查将在 {interval} 秒后。")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Social] 随机想法工作线程错误: {e}", exc_info=True)

    async def _attempt_random_thought(self, target_session: Optional[SocialSession] = None) -> bool:
        """
        主动消息传递的“大脑”逻辑（秘书层）。
        由 _random_thought_worker 调用（随机目标）或 handle_session_flush 调用（指定目标）。
        
        Args:
            target_session: 指定的会话。如果为 None，则随机选择一个活跃会话。
            
        Returns:
            bool: 是否发送了消息
        """
        # 1. 确定目标
        if not target_session:
            sessions = self.session_manager.get_active_sessions(limit=5)
            if not sessions:
                # logger.debug("[Social] No active sessions to speak to.")
                return False
            target_session = random.choice(sessions)
        
        logger.info(f"[Social] 秘书正在观察 {target_session.session_name} ({target_session.session_id})...")

        # 计算会话状态
        now = datetime.now()
        time_since_active = (now - target_session.last_active_time).total_seconds()
        session_state = "ACTIVE" if time_since_active < 120 else "DIVE"

        # 2. 构建提示 (Secretary Persona)
        # ... (Existing logic refactored) ...
        
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with async_session() as db_session:
            # 上下文获取逻辑
            # [Optimization] Unified context limit to 100 as per user request
            history_limit = 100
            recent_messages = await self.session_manager.get_recent_messages(
                target_session.session_id, 
                target_session.session_type, 
                limit=history_limit
            )
            
            # 如果 DB 为空（回退到 buffer）
            if not recent_messages:
                recent_messages = target_session.buffer[-5:]
            
            recent_context = ""
            for msg in recent_messages:
                # [Fix] 明确区分自己和他人，防止精分
                sender = msg.sender_name
                bot_name = self.config_manager.get("bot_name", "Pero")
                if sender == bot_name or sender == "Me":
                    sender = f"Me ({bot_name})"
                elif target_session.session_type == "private" and sender == target_session.session_name:
                    sender = "User"
                
                recent_context += f"[{sender}]: {msg.content}\n"
            
            if not recent_context:
                recent_context = "(本地缓存为空)"

            # 秘书 Prompt (增强版)
            # 为了保证人设一致性，我们手动注入核心设定，而不是依赖 AgentService 的完整 Prompt
            owner_qq = self.config_manager.get("owner_qq") or "未知"
            
            # [Fix] 明确注入会话类型
            session_type_str = "群聊 (Group)" if target_session.session_type == "group" else "私聊 (Private)"
            
            bot_name = self.bot_info.get("nickname", self.config_manager.get("bot_name", "Pero"))
            
            prompt = mdp.render("tasks/social/secretary_decision", {
                "agent_name": bot_name,
                "current_time": datetime.now().strftime('%H:%M'),
                "session_state": session_state,
                "session_type_str": session_type_str,
                "target_session_name": target_session.session_name
            })

            # ... (Tool calling logic reused) ...
            # 为节省篇幅，复用现有 AgentService 调用逻辑
            from services.agent_service import AgentService
            agent = AgentService(db_session)
            
            # 构造消息
            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Context:\n{recent_context}\n\nDecision?"}
            ]
            
            # 秘书不需要工具，纯文本判断即可
            social_tools = []

            config = await agent._get_llm_config()
            from services.llm_service import LLMService
            llm = LLMService(
                api_key=config.get("api_key"),
                api_base=config.get("api_base"),
                model=config.get("model")
            )
            
            # 执行 LLM 调用 (纯文本模式)
            # 我们使用简单的单轮对话，因为秘书不需要使用工具
            try:
                # 增加重试机制 (复用 AgentService 的逻辑概念，但这里手动实现简单版)
                import asyncio
                retry_count = 1
                response = None
                for i in range(retry_count + 1):
                    try:
                        response = await llm.chat(messages, temperature=0.8, tools=None)
                        break
                    except Exception as err:
                        if i == retry_count:
                            logger.error(f"[Social] 秘书 LLM 失败: {err}")
                            return False # 静默失败
                        await asyncio.sleep(1)

                if not response: return False

                response_msg = response["choices"][0]["message"]
                content = response_msg.get("content", "")
                
                # 秘书不需要处理 Tool Calls，因为它没有工具
                
                content = content.strip()
                
                # [Robustness] 增强的输出清洗
                # 1. 去除首尾引号
                if (content.startswith('"') and content.endswith('"')) or (content.startswith("'") and content.endswith("'")):
                    content = content[1:-1].strip()
                
                # 2. 去除常见前缀
                import re
                bot_name = self.config_manager.get("bot_name", "Pero")
                # 动态构建正则以匹配当前 bot_name
                pattern = r'^(' + re.escape(bot_name) + r'|Me|Reply|Answer|Decision):\s*'
                content = re.sub(pattern, '', content, flags=re.IGNORECASE).strip()
                
                if content.upper() in ["PASS", "IGNORE", "NONE", "NULL", "NO"]:
                    # logger.info("[Social] Secretary decided to PASS.")
                    return False
                
                if not content:
                    return False

                # 3. 再次检查是否包含工具调用代码（幻觉防护）
                if "```" in content or "<tool_code>" in content or "def " in content:
                    logger.warning(f"[Social] 秘书产生幻觉代码/工具，已抑制。内容: {content}")
                    return False
                
                # 4. 说话！
                logger.info(f"[Social] 秘书决定发言: {content}")
                await self.send_msg(target_session, content)
                
                # 5. 更新状态
                # [Fix] 移除 Pero 自身发言对活跃时间的重置，防止“自递归”保持活跃
                # target_session.last_active_time = datetime.now()
                
                # 既然已经说话了，推迟下一次随机思考
                self._next_thought_time = datetime.now() + timedelta(seconds=120)
                
                # 持久化
                await self.session_manager.persist_outgoing_message(
                    target_session.session_id,
                    target_session.session_type,
                    content,
                    sender_name="Pero"
                )
                return True
            except Exception as e:
                logger.error(f"[Social] 秘书错误: {e}")
                return False

    # 移除旧的 _attempt_random_thought (已被上面覆盖)
    # async def _attempt_random_thought(self): ...


    async def check_daily_summary(self):
        """
        检查我们是否需要为昨天生成摘要。
        """
        from datetime import datetime, timedelta
        
        try:
            # 1. 获取上次摘要日期
            last_date_str = self.config_manager.get("last_social_summary_date", "")
            yesterday = (datetime.now() - timedelta(days=1)).date()
            yesterday_str = yesterday.strftime("%Y-%m-%d")
            
            if last_date_str == yesterday_str:
                logger.info(f"[Social] {yesterday_str} 的每日摘要已存在。")
                return

            # 2. 生成摘要
            logger.info(f"[Social] 正在生成 {yesterday_str} 的每日摘要...")
            await self._generate_daily_summary(yesterday_str)
            
            # 3. 更新配置
            await self.config_manager.set("last_social_summary_date", yesterday_str)
            logger.info(f"[Social] {yesterday_str} 的每日摘要已完成。")
            
        except Exception as e:
            logger.error(f"[Social] 每日摘要失败: {e}", exc_info=True)

    async def _generate_daily_summary(self, date_str: str):
        """
        为特定日期生成摘要。
        """
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                # 1. 获取日志
                # 使用带有日期过滤器的 MemoryService.get_recent_logs
                # 但是 get_recent_logs 需要 source 和 session_id。我们需要所有 QQ 日志。
                # 所以我们手动使用 search_logs 且 source="qq_%" 和时间范围？
                # search_logs 目前不支持日期范围。
                # 让我们在这里添加一个专门的查询。
                
                from models import ConversationLog
                from sqlmodel import select, and_
                from datetime import datetime, time
                
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                start_dt = datetime.combine(target_date, time.min)
                end_dt = datetime.combine(target_date, time.max)
                
                statement = select(ConversationLog).where(
                    ConversationLog.source.like("qq_%")
                ).where(
                    ConversationLog.timestamp >= start_dt
                ).where(
                    ConversationLog.timestamp <= end_dt
                ).order_by(ConversationLog.timestamp)
                
                logs = (await session.exec(statement)).all()
                
                if not logs:
                    logger.info(f"[Social] 未找到 {date_str} 的日志。")
                    return

                # 2. 准备上下文
                context_text = ""
                for log in logs:
                    sender = self.config_manager.get("bot_name", "Pero") if log.role == "assistant" else "User"
                    # 尝试元数据
                    try:
                        meta = json.loads(log.metadata_json)
                        if "sender_name" in meta: sender = meta["sender_name"]
                        if "session_name" in meta: sender += f" ({meta['session_name']})"
                    except: pass
                    
                    context_text += f"[{log.timestamp.strftime('%H:%M')}] {sender}: {log.content}\n"
                
                # 如果太长则截断（MVP 的简单字符限制）
                if len(context_text) > 50000:
                    context_text = context_text[:50000] + "\n...(Truncated)..."

                # 3. 调用 LLM
                from services.llm_service import LLMService
                # 使用默认/全局配置
                # 我们可以重用 AgentService._get_llm_config 逻辑或直接从数据库获取
                from services.agent_service import AgentService
                agent = AgentService(session)
                config = await agent._get_llm_config()
                
                llm = LLMService(
                    api_key=config.get("api_key"),
                    api_base=config.get("api_base"),
                    model=config.get("model")
                )
                
                prompt = mdp.render("tasks/social/daily_summary", {
                    "agent_name": self.config_manager.get("bot_name", "Pero"),
                    "date_str": date_str,
                    "context_text": context_text
                })
                
                messages = [{"role": "user", "content": prompt}]
                response = await llm.chat(messages, temperature=0.3)
                summary_content = response["choices"][0]["message"]["content"]
                
                # 4. 保存到文件 (MD)
                from utils.memory_file_manager import MemoryFileManager
                file_path = await MemoryFileManager.save_log("social_daily", f"{date_str}_Social_Summary", summary_content)
                
                # 5. 保存到记忆 (DB)
                # [Modified] User requested NOT to store document types in DB at all.
                # db_content = f"【社交日报 {date_str}】\n{summary_content}\n\n> 📁 File Archived: {file_path}"
                
                # await MemoryService.save_memory(
                #     session=session,
                #     content=db_content,
                #     tags="social_summary,daily_log",
                #     importance=5, # 中等重要性
                #     source="social_summary",
                #     memory_type="summary"
                # )
                
                logger.info(f"[Social] 摘要已生成并仅保存到文件（数据库已禁用）。")

        except Exception as e:
            logger.error(f"[Social] 生成摘要错误: {e}", exc_info=True)

    async def stop(self):
        self.running = False
        if self._thought_task:
            self._thought_task.cancel()
            try:
                await self._thought_task
            except asyncio.CancelledError:
                pass
            self._thought_task = None
            
        if self.active_ws:
            await self.active_ws.close()
            self.active_ws = None
        logger.info("社交服务已停止。")

    async def handle_websocket(self, websocket: WebSocket):
        if not self.enabled:
            await websocket.close(code=1000, reason="Social Mode Disabled")
            return

        await websocket.accept()
        self.active_ws = websocket
        logger.info("社交适配器已通过 WebSocket 连接。")
        
        try:
            while True:
                # [隔离检查] 在每次循环迭代中重新检查启用状态
                if not self.enabled:
                    logger.warning("运行时社交模式已禁用。正在关闭连接。")
                    await websocket.close(code=1000, reason="Social Mode Disabled")
                    self.active_ws = None
                    break

                data = await websocket.receive_text()
                event = json.loads(data)
                
                # [同步响应处理]
                if "echo" in event:
                    echo_id = event["echo"]
                    if echo_id in self.pending_requests:
                        future = self.pending_requests.pop(echo_id)
                        if not future.done():
                            future.set_result(event)
                        continue # 不作为事件处理
                
                await self.process_event(event)
        except WebSocketDisconnect:
            logger.warning("社交适配器已断开连接。")
            self.active_ws = None
        except Exception as e:
            logger.error(f"WebSocket 错误: {e}")
            self.active_ws = None

    async def process_event(self, event: Dict[str, Any]):
        """
        处理传入的 OneBot 11 事件。
        """
        # [隔离检查]再次检查
        if not self.enabled:
            return

        post_type = event.get("post_type")
        if post_type == "meta_event":
            return # 忽略心跳日志
            
        logger.info(f"[Social Event] {post_type}: {event}")
        
        if post_type == "message":
            # 委托给会话管理器
            await self.session_manager.handle_message(event)
        
        elif post_type == "request" and event.get("request_type") == "friend":
            # 自动好友请求处理
            asyncio.create_task(self._handle_incoming_friend_request(event))
            
        elif post_type == "notice":
            # 通知事件处理 (禁言、撤回等)
            asyncio.create_task(self._handle_notice_event(event))

    async def _handle_notice_event(self, event: Dict[str, Any]):
        """
        处理通知事件 (禁言、撤回等)
        """
        notice_type = event.get("notice_type")
        sub_type = event.get("sub_type", "")
        
        try:
            # 1. 群禁言 (group_ban)
            if notice_type == "group_ban":
                group_id = str(event.get("group_id"))
                operator_id = str(event.get("operator_id"))
                user_id = str(event.get("user_id"))
                duration = event.get("duration", 0) # seconds
                
                # 检查是否是 Pero 被禁言
                self_id = self.bot_info.get("user_id") if hasattr(self, "bot_info") and self.bot_info else ""
                
                if user_id == self_id:
                    if sub_type == "ban":
                        logger.warning(f"[社交通知] Pero 在群 {group_id} 被 {operator_id} 禁言了 {duration} 秒。")
                        # 通知主人
                        await self.notify_master(f"【被禁言通知】\n我在群 {group_id} 被 {operator_id} 禁言了 {duration} 秒。QAQ", "high")
                        # 记录系统消息
                        await self.session_manager.persist_system_notification(
                            group_id, "group", 
                            f"[System] You have been MUTED by {operator_id} for {duration} seconds.", 
                            event
                        )
                    elif sub_type == "lift_ban":
                        logger.info(f"[社交通知] Pero 在群 {group_id} 的禁言已解除。")
                        await self.notify_master(f"【解禁通知】\n我在群 {group_id} 的禁言已解除。", "normal")
                        await self.session_manager.persist_system_notification(
                            group_id, "group", 
                            f"[System] Your mute has been LIFTED.", 
                            event
                        )
                else:
                    # 别人被禁言，只记录到上下文，供 Pero 吃瓜
                    action = "muted" if sub_type == "ban" else "unmuted"
                    msg = f"[System] User {user_id} was {action} by {operator_id}."
                    if sub_type == "ban":
                        msg += f" Duration: {duration}s."
                    
                    await self.session_manager.persist_system_notification(group_id, "group", msg, event)

            # 2. 消息撤回 (group_recall / friend_recall)
            elif notice_type == "group_recall":
                group_id = str(event.get("group_id"))
                operator_id = str(event.get("operator_id"))
                user_id = str(event.get("user_id")) # Message sender
                
                logger.info(f"[社交通知] 群 {group_id} 消息已撤回。操作者: {operator_id}, 发送者: {user_id}")
                
                msg = f"[System] A message from {user_id} was recalled by {operator_id}."
                await self.session_manager.persist_system_notification(group_id, "group", msg, event)

            elif notice_type == "friend_recall":
                user_id = str(event.get("user_id"))
                
                logger.info(f"[社交通知] 私聊消息已由 {user_id} 撤回。")
                
                msg = f"[System] {user_id} recalled a message."
                await self.session_manager.persist_system_notification(user_id, "private", msg, event)
                
        except Exception as e:
            logger.error(f"[社交] 处理通知事件失败: {e}", exc_info=True)

    async def get_bot_info(self):
        """获取 Bot 自身信息 (OneBot v11)"""
        if not self.active_ws:
            return
            
        request_id = str(uuid.uuid4())
        payload = {
            "action": "get_login_info",
            "params": {},
            "echo": request_id
        }
        
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[request_id] = future
        
        try:
            logger.info("[Social] 正在获取 Bot 登录信息...")
            await self.active_ws.send_text(json.dumps(payload))
            response = await asyncio.wait_for(future, timeout=10.0)
            if response.get("status") == "ok":
                data = response.get("data", {})
                self.bot_info = {
                    "nickname": data.get("nickname", "Pero"),
                    "user_id": str(data.get("user_id", ""))
                }
                logger.info(f"[Social] Bot 信息已更新: {self.bot_info}")
        except Exception as e:
            logger.error(f"[Social] 获取 Bot 信息失败: {e}")
            # Clean up if needed, though pop happens in handle_websocket
            if request_id in self.pending_requests:
                del self.pending_requests[request_id]

    async def _handle_incoming_friend_request(self, event: Dict[str, Any]):
        """
        自动处理传入的好友请求。
        """
        user_id = event.get("user_id")
        comment = event.get("comment", "")
        flag = event.get("flag")
        
        logger.info(f"[Social] 正在处理来自 {user_id} 的好友请求。备注: {comment}")
        
        # 模拟“思考”延迟（5-15 秒）以显得更像人类
        await asyncio.sleep(random.randint(5, 15))

        try:
            # 1. 咨询 LLM
            from services.agent_service import AgentService
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as db_session:
                agent = AgentService(db_session)
                config = await agent._get_llm_config()
                
                # 构建提示（中文）
                bot_name = self.config_manager.get("bot_name", "Pero")
                prompt = mdp.render("tasks/social/friend_request_decision", {
                    "agent_name": bot_name,
                    "user_id": user_id,
                    "comment": comment
                })
                
                messages = [{"role": "system", "content": prompt}]
                
                from services.llm_service import LLMService
                llm = LLMService(
                    api_key=config.get("api_key"),
                    api_base=config.get("api_base"),
                    model=config.get("model")
                )
                
                # 使用稍高的温度以获得更自然的通知文本
                response = await llm.chat(messages, temperature=0.3)
                content_str = response["choices"][0]["message"]["content"].strip()
                
                # 如果 LLM 忽略指令，清理可能的 markdown 代码块
                if content_str.startswith("```"):
                    content_str = content_str.strip("`").replace("json", "").strip()

                try:
                    result = json.loads(content_str)
                except json.JSONDecodeError:
                    logger.warning(f"[Social] 解析好友请求 JSON 失败: {content_str}")
                    # 回退逻辑
                    result = {
                        "decision": "HOLD",
                        "notify_master": f"收到好友申请({user_id})，自动处理结果未知，已转为搁置。"
                    }

                decision = result.get("decision", "HOLD").upper()
                notify_msg = result.get("notify_master", "")
                greeting = result.get("greeting_message", "")
                
                logger.info(f"[Social] 好友请求决定: {decision}, 通知: {notify_msg}, 问候: {greeting}")
                
                if decision == "HOLD":
                    # 延迟处理
                    # 我们不调用 handle_friend_request。只通知主人。
                    # OneBot 11 请求标志在处理或超时之前有效（通常很长）。
                    # 我们应该持久化这个待处理的请求，以便我们以后可以手动或通过命令处理它。
                    
                    # 持久化为可以查询的特殊记忆/日志？
                    # 或者只是依靠主人看到通知并告诉 Pero “批准好友请求 X”。
                    # 目前，我们通知主人并记录下来。
                    
                    if not notify_msg:
                        notify_msg = f"收到好友申请({user_id})，备注: {comment}。我拿不准，请指示。"
                        
                    await self.notify_master(f"【搁置好友申请】({user_id}):\n{notify_msg}\nFlag: {flag}", "high")
                    
                    # 记录为 PENDING
                    await MemoryService.save_log(
                        session=db_session,
                        source="social_event",
                        session_id=str(user_id),
                        role="system",
                        content=f"搁置好友申请。备注：{comment}。理由：{result.get('reason', '拿不准')}。Flag: {flag}",
                        metadata={"type": "friend_request", "status": "PENDING", "flag": flag, "user_id": user_id, "comment": comment}
                    )
                    await db_session.commit()
                    
                else:
                    # 批准或拒绝
                    approve = (decision == "APPROVE")
                    
                    # 2. 执行决定
                    await self.handle_friend_request(flag, approve)
                    
                    # 3. 通知主人（如果需要）
                    if notify_msg:
                        # 明确通知主人，而不是申请人
                        await self.notify_master(f"好友申请处理 ({user_id}):\n{notify_msg}\n(处理结果: {'通过' if approve else '拒绝'})", "medium")

                    # 4. [新增] 如果通过，主动打招呼
                    if approve and greeting:
                        # 延迟 2-5 秒模拟真人反应
                        await asyncio.sleep(random.randint(2, 5))
                        try:
                            # 确保 user_id 是 int
                            target_id = int(user_id)
                            await self.send_private_msg(target_id, greeting)
                            logger.info(f"[Social] 向新朋友 {user_id} 发送问候: {greeting}")
                            
                            # 记录 Pero 的打招呼内容
                            await MemoryService.save_log(
                                session=db_session,
                                source="qq_private",
                                session_id=str(user_id),
                                role="assistant",
                                content=greeting,
                                metadata={"sender_name": "Pero", "platform": "qq", "type": "greeting"}
                            )
                        except Exception as e:
                            logger.error(f"[Social] 发送问候失败: {e}")

                    # 5. 记录到记忆
                    action_str = "同意" if approve else "拒绝"
                    await MemoryService.save_log(
                        session=db_session,
                        source="social_event",
                        session_id=str(user_id),
                        role="system",
                        content=f"处理好友申请：{action_str}。备注：{comment}。理由：{result.get('reason', '无')}。主动招呼：{greeting if approve else '无'}",
                        metadata={"type": "friend_request", "approved": approve, "status": "HANDLED"}
                    )
                    await db_session.commit()
                
        except Exception as e:
            logger.error(f"[Social] 处理好友请求错误: {e}", exc_info=True)

    async def delete_friend(self, user_id: int):
        """
        删除好友。
        """
        await self._send_api("delete_friend", {"user_id": user_id})
        logger.info(f"[Social] 好友 {user_id} 已删除。")

    async def handle_session_flush(self, session: SocialSession):
        """
        缓冲区刷新时来自 SessionManager 的回调。
        根据会话状态决定处理逻辑：
        - SUMMONED: 直接调用 AgentService 进行回复 (Action Layer)。
        - OBSERVING: 调用 Secretary (Think Layer) 决定是否插嘴。
        """
        logger.info(f"--- [FLUSH] 处理会话 {session.session_id} (状态: {session.state}) ---")
        
        # [New Feature] 尝试触发记忆总结
        # 即使这次不回复，我们也检查是否积累了足够的消息需要总结
        asyncio.create_task(self._check_and_summarize_memory(session))
        
        # 1. 检查状态
        # [Refactor] Active 状态下直接由 Agent 决策 (Pass or Reply)
        # 活跃定义: 距离上次活跃时间在 ACTIVE_DURATION 内
        is_active = False
        time_since_active = (datetime.now() - session.last_active_time).total_seconds()
        if time_since_active < self.session_manager.ACTIVE_DURATION:
            is_active = True

        if session.state != "summoned" and not is_active:
            # 既不是被召唤，也不活跃（潜水模式），交给秘书层判断 (Low Cost)
            # 如果缓冲区是因为满了或超时刷新的，说明可能正在热聊
            logger.info(f"[{session.session_id}] 偷听刷新 (潜水模式)。委派给秘书。")
            await self._attempt_random_thought(target_session=session)
            return

        # 确定模式，供 Prompt 使用
        current_mode = "SUMMONED" if session.state == "summoned" else "ACTIVE_OBSERVATION"
        logger.info(f"[{session.session_id}] 正在以 {current_mode} 模式处理。调用主 Agent。")

        # [Multimodal Barrier] Ensure all pending image downloads are complete
        # Collect tasks from buffer messages
        all_pending_tasks = []
        task_to_msg_map = {} # task -> (msg, index)
        
        for msg in session.buffer:
            if hasattr(msg, "image_tasks") and msg.image_tasks:
                for idx, task in enumerate(msg.image_tasks):
                    if not task.done():
                        all_pending_tasks.append(task)
                        task_to_msg_map[task] = (msg, idx)
                    else:
                        # Task already done, update image path if successful
                        try:
                            res = task.result()
                            if res and os.path.exists(res):
                                # Replace URL with local path
                                if idx < len(msg.images):
                                    msg.images[idx] = res
                        except Exception as e:
                            logger.warning(f"[Social] 图片下载任务失败（已完成）: {e}")

        if all_pending_tasks:
            logger.info(f"[{session.session_id}] 等待 {len(all_pending_tasks)} 个图片下载...")
            try:
                # Wait with timeout (e.g. 10 seconds)
                done, pending = await asyncio.wait(all_pending_tasks, timeout=10.0)
                
                # Process results
                for task in done:
                    try:
                        res = task.result()
                        if res and os.path.exists(res) and task in task_to_msg_map:
                            msg, idx = task_to_msg_map[task]
                            if idx < len(msg.images):
                                msg.images[idx] = res
                                logger.info(f"[Social] 解析图片路径: {res}")
                    except Exception as e:
                        logger.warning(f"[Social] 图片下载任务失败: {e}")
                
                if pending:
                    logger.warning(f"[{session.session_id}] {len(pending)} 个图片下载超时。")
                    # Optional: cancel pending tasks? No, let them finish in background for future reference.
            except Exception as e:
                logger.error(f"[{session.session_id}] 等待图片时出错: {e}")

        # --- 以下是被动呼唤 (Summoned) 或 活跃观察 (Active) 的处理逻辑 (Action Layer) ---
        
        # 1. 构建 XML 上下文
        # [核心优化] 从数据库加载更长的历史记录 (Unified to 100)
        history_limit = 100
        
        # 获取历史记录（包括缓冲区中已持久化的消息）
        # 注意：get_recent_messages 返回 SocialMessage 对象列表
        recent_messages = await self.session_manager.get_recent_messages(
            session.session_id, 
            session.session_type, 
            limit=history_limit
        )
        
        # 如果数据库为空（极少见，因为刚存入了 buffer），则回退到 buffer
        if not recent_messages:
            logger.warning(f"[{session.session_id}] 数据库历史记录为空，回退到缓冲区。")
            recent_messages = session.buffer
            
        # [Enhancement] Fetch Related Private Contexts (Cross-Context Awareness)
        # 1. Identify relevant users from recent 10 messages
        relevant_users = []
        seen_users = set()
        
        # Check last 10 messages (or fewer if not enough)
        scan_range = recent_messages[-10:] if len(recent_messages) >= 10 else recent_messages
        
        # Self ID
        my_id = self.bot_info.get("user_id") if hasattr(self, "bot_info") and self.bot_info else ""
        
        # Scan in reverse (latest first)
        for msg in reversed(scan_range):
            uid = str(msg.sender_id)
            # Filter: Not Self, Not System, Not Duplicate, limit to 3
            if uid and uid != my_id and uid != "system" and uid not in seen_users:
                # Also ensure it's a valid user ID (digits)
                if uid.isdigit():
                    relevant_users.append(uid)
                    seen_users.add(uid)
                    if len(relevant_users) >= 3:
                        break
        
        # 2. Fetch private history for these users
        private_contexts = {} # user_id -> list[SocialMessage]
        injected_ids = set() # For deduplication
        
        if relevant_users:
            logger.info(f"[{session.session_id}] 正在获取相关私聊上下文: {relevant_users}")
            for uid in relevant_users:
                try:
                    p_msgs = await self.session_manager.get_recent_messages(uid, "private", limit=10)
                    if p_msgs:
                        private_contexts[uid] = p_msgs
                        # Collect IDs for deduplication
                        for pm in p_msgs:
                            injected_ids.add(str(pm.msg_id))
                except Exception as e:
                    logger.warning(f"获取 {uid} 的私聊上下文失败: {e}")

        # Set ContextVar for tool deduplication
        token = injected_msg_ids_var.set(injected_ids)

        # [Optimization] Unified context limit to 100 (Logic handled in get_recent_messages)
        # Note: XML construction logic starts here
        
        xml_context = "<social_context>\n"
        
        # 3. Inject Private Contexts (Moved to top)
        if private_contexts:
            xml_context += "  <related_private_contexts>\n"
            for uid, p_msgs in private_contexts.items():
                # Get user name from first message if possible, or just ID
                p_name = f"User{uid}"
                if p_msgs:
                    # Find a message from this user to get name
                    for m in p_msgs:
                        if str(m.sender_id) == uid:
                            p_name = m.sender_name
                            break
                
                xml_context += f"    <session type=\"private\" id=\"{uid}\" name=\"{p_name}\">\n"
                for pm in p_msgs:
                    # [Optimization] Clean CQ codes in content to save tokens
                    content = pm.content
                    if "[CQ:image" in content:
                        import re
                        # Extract summary if present, otherwise use [图片]
                        # Pattern matches [CQ:image, ... summary=[text], ...]
                        # This simple regex might need adjustment for complex cases
                        # Let's just simplify all CQ:image to [图片] or summary if easy
                        
                        # Replace [CQ:image...] with [图片]
                        # If we want to be fancy, we can try to extract 'summary'
                        def replace_cq_image(match):
                            full_tag = match.group(0)
                            summary_match = re.search(r'summary=\[(.*?)\]', full_tag)
                            if summary_match:
                                return f"[{summary_match.group(1)}]"
                            return "[图片]"
                            
                        content = re.sub(r'\[CQ:image,[^\]]*\]', replace_cq_image, content)

                    xml_context += f"      <msg sender=\"{pm.sender_name}\" sender_id=\"{pm.sender_id}\" id=\"{pm.msg_id}\" time=\"{pm.timestamp.strftime('%H:%M:%S')}\">{content}</msg>\n"
                xml_context += "    </session>\n"
            xml_context += "  </related_private_contexts>\n"

        xml_context += "  <recent_messages>\n"
        xml_context += f"    <session type=\"{session.session_type}\" id=\"{session.session_id}\" name=\"{session.session_name}\">\n"
        
        session_images = []
        
        # 使用加载的历史记录构建上下文
        for msg in recent_messages:
            # [Optimization] Clean CQ codes in content
            content = msg.content
            img_tag = "" # Legacy placeholder, kept for structure
            
            if "[CQ:image" in content:
                import re
                def replace_cq_image(match):
                    full_tag = match.group(0)
                    # Try to find summary
                    # OneBot often uses summary=[text]
                    # Also decoding URL encoded chars might be needed if complex
                    summary_match = re.search(r'summary=\[(.*?)\]', full_tag)
                    if summary_match:
                        return f"[{summary_match.group(1)}]"
                    return "[图片]"
                    
                content = re.sub(r'\[CQ:image,[^\]]*\]', replace_cq_image, content)
            
            xml_context += f"      <msg sender=\"{msg.sender_name}\" sender_id=\"{msg.sender_id}\" id=\"{msg.msg_id}\" time=\"{msg.timestamp.strftime('%H:%M:%S')}\">{content}{img_tag}</msg>\n"

        # 收集当前 Buffer 中的图片用于 Vision 分析
        for buf_msg in session.buffer:
            if buf_msg.images:
                session_images.extend(buf_msg.images)

        # [优化] 限制图片数量，防止上下文过大
        if len(session_images) > 2:
            dropped_count = len(session_images) - 2
            logger.info(f"[Social] 发现 {len(session_images)} 张图片，丢弃最旧的 {dropped_count} 张。保留最后 2 张。")
            session_images = session_images[-2:]
            
        xml_context += "    </session>\n"
        xml_context += "  </recent_messages>\n"
        
        xml_context += "</social_context>"
        
        # 2. 调用 AgentService
        try:
            from services.agent_service import AgentService # 延迟导入以避免循环依赖
            
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as db_session:
                from services.agent_service import AgentService
                agent = AgentService(db_session)
                
                # [迁移] 使用 PromptManager 获取系统提示
                from services.prompt_service import PromptManager
                prompt_manager = PromptManager()
                # 我们需要为社交模式构建特定的上下文
                # 目前，我们获取核心提示并附加社交指令
                core_system_prompt = await prompt_manager.get_rendered_system_prompt(db_session, is_social_mode=True)
                
                owner_qq = self.config_manager.get("owner_qq") or "未知"
                
                social_instructions = mdp.render("tasks/social/social_instructions", {
                    "agent_name": self.config_manager.get("bot_name", "Pero"),
                    "current_mode": current_mode,
                    "owner_qq": owner_qq
                })
                
                full_system_prompt = core_system_prompt + social_instructions
                
                messages = [
                    {"role": "system", "content": full_system_prompt}
                ]
                
                # 构建用户内容（文本 + 可选图像）
                user_content = [{"type": "text", "text": xml_context}]
                
                # 添加图像（如果有）（原生多模态）
                # 检查模型是否支持视觉？AgentService.social_chat 将处理配置检查，
                # 但我们需要传递结构。
                # 理想情况下，我们仅在配置允许的情况下传递图像，但在这里我们构建候选消息。
                # AgentService 的 LLMService 应该在禁用视觉时处理过滤？
                # 实际上，如果将图像传递给非视觉模型，LLMService 通常会报错。
                # 所以我们应该在这里检查配置或让 AgentService 处理它。
                # 让我们先验证配置。
                
                # [Multimodal] 处理本地缓存图片转 Base64
                processed_images = []
                for img_path in session_images:
                    # 检查是否为本地文件路径
                    if os.path.exists(img_path):
                        try:
                            async with aiofiles.open(img_path, "rb") as f:
                                img_data = await f.read()
                                b64_data = base64.b64encode(img_data).decode("utf-8")
                                # 简单的 MIME 类型推断
                                mime_type = "image/jpeg"
                                if img_path.endswith(".png"): mime_type = "image/png"
                                elif img_path.endswith(".gif"): mime_type = "image/gif"
                                
                                data_url = f"data:{mime_type};base64,{b64_data}"
                                processed_images.append(data_url)
                        except Exception as e:
                            logger.error(f"[Social] 读取图片文件 {img_path} 失败: {e}")
                    else:
                        # 如果不是本地文件，假设是 URL (回退逻辑)
                        # 仍需过滤腾讯内网 URL
                        if "multimedia.nt.qq.com.cn" in img_path or "c2cpicdw.qpic.cn" in img_path or "gchat.qpic.cn" in img_path:
                            logger.warning(f"[Social] 跳过不兼容的图片 URL: {img_path[:50]}...")
                            continue
                        processed_images.append(img_path)

                config = await agent._get_llm_config()
                if config.get("enable_vision") and processed_images:
                    logger.info(f"注入 {len(processed_images)} 张图片到社交聊天上下文。")
                    for img_url in processed_images:
                        user_content.append({
                            "type": "image_url",
                            "image_url": {"url": img_url}
                        })
                
                messages.append({"role": "user", "content": user_content})
                
                logger.info(f"正在呼叫会话 {session.session_id} 的社交 Agent...")
                response_text = await agent.social_chat(messages, session_id=f"social_{session.session_id}")
                
                logger.info(f"社交 Agent 响应: {response_text}")
                
                # 3. 发送回复
                if response_text and response_text.strip() and "IGNORE" not in response_text and "[PASS]" not in response_text:
                    await self.send_msg(session, response_text)
                    
                    # 更新会话状态
                    # [Fix] 移除 Pero 自身回复对活跃时间的重置
                    # session.last_active_time = datetime.now()
                    
                    # 既然已经说话了，推迟下一次随机思考
                    self._next_thought_time = datetime.now() + timedelta(seconds=120)

                    # [持久化] 保存 Pero 的回复到独立数据库
                    try:
                        await self.session_manager.persist_outgoing_message(
                            session.session_id,
                            session.session_type,
                            response_text,
                            sender_name="Pero"
                        )
                        
                        # [Legacy Removed] 不再保存到主数据库，仅使用独立数据库 social_storage.db
                        # await MemoryService.save_log(...)
                        
                    except Exception as e:
                        logger.error(f"持久化 Pero 回复失败: {e}")
                elif response_text and "[PASS]" in response_text:
                     logger.info(f"[{session.session_id}] Agent 决定 PASS (活跃观察)。")
                else:
                    logger.info(f"[Social] 跳过回复。响应为空或 IGNORE。（内容: '{response_text}'）")
            
            # [State Reset] 处理完成后，重置状态为 observing
            # Active 状态由时间窗口 (ACTIVE_DURATION) 隐式控制，不需要显式状态
            # Summoned 状态必须被清除，否则后续的 Buffer Flush 会被错误地当作 Summoned 处理
            if session.state == "summoned":
                logger.info(f"[{session.session_id}] 正在将状态从 SUMMONED 重置为 OBSERVING。")
                session.state = "observing"

        except Exception as e:
            logger.error(f"handle_session_flush 错误: {e}", exc_info=True)
        finally:
            # 重置会话状态
            session.state = "observing"
            
            # Reset ContextVar token if set
            if 'token' in locals():
                injected_msg_ids_var.reset(token)

    async def _check_and_summarize_memory(self, session: SocialSession):
        """
        检查会话是否满足总结条件 (每 30 条未总结消息触发一次)
        """
        try:
            from .database import get_social_db_session
            from .models_db import QQMessage
            from .social_memory_service import SocialMemoryService
            from sqlmodel import select, col, func
            
            async for db_session in get_social_db_session():
                # 统计该会话未总结的消息数量
                statement = select(func.count(QQMessage.id)).where(
                    QQMessage.session_id == session.session_id,
                    QQMessage.session_type == session.session_type,
                    QQMessage.is_summarized == False
                )
                count = (await db_session.exec(statement)).one()
                
                if count >= 30:
                    logger.info(f"[{session.session_id}] 触发记忆总结 (未总结数量: {count})")
                    await self._perform_summarization(session, db_session)
                    
        except Exception as e:
            logger.error(f"_check_and_summarize_memory 错误: {e}")

    async def _perform_summarization(self, session: SocialSession, db_session):
        """
        执行记忆总结逻辑
        """
        try:
            from .models_db import QQMessage
            from sqlmodel import select, col
            
            # 1. 获取未总结的 30 条消息 (按时间正序)
            statement = select(QQMessage).where(
                QQMessage.session_id == session.session_id,
                QQMessage.session_type == session.session_type,
                QQMessage.is_summarized == False
            ).order_by(QQMessage.timestamp.asc()).limit(30)
            
            messages = (await db_session.exec(statement)).all()
            if not messages:
                return
                
            # 2. 构建 Prompt
            chat_text = ""
            for msg in messages:
                chat_text += f"{msg.sender_name}: {msg.content}\n"
                
            prompt = mdp.render("tasks/social/memory_segment_summarizer", {
                "session_type": session.session_type,
                "session_name": session.session_name,
                "chat_text": chat_text
            })
            
            # 3. 调用 LLM (实例化 LLMService)
            from services.llm_service import LLMService
            from models import Config, AIModelConfig
            from sqlmodel import select
            
            # 获取主数据库配置
            # 注意：social_db 是独立的，我们需要主数据库连接来获取 AIModelConfig
            from database import engine as main_engine
            from sqlmodel.ext.asyncio.session import AsyncSession as MainAsyncSession
            
            llm_service = None
            async with MainAsyncSession(main_engine) as main_session:
                # 尝试使用 Reflection 模型 (通常用于轻量级任务)
                configs = {c.key: c.value for c in (await main_session.exec(select(Config))).all()}
                model_id = configs.get("reflection_model_id")
                
                # 如果没有 Reflection 模型，尝试使用主模型
                if not model_id:
                    model_id = configs.get("model")
                
                if model_id:
                    model_config = await main_session.get(AIModelConfig, int(model_id))
                    if model_config:
                        llm_service = LLMService(
                            api_key=model_config.api_key,
                            api_base=model_config.api_base,
                            model=model_config.model_id, # [Fix] model_name -> model_id
                            provider=model_config.provider
                        )
            
            if not llm_service:
                logger.error("[Social] 初始化 LLMService 失败: 未找到有效的模型配置。")
                return

            # 使用 chat 接口
            response = await llm_service.chat(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            
            # 解析响应内容
            content = response["choices"][0]["message"]["content"]
            # 清理可能存在的 Markdown 代码块标记
            if content and content.startswith("```json"):
                content = content[7:]
            if content and content.endswith("```"):
                content = content[:-3]
            response_json_str = content.strip() if content else "{}"
            
            # 4. 解析结果
            try:
                data = json.loads(response_json_str)
                summary = data.get("summary", "")
                keywords = data.get("keywords", [])
                
                if summary:
                    # 5. 存入 SocialMemoryService
                    from .social_memory_service import SocialMemoryService
                    mem_service = SocialMemoryService()
                    
                    # 确保初始化
                    if not mem_service._initialized:
                        await mem_service.initialize()
                    
                    # 获取当前 Agent 名称作为 ID (默认 Pero)
                    agent_id = self.config_manager.get("bot_name", "Pero")

                    await mem_service.add_summary(
                        content=summary,
                        keywords=keywords,
                        session_id=session.session_id,
                        session_type=session.session_type,
                        msg_range=(messages[0].id, messages[-1].id),
                        agent_id=agent_id
                    )
                    
                    logger.info(f"[{session.session_id}] 记忆已总结: {summary} | 关键词: {keywords}")
                    
                    # 6. 标记消息为已总结
                    for msg in messages:
                        msg.is_summarized = True
                        db_session.add(msg)
                    await db_session.commit()
                    
            except json.JSONDecodeError:
                logger.error(f"解析总结 JSON 失败: {response_json_str}")
                
        except Exception as e:
            logger.error(f"执行总结时出错: {e}")

    async def send_msg(self, session: SocialSession, message: str):
        """
        通用发送消息助手
        """
        try:
            if session.session_type == "group":
                await self.send_group_msg(int(session.session_id), message)
            elif session.session_type == "private":
                await self.send_private_msg(int(session.session_id), message)
        except Exception as e:
            logger.error(f"发送消息到 {session.session_id} 失败: {e}")

    async def _send_api(self, action: str, params: Dict[str, Any]):
        if not self.active_ws:
            raise RuntimeError("No active Social Adapter connection.")
        
        # 简单的即发即弃（旧版支持，或者如果手动处理 echo）
        # 但我们要使用 UUID 作为 echo 以避免冲突
        import uuid
        echo_id = str(uuid.uuid4())
        
        payload = {
            "action": action,
            "params": params,
            "echo": echo_id
        }
        await self.active_ws.send_text(json.dumps(payload))
        return echo_id

    async def _send_api_and_wait(self, action: str, params: Dict[str, Any], timeout: int = 10) -> Dict[str, Any]:
        """
        发送 API 请求并等待响应。
        """
        if not self.active_ws:
            raise RuntimeError("No active Social Adapter connection.")
            
        import uuid
        echo_id = str(uuid.uuid4())
        
        payload = {
            "action": action,
            "params": params,
            "echo": echo_id
        }
        
        future = asyncio.get_running_loop().create_future()
        self.pending_requests[echo_id] = future
        
        await self.active_ws.send_text(json.dumps(payload))
        
        try:
            response = await asyncio.wait_for(future, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            if echo_id in self.pending_requests:
                del self.pending_requests[echo_id]
            raise TimeoutError(f"API {action} timed out.")

    async def send_group_msg(self, group_id: int, message: str):
        await self._send_api("send_group_msg", {"group_id": group_id, "message": message})
        
    async def send_private_msg(self, user_id: int, message: str):
        await self._send_api("send_private_msg", {"user_id": user_id, "message": message})
        
    async def handle_friend_request(self, flag: str, approve: bool, remark: str = ""):
        await self._send_api("set_friend_add_request", {"flag": flag, "approve": approve, "remark": remark})
        
    async def get_friend_list(self):
        """
        获取好友列表。
        """
        try:
            resp = await self._send_api_and_wait("get_friend_list", {})
            return resp.get("data", [])
        except Exception as e:
            logger.error(f"获取好友列表失败: {e}")
            return []

    async def get_group_list(self):
        """
        获取群列表。
        """
        try:
            resp = await self._send_api_and_wait("get_group_list", {})
            return resp.get("data", [])
        except Exception as e:
            logger.error(f"获取群列表失败: {e}")
            return []

    async def get_stranger_info(self, user_id: int):
        try:
            resp = await self._send_api_and_wait("get_stranger_info", {"user_id": user_id})
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取陌生人信息失败: {e}")
            return {"user_id": user_id, "nickname": "Unknown"}

    async def get_group_info(self, group_id: int):
        """
        获取群信息 (OneBot V11 Standard)
        """
        try:
            resp = await self._send_api_and_wait("get_group_info", {"group_id": group_id})
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取群信息失败: {e}")
            return {}

    async def get_group_member_info(self, group_id: int, user_id: int):
        """
        获取群成员信息 (OneBot V11 Standard)
        """
        try:
            resp = await self._send_api_and_wait("get_group_member_info", {"group_id": group_id, "user_id": user_id})
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取群成员信息失败: {e}")
            return {}

    async def get_group_msg_history(self, group_id: int, count: int = 20):
        """
        获取群消息历史记录。
        """
        # NapCatQQ/OneBot 11 可能使用 'get_group_msg_history'
        # 通常返回 'messages' 列表。
        try:
            # 首先，如果需要，尝试获取最新的消息 seq，
            # 但是如果未提供 seq，标准 get_group_msg_history 通常会处理 'latest'？
            # 让我们先尝试不带 seq 调用它。
            resp = await self._send_api_and_wait("get_group_msg_history", {"group_id": group_id})
            messages = resp.get("data", {}).get("messages", [])
            
            # 过滤/切片
            if messages:
                # 通常按时间顺序返回？还是倒序？
                # 通常是按时间顺序。我们需要最后 N 个。
                messages = messages[-count:]
                
            # 解析为可读格式
            result_text = f"--- 群组 {group_id} 历史记录 (最后 {len(messages)} 条) ---\n"
            for msg in messages:
                sender = msg.get("sender", {}).get("nickname", "未知")
                content = msg.get("raw_message", "") # 使用 raw 查看 CQ 码
                # 时间 = datetime.fromtimestamp(msg.get("time", 0)).strftime('%H:%M:%S')
                # 简单格式
                result_text += f"[{sender}]: {content}\n"
                
            return result_text
        except Exception as e:
            logger.error(f"获取群消息历史失败: {e}")
            return f"获取历史记录失败: {e}"

    async def read_memory(self, query: str, filter_str: str = ""):
         """
         读取社交记忆（从独立的 Social Database 搜索 QQMessage）
         Args:
             query: 搜索关键词
             filter_str: 可选过滤条件，格式为 "session_id:type" (例如 "123456:group")
         """
         try:
             from .social.database import get_social_db_session
             from .social.models_db import QQMessage
             from sqlmodel import select, col
             
             # Get injected IDs to exclude
             exclude_ids = injected_msg_ids_var.get()
             
             async for db_session in get_social_db_session():
                 # 基础查询：内容匹配
                 statement = select(QQMessage).where(col(QQMessage.content).contains(query))
                 
                 # 解析并应用过滤条件
                 if filter_str:
                     # 尝试解析 "session_id:type" 或仅 "session_id"
                     parts = filter_str.split(":")
                     if len(parts) >= 1 and parts[0]:
                         statement = statement.where(QQMessage.session_id == parts[0])
                     if len(parts) >= 2 and parts[1]:
                         statement = statement.where(QQMessage.session_type == parts[1])
                 
                 # [Deduplication] If we have IDs to exclude, we might need to fetch more and filter in Python
                 # because passing a large list to SQL NOT IN might be slow or hit limits.
                 # Given we only exclude ~30 IDs max, SQL NOT IN is fine.
                 if exclude_ids:
                     statement = statement.where(col(QQMessage.msg_id).notin_(exclude_ids))

                 # 排序和限制
                 statement = statement.order_by(QQMessage.timestamp.desc()).limit(10)
                 
                 results = (await db_session.exec(statement)).all()
                 
                 if not results:
                     return "No relevant social memories found in independent database."
                 
                 result_text = "Found Social Memories (Independent DB):\n"
                 for msg in results:
                     time_str = msg.timestamp.strftime("%Y-%m-%d %H:%M")
                     type_label = f"[{msg.session_type}]"
                     result_text += f"{type_label} [{time_str}] {msg.sender_name}: {msg.content}\n"
                     
                 return result_text
                 
         except Exception as e:
             logger.error(f"从独立数据库读取社交记忆错误: {e}")
             return f"Error: {e}"

    async def read_agent_memory(self, query: str):
        """
        读取 Agent (Master) 记忆。
        """
        try:
             async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
             async with async_session() as db_session:
                 # 在核心记忆中搜索（向量搜索）
                 memories = await MemoryService.get_relevant_memories(db_session, text=query, limit=5)
                 
                 if not memories:
                     return "No relevant agent memories found about Master."
                     
                 result_text = "Found Agent Memories (About Master):\n"
                 for m in memories:
                     result_text += f"- {m.content} (Importance: {m.importance})\n"
                     
                 return result_text
        except Exception as e:
            logger.error(f"读取 Agent 记忆错误: {e}")
            return f"Error: {e}"
         
    async def notify_master(self, content: str, importance: str):
        logger.info(f"[Social] 通知主人 [{importance}]: {content}")
        # 广播到前端
        try:
            # 如果可能，我们需要在方法内部导入 realtime_session_manager 以避免循环导入
            # 或者只是依赖 services 中的那个
            from services.realtime_session_manager import realtime_session_manager
            await realtime_session_manager.broadcast({
                "type": "text_response",
                "content": f"【社交汇报】\n{content}",
                "status": "report"
            })
        except ImportError:
            pass

        # 发送到主人 QQ（如果已配置并启用）
        if self.active_ws:
            owner_qq = self.config_manager.get("owner_qq")
            if owner_qq:
                try:
                    qq_num = int(owner_qq)
                    bot_name = self.config_manager.get("bot_name", "Pero")
                    await self.send_private_msg(qq_num, f"【{bot_name}汇报】\n{content}")
                    logger.info(f"[Social] 通知已发送给主人 QQ: {qq_num}")
                except Exception as e:
                    logger.error(f"[Social] 发送通知给主人 QQ 失败: {e}")

def get_social_service():
    if SocialService._instance is None:
        SocialService._instance = SocialService()
    return SocialService._instance
