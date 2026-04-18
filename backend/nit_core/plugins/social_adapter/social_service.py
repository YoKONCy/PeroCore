import asyncio
import base64
import json
import logging
import os
import random
import uuid
from contextlib import suppress
from contextvars import ContextVar
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Set

import aiofiles
from fastapi import WebSocket, WebSocketDisconnect

from core.config_manager import get_config_manager
from utils.workspace_utils import get_workspace_root

# ContextVar 用于去重
injected_msg_ids_var: ContextVar[Optional[Set[str]]] = ContextVar(
    "injected_msg_ids", default=None
)
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

# 数据库和 Agent 导入
from database import engine
from services.agent.agent_manager import AgentManager
from services.mdp.manager import mdp
from services.memory.memory_service import MemoryService

# ruff: noqa: E402
from .models import SocialSession
from .session_manager import SocialSessionManager

# from services.agent.agent_service import AgentService (移至方法内部)
# from services.core.prompt_service import PromptManager (移至方法内部以避免循环导入)

logger = logging.getLogger(__name__)

# 移除硬编码的 SOCIAL_SYSTEM_PROMPT，改用 PromptManager


class SocialService:
    _instance = None

    def __init__(self):
        self.config_manager = get_config_manager()
        # [重构] 将单个 active_ws 替换为连接池
        self.connections: Dict[str, WebSocket] = {}  # self_id -> WebSocket
        self.default_ws: Optional[WebSocket] = None  # 无 ID 连接的回退

        self.running = False
        self._enabled = self.config_manager.get("enable_social_mode", False)
        self._thought_task: Optional[asyncio.Task] = None

        # [社交身份] Bot 信息缓存 (映射: self_id -> 信息字典)
        self.bot_infos: Dict[str, Dict[str, Any]] = {}
        # [兼容性] 单 Bot 信息缓存
        self.bot_info: Dict[str, Any] = {}

        # [修复] 初始化表情包映射
        self._sticker_map: Dict[str, str] = {}
        self._sticker_base_dir: Optional[str] = None

        # [Agent 映射] 加载 Agent 配置以映射 QQ -> Agent
        self.qq_agent_map: Dict[str, str] = {}  # qq_id -> agent_id
        self._load_agent_mappings()

        # 初始化会话管理器
        self.session_manager = SocialSessionManager(
            flush_callback=self.handle_session_flush
        )

        # [修复] 初始化 pending_requests，防止同步 API 调用崩溃
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.last_connected_at: Optional[datetime] = None
        self.last_event_at: Optional[datetime] = None
        self.last_error: Optional[str] = None

    def _load_agent_mappings(self):
        """从所有 Agent 加载社交配置"""
        try:
            from services.agent.agent_manager import AgentManager

            # 我们需要一个临时实例来读取配置，或者使用静态方法（如果可用）。
            # 这里我们只实例化 AgentManager，它会在 __init__ 中加载配置
            am = AgentManager()
            for agent_id, agent in am.agents.items():
                # [修复] 支持 social_config (旧版/Tauri) 和 social_binding (新版配置文件)
                social_cfg = getattr(agent, "social_config", None) or getattr(
                    agent, "social_binding", None
                )
                if social_cfg and social_cfg.get("enabled") and social_cfg.get("qq_id"):
                    qq_id = str(social_cfg.get("qq_id"))
                    self.qq_agent_map[qq_id] = agent_id
                    logger.info(f"[Social] 已加载映射: QQ {qq_id} -> Agent {agent_id}")
        except Exception as e:
            logger.error(f"[Social] 加载 Agent 映射失败: {e}")

    def register_connection(self, self_id: Optional[str], websocket: WebSocket):
        """注册新的 WebSocket 连接"""
        self.last_connected_at = datetime.now()
        self.last_error = None
        if self_id:
            self.connections[str(self_id)] = websocket
            # 检查此 QQ 是否有 Agent 映射
            agent_id = self.qq_agent_map.get(str(self_id))
            if agent_id:
                logger.info(f"[Social] 已为 Agent {agent_id} 注册连接 (QQ: {self_id})")
            else:
                logger.warning(f"[Social] 已为 QQ {self_id} 注册连接，但未映射 AGENT！")
        else:
            self.default_ws = websocket
            logger.info("[Social] 已注册默认连接 (无 X-Self-ID)")

    def unregister_connection(self, self_id: Optional[str]):
        """注销 WebSocket 连接"""
        if self_id and str(self_id) in self.connections:
            del self.connections[str(self_id)]
            logger.info(f"[Social] 已注销 QQ 连接: {self_id}")
        elif self.default_ws:
            self.default_ws = None
            logger.info("[Social] 已注销默认连接")

    def record_error(self, error: Any):
        self.last_error = str(error)

    def clear_error(self):
        self.last_error = None

    def _mark_event(self):
        self.last_event_at = datetime.now()

    def _get_target_ws(self, self_id: Optional[str] = None) -> Optional[WebSocket]:
        if self_id and str(self_id) in self.connections:
            return self.connections[str(self_id)]
        if self.default_ws:
            return self.default_ws
        if self.connections:
            return next(iter(self.connections.values()))
        return None

    @property
    def active_ws(self):
        """向后兼容属性 - 返回第一个可用连接"""
        return self._get_target_ws()

    @active_ws.setter
    def active_ws(self, ws):
        """向后兼容设置器 - 设置默认连接"""
        self.default_ws = ws

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
            logger.debug("[Social] 独立社交数据库已初始化。")
        except Exception as e:
            logger.error(f"[Social] 初始化社交数据库失败: {e}")

        # [动态注册工具] 已移除：qq_notify_master 现在是 qq_tools.py 中的静态工具
        # 此处不需要再进行动态注入。

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

    async def check_daily_summary(self):
        """
        [Worker] 每日检查并生成社交日报
        """
        logger.info("[Social] 启动社交日报检查 Worker...")

        while self.running:
            try:
                # 1. 确定目标日期 (昨天)
                yesterday = datetime.now() - timedelta(days=1)
                date_str = yesterday.strftime("%Y-%m-%d")

                # 2. 获取所有相关的 Agent
                agent_ids = set(self.qq_agent_map.values())
                if not agent_ids:
                    agent_ids.add("pero")

                for agent_id in agent_ids:
                    await self._process_daily_summary_for_agent(agent_id, date_str)

                # 3. 每小时检查一次
                await asyncio.sleep(3600)

            except Exception as e:
                logger.error(f"[Social] 日报检查循环出错: {e}")
                await asyncio.sleep(600)

    async def _process_daily_summary_for_agent(self, agent_id: str, date_str: str):
        try:
            # 1. 检查文件/DB 是否已存在
            import os

            from sqlmodel import select

            from .database import get_social_db_session

            # A. 检查文件 (只检查文件，不查数据库)
            # 定位 workspace
            agent_workspace = get_workspace_root(agent_id)
            report_dir = os.path.join(agent_workspace, "social_reports")
            os.makedirs(report_dir, exist_ok=True)
            file_path = os.path.join(report_dir, f"{date_str}.md")

            if os.path.exists(file_path):
                # 文件已存在，跳过
                return

            logger.info(f"[Social] 正在为 {agent_id} 生成 {date_str} 的社交日报...")

            # 2. 获取消息记录
            from sqlmodel import and_

            from .models_db import QQMessage

            start_time = datetime.strptime(date_str, "%Y-%m-%d")
            end_time = start_time + timedelta(days=1)

            messages = []
            async for session in get_social_db_session():
                stmt = (
                    select(QQMessage)
                    .where(
                        and_(
                            QQMessage.timestamp >= start_time,
                            QQMessage.timestamp < end_time,
                            QQMessage.agent_id == agent_id,
                        )
                    )
                    .order_by(QQMessage.timestamp)
                )

                messages = (await session.exec(stmt)).all()
                break

            if not messages:
                logger.info(
                    f"[Social] {agent_id} 在 {date_str} 无消息记录，跳过日报生成。"
                )
                return

            # 3. 格式化上下文
            context_lines = []
            for msg in messages:
                sender = msg.sender_name or msg.sender_id
                time_str = msg.timestamp.strftime("%H:%M:%S")
                type_str = "Group" if msg.session_type == "group" else "Private"
                # 简单过滤过长消息
                content = (
                    msg.content[:500] + "..." if len(msg.content) > 500 else msg.content
                )
                context_lines.append(f"[{time_str}] [{type_str}] {sender}: {content}")

            context_text = "\n".join(context_lines)

            # 4. 调用 ScorerService 生成
            from sqlalchemy.orm import sessionmaker
            from sqlmodel.ext.asyncio.session import AsyncSession

            from database import engine
            from services.memory.scorer_service import ScorerService

            async_session_factory = sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )
            async with async_session_factory() as main_session:
                scorer = ScorerService(main_session)

                report_content = await scorer.generate_social_daily_report(
                    context_text=context_text,
                    date_str=date_str,
                    total_messages=len(messages),
                    agent_name=agent_id,
                )

            if not report_content:
                logger.warning(f"[Social] 日报生成返回空内容 ({agent_id}, {date_str})")
                return

            # 5. 保存结果
            # A. 保存到文件
            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(report_content)
                logger.info(f"[Social] 日报文件已保存: {file_path}")
            except Exception as e:
                logger.error(f"[Social] 保存日报文件失败: {e}")

            # [修改] 不再保存到数据库
            # try:
            #    ...
            # except: ...
            logger.info("[Social] 日报生成完成 (仅文件)。")

        except Exception as e:
            logger.error(f"[Social] 处理 {agent_id} 的日报失败: {e}", exc_info=True)

    async def handle_raw_event(self, raw_data: str):
        """
        处理来自 WebSocket 的原始 JSON 事件。
        """
        try:
            event = json.loads(raw_data)
            self._mark_event()

            # 处理 API 响应 (如果有 echo 字段)
            if "echo" in event:
                echo_id = event["echo"]
                if echo_id in self.pending_requests:
                    future = self.pending_requests.pop(echo_id)
                    if not future.done():
                        future.set_result(event)
                return

            # 1. 忽略心跳 meta_event
            post_type = event.get("post_type")
            if post_type == "meta_event":
                # 可以在这里更新心跳状态
                # self.last_heartbeat = datetime.now()
                return

            # 2. 消息事件
            if post_type == "message":
                await self._handle_message_event(event)

            # 3. 请求事件 (好友请求等)
            elif post_type == "request":
                await self._handle_request_event(event)

            # 4. 通知事件 (群成员变动等 - 可选)
            elif post_type == "notice":
                pass

        except json.JSONDecodeError:
            pass
        except Exception as e:
            self.record_error(e)
            logger.error(f"[Social] 处理事件失败: {e}")

    async def _handle_message_event(self, event: dict):
        # 1. 基础日志
        try:
            msg_type = event.get("message_type")  # group / private
            user_id = str(event.get("user_id"))
            self_id = str(event.get("self_id", ""))

            # [多 Agent] 确定此消息属于哪个 Agent
            agent_id = self.qq_agent_map.get(self_id)
            if not agent_id:
                # 回退: 如果是单连接或默认连接
                if not self.qq_agent_map:
                    # 默认为活跃 Agent 或 Pero？
                    # 理想情况下，在多 Agent 模式下，如果我们不知道它是给谁的，就不应该处理。
                    # 但为了向后兼容：
                    agent_id = "pero"  # Default
                else:
                    # 我们有映射，但此 QQ 未映射。忽略？
                    logger.debug(f"[Social] 忽略未映射 QQ 的消息: {self_id}")
                    return

            # 更新 Bot 自身 ID 信息
            if self_id not in self.bot_infos:
                self.bot_infos[self_id] = {"user_id": self_id}
                logger.info(f"[Social] 检测到新 Bot: {self_id} (Agent: {agent_id})")

            # 忽略自己发的消息
            # 检查此连接的特定 bot_id
            if user_id == self_id:
                return

            logger.debug(
                f"[Social] 处理消息事件: type={msg_type}, user={user_id} -> Agent: {agent_id}"
            )

            # 2. 转交 Session Manager 处理完整逻辑 (缓冲、持久化、触发)
            # [多 Agent] 传递 agent_id 上下文
            await self.session_manager.handle_message(event, agent_id=agent_id)

        except Exception as e:
            logger.error(f"[Social] 处理消息失败: {e}", exc_info=True)

    async def _handle_request_event(self, event: dict):
        req_type = event.get("request_type")
        if req_type == "friend":
            await self._handle_incoming_friend_request(event)

    async def _startup_check_worker(self):
        """
        等待 WS 连接，执行启动检查：
        1. 检查待处理的好友请求
        2. 复活历史会话 (冷启动)
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
        await asyncio.sleep(5)  # 等待系统稳定

        # 0. 获取 Bot 信息 (对于过滤自身消息至关重要)
        try:
            await self.get_bot_info()
        except Exception as e:
            logger.warning(f"[Social] 启动时获取 Bot 信息失败: {e}")

        # 1. 复活历史会话 (确保主动搭话功能可用)
        await self._revive_sessions_from_db()

        try:
            # [优化] 检测 OneBot 实现类型
            # NapCat 等现代实现通常不支持拉取历史系统消息，而是完全依赖事件推送。
            version_resp = await self._send_api_and_wait(
                "get_version_info", {}, timeout=5
            )
            if version_resp and version_resp.get("status") == "ok":
                data = version_resp.get("data", {})
                app_name = data.get("app_name", "").lower()
                logger.debug(
                    f"[Social] Bot 实现: {data.get('app_name')} {data.get('app_version')}"
                )

                if "napcat" in app_name:
                    logger.debug(
                        "[Social] 检测到 NapCat。跳过轮询待处理系统消息（事件驱动模式）。"
                    )
                    return

            # [修复] 尝试多种 API 变体以兼容不同的 OneBot 实现 (NapCat, LLOneBot, Go-CQHTTP)
            resp = None
            api_candidates = ["get_system_msg", "get_friend_system_msg"]

            for api_name in api_candidates:
                try:
                    candidate_resp = await self._send_api_and_wait(
                        api_name, {}, timeout=5
                    )

                    if (
                        candidate_resp
                        and candidate_resp.get("status") == "ok"
                        and candidate_resp.get("retcode") == 0
                    ):
                        resp = candidate_resp
                        logger.debug(f"[Social] 成功使用 API '{api_name}'")
                        break
                    elif candidate_resp and candidate_resp.get("retcode") == 1404:
                        # API 不存在
                        pass
                    else:
                        pass
                except Exception:
                    pass

            if not resp:
                logger.info(
                    "[Social] 启动检查跳过: 无法获取系统消息（API 不支持或超时）。"
                )
                return

            data = resp.get("data", {})
            requests = []

            # 处理标准 OneBot 11 格式变体
            if isinstance(data, list):
                requests = data
            elif isinstance(data, dict):
                requests = data.get("request", []) + data.get("requester", [])

            logger.debug(f"[Social] 启动时发现 {len(requests)} 条系统消息。")

            for req in requests:
                # 仅处理好友请求
                req_type = req.get("request_type")
                if req_type != "friend":
                    continue

                flag = req.get("flag")
                if not flag:
                    continue

                # 直接触发处理逻辑，增加延迟避免并发问题
                await self._handle_incoming_friend_request(req)
                await asyncio.sleep(5)

        except Exception as e:
            logger.error(f"[Social] 启动检查失败: {e}")

    async def get_connection_status(self) -> Dict[str, Any]:
        """
        获取 NapCat 连接状态 (双向检查)
        """
        # 如果 self.bot_infos 有数据，取第一个作为展示，或者返回 None
        bot_infos = list(self.bot_infos.values())
        first_bot_info = bot_infos[0] if bot_infos else (self.bot_info or None)

        status = {
            "ws_connected": False,
            "api_responsive": False,
            "bot_info": first_bot_info,
            "bot_infos": bot_infos,
            "latency_ms": -1,
            "connection_count": len(self.connections) + (1 if self.default_ws else 0),
            "connected_ids": list(self.connections.keys()),
            "last_connected_at": self.last_connected_at.isoformat()
            if self.last_connected_at
            else None,
            "last_event_at": self.last_event_at.isoformat()
            if self.last_event_at
            else None,
            "last_error": self.last_error,
        }

        # 检查是否有任何活动连接
        if self.connections or self.default_ws:
            status["ws_connected"] = True

            # 测试 API 响应
            start_time = datetime.now()
            try:
                # 使用 get_version_info 作为心跳检测
                # timeout 设置短一点，以免阻塞 UI 轮询
                # 尝试通过任意一个连接发送
                target_id = None
                if self.connections:
                    target_id = next(iter(self.connections.keys()))

                resp = await self._send_api_and_wait(
                    "get_version_info", {}, self_id=target_id, timeout=2
                )
                if resp and resp.get("status") == "ok":
                    self.clear_error()
                    status["api_responsive"] = True
                    # 计算延迟
                    latency = (datetime.now() - start_time).total_seconds() * 1000
                    status["latency_ms"] = int(latency)
            except Exception as e:
                self.record_error(e)
                # logger.warning(f"[Social] 状态检查失败: {e}")
                pass

        return status

    async def _revive_sessions_from_db(self):
        """
        [冷启动] 从数据库恢复最近活跃的会话到内存中。
        """
        logger.info("[Social] 正在从数据库恢复会话...")
        try:
            from sqlmodel import desc, select

            from .database import get_social_db_session
            from .models_db import QQMessage

            async for db_session in get_social_db_session():
                # 查询最近活跃的 100 条消息以提取活跃会话
                statement = (
                    select(QQMessage).order_by(desc(QQMessage.timestamp)).limit(100)
                )
                messages = (await db_session.exec(statement)).all()

                revived_count = 0
                processed_ids = set()

                for msg in messages:
                    if msg.session_id in processed_ids:
                        continue
                    processed_ids.add(msg.session_id)

                    if msg.session_id not in self.session_manager.sessions:
                        # 恢复会话
                        name = f"Session {msg.session_id}"
                        if msg.session_type == "private":
                            # 排除自己的消息
                            if (
                                msg.sender_id == "self"
                                or msg.sender_name
                                == self.config_manager.get("bot_name", "Pero")
                            ):
                                name = str(msg.session_id)
                            else:
                                name = msg.sender_name
                        elif msg.session_type == "group":
                            name = f"Group {msg.session_id}"

                        session = self.session_manager.get_or_create_session(
                            session_id=msg.session_id,
                            session_type=msg.session_type,
                            session_name=name,
                        )
                        session.last_active_time = msg.timestamp

                        # [修复] 复活的会话推迟扫描 (15~45分钟)，防止启动爆发
                        session.next_scan_time = datetime.now() + timedelta(
                            seconds=random.randint(900, 2700)
                        )

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
        [主 Worker] 协调并行的群聊扫描和私聊扫描。
        """
        logger.debug("[Social] 社交观察服务已启动。")

        await asyncio.gather(self._group_scan_loop(), self._private_scan_loop())

    async def _group_scan_loop(self):
        """
        [群聊] 群聊扫描循环
        全局单一计时器，随机选择活跃群聊进行观察。
        """
        logger.debug("[Social] 群聊扫描线程已启动。")
        while self.running:
            try:
                await asyncio.sleep(30)

                if not self.running or not self.enabled:
                    continue

                # 夜间静音 (00:00 - 08:00)
                now = datetime.now()
                if 0 <= now.hour < 8:
                    continue

                if not hasattr(self, "_next_group_thought_time"):
                    # 启动后延迟 5~10 分钟
                    self._next_group_thought_time = datetime.now() + timedelta(
                        seconds=random.randint(300, 600)
                    )

                if now < self._next_group_thought_time:
                    continue

                # 随机选择活跃群聊
                sessions = self.session_manager.get_active_sessions(
                    limit=5, session_type="group"
                )

                # 如果内存无会话，尝试从 DB 复活
                if not sessions:
                    revived = await self._revive_sessions_from_db()
                    if revived > 0:
                        sessions = self.session_manager.get_active_sessions(
                            limit=5, session_type="group"
                        )

                if not sessions:
                    # 无活跃会话，休眠较长时间
                    interval = random.randint(600, 1200)
                    self._next_group_thought_time = now + timedelta(seconds=interval)
                    continue

                target_session = random.choice(sessions)

                # 检查活跃状态 (120s 内互动过)
                time_since_active = (
                    now - target_session.last_active_time
                ).total_seconds()
                is_active = time_since_active < 120

                session_state = "active" if is_active else "observing"
                target_session.state = session_state

                logger.debug(
                    f"[Social-Group] 触发检查: {target_session.session_name} (状态: {session_state})"
                )

                spoke = False
                if is_active:
                    spoke = await self._perform_active_agent_response(
                        target_session, "ACTIVE_OBSERVATION"
                    )
                else:
                    spoke = await self._attempt_random_thought(target_session)

                    if spoke:
                        target_session.last_active_time = datetime.now()
                        target_session.state = "active"
                        logger.info(
                            f"[Social-Group] 主动发言成功，{target_session.session_name} 进入活跃状态。"
                        )

                # 决定下次检查时间
                if spoke:
                    interval = (
                        120 if is_active else random.randint(1800, 3600)
                    )  # 主动冒泡后进入贤者模式
                elif is_active:
                    interval = 60
                else:
                    interval = random.randint(1800, 3600)  # 潜水观察间隔

                self._next_group_thought_time = now + timedelta(seconds=interval)
                logger.debug(f"[Social-Group] 下次检查将在 {interval} 秒后。")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Social-Group] 错误: {e}", exc_info=True)
                self._next_group_thought_time = datetime.now() + timedelta(seconds=300)
                await asyncio.sleep(60)

    async def _private_scan_loop(self):
        """
        [私聊] 私聊扫描循环
        每个私聊对象有独立的时间表 (next_scan_time)。
        """
        logger.debug("[Social] 私聊扫描线程已启动。")
        while self.running:
            try:
                await asyncio.sleep(10)

                if not self.running or not self.enabled:
                    continue

                now = datetime.now()
                if 0 <= now.hour < 8:
                    continue

                # 获取前 20 个活跃私聊
                sessions = self.session_manager.get_active_sessions(
                    limit=20, session_type="private"
                )

                for session in sessions:
                    if now >= session.next_scan_time:
                        time_since_active = (
                            now - session.last_active_time
                        ).total_seconds()
                        is_active = time_since_active < 120

                        # 活跃期不主动 Double Text
                        if is_active:
                            session.next_scan_time = now + timedelta(seconds=60)
                            continue

                        logger.debug(
                            f"[Social-Private] 触发检查: {session.session_name}"
                        )
                        await self._attempt_random_thought(session)

                        # 私聊长周期 (4-8 小时)
                        next_interval = random.randint(14400, 28800)

                        session.next_scan_time = now + timedelta(seconds=next_interval)
                        logger.debug(
                            f"[Social-Private] {session.session_name} 下次检查在 {next_interval // 3600} 小时后。"
                        )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Social-Private] 错误: {e}", exc_info=True)
                await asyncio.sleep(60)

    def _clean_cq_codes(self, content: str) -> str:
        """
        清理消息内容中的 CQ 码，将其转换为人类可读的文本标签。
        """
        if "[CQ:" not in content:
            return content

        import re

        # --- 图片助手 ---
        def replace_cq_image(match):
            full_tag = match.group(0)
            summary_match = re.search(r"summary=\[(.*?)\]", full_tag)
            if not summary_match:
                summary_match = re.search(r"summary=([^,\]]+)", full_tag)

            if summary_match:
                summary_text = summary_match.group(1)
                summary_text = (
                    summary_text.replace("&#91;", "[")
                    .replace("&#93;", "]")
                    .replace("&amp;", "&")
                )

                if summary_text.startswith("[") and summary_text.endswith("]"):
                    return summary_text
                return f"[{summary_text}]"
            return "[图片]"

        # --- 文件助手 ---
        def replace_cq_file(match):
            full_tag = match.group(0)

            name_match = re.search(r"name=([^,\]]+)", full_tag)
            file_match = re.search(r"file=([^,\]]+)", full_tag)

            filename = "未知文件"
            if name_match:
                filename = name_match.group(1)
            elif file_match:
                filename = file_match.group(1)

            return f"[文件: {filename}]"

        content = re.sub(r"\[CQ:image,[^\]]*\]", replace_cq_image, content)
        content = re.sub(r"\[CQ:file,[^\]]*\]", replace_cq_file, content)

        return content

    async def _attempt_random_thought(
        self, target_session: Optional[SocialSession] = None
    ) -> bool:
        """
        主动消息传递逻辑（秘书层）。
        由 _random_thought_worker 调用（随机目标）或 handle_session_flush 调用（指定目标）。
        """
        # [修复] 夜间静音 (00:00 - 08:00) - 防止 flush 触发的潜水观察在深夜运行
        now = datetime.now()
        if 0 <= now.hour < 8:
            # logger.debug("[Social] 深夜模式 (00:00-08:00)，秘书停止观察。")
            return False

        # 1. 确定目标
        if not target_session:
            sessions = self.session_manager.get_active_sessions(limit=5)
            if not sessions:
                return False
            target_session = random.choice(sessions)

        logger.debug(
            f"[Social] 秘书正在观察 {target_session.session_name} ({target_session.session_id})..."
        )

        # 计算会话状态
        now = datetime.now()
        time_since_active = (now - target_session.last_active_time).total_seconds()
        session_state = "ACTIVE" if time_since_active < 120 else "DIVE"

        # 2. 构建提示 (Secretary Persona)
        async_session = sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        async with async_session() as db_session:
            # 局部导入以避免循环依赖
            from services.agent.agent_manager import AgentManager

            agent_manager = AgentManager()

            # 上下文获取逻辑 (limit 100)
            memory_config = self.config_manager.get_json("memory_config")
            social_config = memory_config.get("modes", {}).get("social", {})
            history_limit = social_config.get("context_limit", 100)

            recent_messages = await self.session_manager.get_recent_messages(
                target_session.session_id,
                target_session.session_type,
                limit=history_limit,
            )

            if not recent_messages:
                recent_messages = target_session.buffer[-5:]

            recent_context = ""
            for msg in recent_messages:
                # [修复] 使用 target_session.agent_id
                agent_profile = agent_manager.agents.get(target_session.agent_id)
                current_agent_name = (
                    agent_profile.name
                    if agent_profile
                    else self.config_manager.get("bot_name", "Pero")
                )

                # [修复] 发送者身份判断逻辑
                # 1. 检查 sender_id 是否为 "self" (Agent 刚发出的消息)
                # 2. 检查 sender_id 是否为当前 Bot 的 QQ 号 (从 DB 恢复的历史记录)
                is_bot = (
                    msg.sender_id == "self"
                    or msg.sender_id in self.bot_infos
                    or (
                        self.bot_info
                        and msg.sender_id == str(self.bot_info.get("user_id"))
                    )
                )

                if is_bot:
                    sender_display = f"Me ({current_agent_name})"
                else:
                    # [修复] 优先显示用户名而非 QQ 号
                    sender_display = msg.sender_name or f"User({msg.sender_id})"

                clean_content = self._clean_cq_codes(msg.content)
                msg_time = ""
                if hasattr(msg, "timestamp") and msg.timestamp:
                    msg_time = f" ({msg.timestamp.strftime('%m-%d %H:%M')})"

                recent_context += f"[{sender_display}]{msg_time}: {clean_content}\n"

            if not recent_context:
                recent_context = "(本地缓存为空)"

            # 秘书人设 Prompt
            self.config_manager.get("owner_qq") or "未知"
            session_type_str = (
                "群聊 (Group)"
                if target_session.session_type == "group"
                else "私聊 (Private)"
            )
            bot_name = self.bot_info.get(
                "nickname", self.config_manager.get("bot_name", "Pero")
            )

            template_name = "social/decisions/secretary_decision_group"
            rules_template_name = "social/decisions/secretary_decision_group_rules"
            if target_session.session_type == "private":
                template_name = "social/decisions/secretary_decision_private"
                rules_template_name = (
                    "social/decisions/secretary_decision_private_rules"
                )

            target_name = target_session.session_name
            # [修复] 使用 target_session.agent_id
            agent_profile = agent_manager.agents.get(target_session.agent_id)

            if agent_profile:
                bot_name = agent_profile.name

            prompt_context = {
                "agent_name": bot_name,
                "current_time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "session_state": session_state,
                "session_type_str": session_type_str,
                "target_session_name": target_name,
                "custom_persona": agent_profile.social_custom_persona
                if agent_profile
                else "",
                "recent_history": recent_context,  # [修复] 注入历史上下文！
            }

            prompt = mdp.render(template_name, prompt_context)
            rules_prompt = mdp.render(rules_template_name, prompt_context)

            from services.agent.agent_service import AgentService

            agent = AgentService(db_session)

            config = await agent._get_llm_config()
            from services.core.llm_service import LLMService

            llm = LLMService(
                api_key=config.get("api_key"),
                api_base=config.get("api_base"),
                model=config.get("model"),
            )

            # [多模态] 收集最近的图片
            processed_images = []
            if config.get("enable_vision"):
                for msg in reversed(target_session.buffer):
                    if msg.images:
                        for img_path in msg.images:
                            if os.path.exists(img_path):
                                try:
                                    async with aiofiles.open(img_path, "rb") as f:
                                        img_data = await f.read()
                                        b64_data = base64.b64encode(img_data).decode(
                                            "utf-8"
                                        )
                                        mime_type = "image/jpeg"
                                        if img_path.endswith(".png"):
                                            mime_type = "image/png"
                                        elif img_path.endswith(".gif"):
                                            mime_type = "image/gif"

                                        data_url = f"data:{mime_type};base64,{b64_data}"
                                        processed_images.append(data_url)
                                        if len(processed_images) >= 2:
                                            break
                                except Exception as e:
                                    logger.error(
                                        f"[Social] Secretary 读取图片失败: {e}"
                                    )
                    if len(processed_images) >= 2:
                        break

                processed_images.reverse()

            # 构造消息
            user_content_payload = [{"type": "text", "text": "Decision?"}]

            if processed_images:
                logger.debug(
                    f"[Social] Secretary 发现 {len(processed_images)} 张图片，注入上下文。"
                )
                for img_url in processed_images:
                    user_content_payload.append(
                        {"type": "image_url", "image_url": {"url": img_url}}
                    )

            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content_payload},
                {"role": "system", "content": rules_prompt},
            ]

            # 执行 LLM 调用 (纯文本模式)
            try:
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
                            return False
                        await asyncio.sleep(1)

                if not response:
                    return False

                response_msg = response["choices"][0]["message"]
                content = response_msg.get("content", "").strip()

                # [鲁棒性] 输出清洗
                if (content.startswith('"') and content.endswith('"')) or (
                    content.startswith("'") and content.endswith("'")
                ):
                    content = content[1:-1].strip()

                import re

                pattern = (
                    r"^("
                    + re.escape(current_agent_name)
                    + r"|Me|Reply|Answer|Decision):\s*"
                )
                content = re.sub(pattern, "", content, flags=re.IGNORECASE).strip()

                if content.upper() in ["PASS", "IGNORE", "NONE", "NULL", "NO"]:
                    logger.debug(
                        f"[Social] 秘书决定不说话 (PASS)。原因/内容: {content}"
                    )
                    return False

                if not content:
                    return False

                # 幻觉代码抑制
                if "```" in content or "<tool_code>" in content or "def " in content:
                    logger.warning(
                        f"[Social] 秘书产生幻觉代码/工具，已抑制。内容: {content}"
                    )
                    return False

                # 4. 说话！
                logger.debug(f"[Social] 秘书决定发言: {content}")
                await self.send_msg(target_session, content)

                self._next_thought_time = datetime.now() + timedelta(seconds=120)

                # 持久化
                sender_name = bot_name
                await self.session_manager.persist_outgoing_message(
                    target_session.session_id,
                    target_session.session_type,
                    content,
                    sender_name=sender_name,
                    agent_id=target_session.agent_id,
                )
                return True
            except Exception as e:
                logger.error(f"[Social] 秘书错误: {e}", exc_info=True)
                return False

    async def stop(self):
        self.running = False
        if self._thought_task:
            self._thought_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._thought_task
            self._thought_task = None

        if self.active_ws:
            await self.active_ws.close()
            self.active_ws = None
        logger.info("社交服务已停止。")

    async def handle_websocket(self, websocket: WebSocket):
        if not self.enabled:
            await websocket.close(code=1000, reason="社交模式已禁用")
            return

        await websocket.accept()
        self.active_ws = websocket
        logger.info("社交适配器已通过 WebSocket 连接。")

        try:
            while True:
                # [隔离检查] 在每次循环迭代中重新检查启用状态
                if not self.enabled:
                    logger.warning("运行时社交模式已禁用。正在关闭连接。")
                    await websocket.close(code=1000, reason="社交模式已禁用")
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
                        continue  # 不作为事件处理

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
            return  # 忽略心跳日志

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
                duration = event.get("duration", 0)  # seconds

                # 检查是否是 Pero 被禁言
                self_id = (
                    self.bot_info.get("user_id")
                    if hasattr(self, "bot_info") and self.bot_info
                    else ""
                )

                if user_id == self_id:
                    if sub_type == "ban":
                        logger.warning(
                            f"[社交通知] Pero 在群 {group_id} 被 {operator_id} 禁言了 {duration} 秒。"
                        )
                        # 通知主人
                        await self.notify_master(
                            f"【被禁言通知】\n我在群 {group_id} 被 {operator_id} 禁言了 {duration} 秒。QAQ",
                            "high",
                        )
                        # 记录系统消息
                        await self.session_manager.persist_system_notification(
                            group_id,
                            "group",
                            f"[System] You have been MUTED by {operator_id} for {duration} seconds.",
                            event,
                        )
                    elif sub_type == "lift_ban":
                        logger.info(f"[社交通知] Pero 在群 {group_id} 的禁言已解除。")
                        await self.notify_master(
                            f"【解禁通知】\n我在群 {group_id} 的禁言已解除。", "normal"
                        )
                        await self.session_manager.persist_system_notification(
                            group_id,
                            "group",
                            "[System] Your mute has been LIFTED.",
                            event,
                        )
                else:
                    # 别人被禁言，只记录到上下文，供 Pero 吃瓜
                    action = "muted" if sub_type == "ban" else "unmuted"
                    msg = f"[System] User {user_id} was {action} by {operator_id}."
                    if sub_type == "ban":
                        msg += f" Duration: {duration}s."

                    await self.session_manager.persist_system_notification(
                        group_id, "group", msg, event
                    )

            # 2. 消息撤回 (group_recall / friend_recall)
            elif notice_type == "group_recall":
                group_id = str(event.get("group_id"))
                operator_id = str(event.get("operator_id"))
                user_id = str(event.get("user_id"))  # Message sender

                logger.info(
                    f"[社交通知] 群 {group_id} 消息已撤回。操作者: {operator_id}, 发送者: {user_id}"
                )

                msg = (
                    f"[System] A message from {user_id} was recalled by {operator_id}."
                )
                await self.session_manager.persist_system_notification(
                    group_id, "group", msg, event
                )

            elif notice_type == "friend_recall":
                user_id = str(event.get("user_id"))

                logger.info(f"[社交通知] 私聊消息已由 {user_id} 撤回。")

                msg = f"[System] {user_id} recalled a message."
                await self.session_manager.persist_system_notification(
                    user_id, "private", msg, event
                )

        except Exception as e:
            logger.error(f"[社交] 处理通知事件失败: {e}", exc_info=True)

    async def get_bot_info(self):
        """获取 Bot 自身信息 (OneBot v11)"""
        if not self.active_ws:
            return

        request_id = str(uuid.uuid4())
        payload = {"action": "get_login_info", "params": {}, "echo": request_id}

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
                    "user_id": str(data.get("user_id", "")),
                }
                if self.bot_info["user_id"]:
                    self.bot_infos[self.bot_info["user_id"]] = dict(self.bot_info)
                logger.info(f"[Social] Bot 信息已更新: {self.bot_info}")

                # [修复] 同步 Bot ID 到 SessionManager 以过滤消息
                if self.bot_info["user_id"]:
                    self.session_manager.set_bot_id(self.bot_info["user_id"])
        except Exception as e:
            self.record_error(e)
            logger.error(f"[Social] 获取 Bot 信息失败: {e}")
            # 如需清理，虽然 pop 发生在 handle_websocket 中
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
            from services.agent.agent_service import AgentService

            async_session = sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )
            async with async_session() as db_session:
                agent = AgentService(db_session)
                config = await agent._get_llm_config()

                # 构建提示（中文）
                # 获取助手配置以动态注入人设
                from services.agent.agent_manager import AgentManager

                agent_manager = AgentManager()
                agent_profile = agent_manager.agents.get(agent_manager.active_agent_id)

                bot_name = (
                    agent_profile.name
                    if agent_profile
                    else self.config_manager.get("bot_name", "Pero")
                )

                if agent_profile:
                    bot_name = agent_profile.name

            prompt = mdp.render(
                "social/decisions/friend_request_decision",
                {
                    "agent_name": bot_name,
                    "user_id": user_id,
                    "comment": comment,
                    "custom_persona": agent_profile.social_custom_persona
                    if agent_profile
                    else "",
                },
            )

            messages = [{"role": "system", "content": prompt}]

            from services.core.llm_service import LLMService

            llm = LLMService(
                api_key=config.get("api_key"),
                api_base=config.get("api_base"),
                model=config.get("model"),
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
                    "notify_master": f"收到好友申请({user_id})，自动处理结果未知，已转为搁置。",
                }

            decision = result.get("decision", "HOLD").upper()
            notify_msg = result.get("notify_master", "")
            greeting = result.get("greeting_message", "")

            logger.debug(
                f"[Social] 好友请求决定: {decision}, 通知: {notify_msg}, 问候: {greeting}"
            )

            if decision == "HOLD":
                # 延迟处理
                # 我们不调用 handle_friend_request。只通知主人。
                # OneBot 11 请求标志在处理或超时之前有效（通常很长）。
                # 我们应该持久化这个待处理的请求，以便我们以后可以手动或通过命令处理它。

                # 持久化为可以查询的特殊记忆/日志？
                # 或者只是依靠主人看到通知并告诉 Pero “批准好友请求 X”。
                # 目前，我们通知主人并记录下来。

                if not notify_msg:
                    notify_msg = (
                        f"收到好友申请({user_id})，备注: {comment}。我拿不准，请指示。"
                    )

                await self.notify_master(
                    f"【搁置好友申请】({user_id}):\n{notify_msg}\nFlag: {flag}", "high"
                )

                # 记录为 PENDING
                await MemoryService.save_log(
                    session=db_session,
                    source="social_event",
                    session_id=str(user_id),
                    role="system",
                    content=f"搁置好友申请。备注：{comment}。理由：{result.get('reason', '拿不准')}。Flag: {flag}",
                    metadata={
                        "type": "friend_request",
                        "status": "PENDING",
                        "flag": flag,
                        "user_id": user_id,
                        "comment": comment,
                    },
                )
                await db_session.commit()

            else:
                # 批准或拒绝
                approve = decision == "APPROVE"

                # 2. 执行决定
                await self.handle_friend_request(flag, approve)

                # 3. 通知主人（如果需要）
                if notify_msg:
                    # 明确通知主人，而不是申请人
                    await self.notify_master(
                        f"好友申请处理 ({user_id}):\n{notify_msg}\n(处理结果: {'通过' if approve else '拒绝'})",
                        "medium",
                    )

                # 4. [新增] 如果通过，主动打招呼
                if approve and greeting:
                    # 延迟 2-5 秒模拟真人反应
                    await asyncio.sleep(random.randint(2, 5))
                    try:
                        # 确保 user_id 是 int
                        target_id = int(user_id)
                        await self.send_private_msg(target_id, greeting)
                        logger.debug(
                            f"[Social] 向新朋友 {user_id} 发送问候: {greeting}"
                        )

                        # 记录 Pero 的打招呼内容
                        await MemoryService.save_log(
                            session=db_session,
                            source="qq_private",
                            session_id=str(user_id),
                            role="assistant",
                            content=greeting,
                            metadata={
                                "sender_name": "Pero",
                                "platform": "qq",
                                "type": "greeting",
                            },
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
                    metadata={
                        "type": "friend_request",
                        "approved": approve,
                        "status": "HANDLED",
                    },
                )
                await db_session.commit()

        except Exception as e:
            logger.error(f"[Social] 处理好友请求错误: {e}", exc_info=True)

    async def delete_friend(self, user_id: int):
        """
        删除好友。
        """
        await self._send_api("delete_friend", {"user_id": user_id})
        logger.debug(f"[Social] 好友 {user_id} 已删除。")

    async def _perform_active_agent_response(
        self,
        session: SocialSession,
        current_mode: str = "ACTIVE_OBSERVATION",
        extra_images: list = None,
        user_text_context: str = None,
    ) -> bool:
        """
        [Action Layer] 直接调用 Agent 进行思考和回复。
        用于 Active 状态下的即时响应（消息触发或主动触发）。

        Args:
            session: 目标会话
            current_mode: "SUMMONED" 或 "ACTIVE_OBSERVATION"
            extra_images: 也就是 session.buffer 中的图片，用于 Vision 分析
            user_text_context: 用户发送的文本内容 (如果有)

        Returns:
            bool: 是否发送了消息
        """
        logger.debug(
            f"[{session.session_id}] _perform_active_agent_response 开始执行。"
        )
        spoke = False

        # [Preemption] 注册当前任务到 Session
        session.active_response_task = asyncio.current_task()

        try:
            # [Scheme 2] 强制延迟 0.5s，给数据库写入留出喘息时间，释放文件锁
            # [调试] 检查 sleep 是否卡死
            logger.debug(f"[{session.session_id}] 正在休眠 0.5s 以等待数据库写入...")
            await asyncio.sleep(0.5)
            logger.debug(f"[{session.session_id}] 休眠结束。")

            # 1. 构建 XML 上下文
            memory_config = self.config_manager.get_json("memory_config")
            social_config = memory_config.get("modes", {}).get("social", {})
            history_limit = social_config.get("context_limit", 100)

            # 高级配置
            advanced_config = social_config.get("advanced", {})
            cross_context_users = advanced_config.get("cross_context_users", 3)
            cross_context_history = advanced_config.get("cross_context_history", 10)
            image_limit = min(advanced_config.get("image_limit", 2), 4)

            logger.debug(f"[{session.session_id}] 获取最近消息历史...")
            # 获取历史记录
            # [修复] 添加超时检测卡死
            try:
                # [Scheme 3] 内存优先 + 数据库补充
                # 先尝试从数据库获取，如果超时或失败，不再阻塞流程，而是使用 Buffer 降级
                # 超时时间设为 2s，避免让用户等太久
                recent_messages = await asyncio.wait_for(
                    self.session_manager.get_recent_messages(
                        session.session_id, session.session_type, limit=history_limit
                    ),
                    timeout=2.0,
                )
                logger.debug(
                    f"[{session.session_id}] 获取到 {len(recent_messages)} 条历史消息。"
                )
            except asyncio.TimeoutError:
                logger.error(
                    f"[{session.session_id}] 获取最近消息历史超时 (2s)！启用内存降级策略。"
                )
                recent_messages = []
            except Exception as e:
                logger.error(
                    f"[{session.session_id}] 获取最近消息历史失败: {e}。启用内存降级策略。"
                )
                recent_messages = []

            # [Scheme 3 Implementation] 如果数据库读取失败（空），强制合并 Buffer
            # 注意：如果数据库读取成功，理论上它包含了 Buffer 里的消息（因为已经 persist 了）
            # 但为了保险起见，如果数据库返回空，我们必须把 session.buffer 接上去
            if not recent_messages and session.buffer:
                logger.warning(
                    f"[{session.session_id}] 数据库历史为空或超时，使用内存 Buffer 构建上下文。"
                )
                recent_messages = list(session.buffer)  # 浅拷贝

            # [增强] 获取相关私聊上下文（跨上下文感知）
            if not recent_messages:
                # logger.warning(f"[{session.session_id}] 数据库历史记录为空，回退到缓冲区。")
                recent_messages = session.buffer

            # [增强] 获取相关私聊上下文（跨上下文感知）
            private_contexts = {}  # user_id -> list[SocialMessage]
            injected_ids = set()  # For deduplication

            # 1. 从最近 10 条消息中识别相关用户
            relevant_users = []
            seen_users = set()

            # 检查最后 N 条消息（如果不够则更少）
            scan_limit = cross_context_history  # 复用历史记录限制作为扫描范围
            scan_range = (
                recent_messages[-scan_limit:]
                if len(recent_messages) >= scan_limit
                else recent_messages
            )

            # Self ID
            my_id = (
                self.bot_info.get("user_id")
                if hasattr(self, "bot_info") and self.bot_info
                else ""
            )

            # 逆序扫描（最新的优先）
            for msg in reversed(scan_range):
                uid = str(msg.sender_id)
                # 过滤: 非自身、非系统、非重复，限制 3 个
                # [修复] 在私聊中排除当前会话用户以避免冗余和潜在死锁
                is_current_session_user = (
                    session.session_type == "private" and uid == str(session.session_id)
                )

                if (
                    uid
                    and uid != my_id
                    and uid != "system"
                    and uid not in seen_users
                    and not is_current_session_user
                    and uid.isdigit()
                ):
                    relevant_users.append(uid)
                    seen_users.add(uid)
                    if len(relevant_users) >= cross_context_users:
                        break

            logger.debug(f"[{session.session_id}] 发现相关用户: {relevant_users}")

            # 2. 获取这些用户的私聊历史
            if relevant_users:
                logger.debug(
                    f"[{session.session_id}] 正在获取相关私聊上下文: {relevant_users}"
                )

                # 使用并发获取以提高速度，并增加超时保护
                async def fetch_private_safe(uid):
                    try:
                        # 增加 2 秒超时，避免获取私聊历史卡死主流程
                        return uid, await asyncio.wait_for(
                            self.session_manager.get_recent_messages(
                                uid, "private", limit=cross_context_history
                            ),
                            timeout=2.0,
                        )
                    except Exception as e:
                        logger.warning(f"获取 {uid} 的私聊上下文失败或超时: {e}")
                        return uid, []

                # 并发执行
                tasks = [fetch_private_safe(uid) for uid in relevant_users]
                if tasks:
                    results = await asyncio.gather(*tasks)
                    for uid, p_msgs in results:
                        if p_msgs:
                            private_contexts[uid] = p_msgs
                            for pm in p_msgs:
                                injected_ids.add(str(pm.msg_id))

            # 设置 ContextVar 用于工具去重
            token = injected_msg_ids_var.set(injected_ids)

            xml_context = "<social_context>\n"

            # 3. 注入私聊上下文
            if private_contexts:
                xml_context += "  <related_private_contexts>\n"
                for uid, p_msgs in private_contexts.items():
                    p_name = f"User{uid}"
                    if p_msgs:
                        for m in p_msgs:
                            if str(m.sender_id) == uid:
                                p_name = m.sender_name
                                break

                    xml_context += (
                        f'    <session type="private" id="{uid}" name="{p_name}">\n'
                    )
                    # [修复] 去重: 不注入已存在于 recent_messages 中的消息
                    # 当我们获取当前用户的跨上下文历史时可能发生（虽然不应该，但以防万一） case)
                    # 或者数据获取逻辑存在重叠

                    current_session_msg_ids = {str(m.msg_id) for m in recent_messages}

                    for pm in p_msgs:
                        if str(pm.msg_id) in current_session_msg_ids:
                            continue

                        content = self._clean_cq_codes(pm.content)
                        xml_context += f'      <msg sender="{pm.sender_name}" sender_id="{pm.sender_id}" id="{pm.msg_id}" time="{pm.timestamp.strftime("%H:%M:%S")}">{content}</msg>\n'
                    xml_context += "    </session>\n"
                xml_context += "  </related_private_contexts>\n"

            # 4. [增强] 注入相关群组上下文（用于私聊）
            # 只有在私聊模式下，才去寻找最近活跃的群上下文
            if session.session_type == "private":
                latest_group_id = await self.session_manager.get_latest_active_group(
                    session.session_id
                )
                if latest_group_id:
                    logger.debug(
                        f"[{session.session_id}] 发现最近活跃群聊: {latest_group_id}，正在获取上下文..."
                    )
                    try:
                        # 获取群组历史（限制 10 条）
                        # 这里我们不需要太复杂的并发，因为只有一个群
                        group_msgs = await self.session_manager.get_recent_messages(
                            latest_group_id, "group", limit=cross_context_history
                        )

                        if group_msgs:
                            xml_context += "  <related_group_contexts>\n"
                            # 为了节省 token，我们简化群聊上下文的格式，不使用详细的 per-msg 标签
                            # 而是合并为一个大的 block，或者简化标签
                            xml_context += f'    <session type="group" id="{latest_group_id}" name="Recent Group Context">\n'

                            for gm in group_msgs:
                                # 跳过重复项（跨会话类型不太可能，但属于良好实践）
                                if str(gm.msg_id) in injected_ids:
                                    continue

                                # 处理图片 CQ 码
                                content = self._clean_cq_codes(gm.content)

                                # 简化格式: 时间 用户: 内容
                                time_str = gm.timestamp.strftime("%H:%M")
                                xml_context += (
                                    f"      [{time_str}] {gm.sender_name}: {content}\n"
                                )
                                injected_ids.add(str(gm.msg_id))  # 添加到去重集合

                            xml_context += "    </session>\n"
                            xml_context += "  </related_group_contexts>\n"

                    except Exception as e:
                        logger.error(f"获取群聊上下文失败: {e}")

            xml_context += "  <recent_messages>\n"
            xml_context += f'    <session type="{session.session_type}" id="{session.session_id}" name="{session.session_name}">\n'

            # 使用加载的历史记录构建上下文
            for msg in recent_messages:
                content = self._clean_cq_codes(msg.content)
                img_tag = ""

                xml_context += f'      <msg sender="{msg.sender_name}" sender_id="{msg.sender_id}" id="{msg.msg_id}" time="{msg.timestamp.strftime("%H:%M:%S")}">{content}{img_tag}</msg>\n'

            # [多模态增强] 从最近历史（最后 2 轮）+ 缓冲区收集图片
            # 确保 Pero 能看到触发前发送的图片
            history_images = []
            if recent_messages:
                # 根据 image_limit 检查历史中的最后 N 条消息
                for msg in recent_messages[-image_limit:]:
                    # 提取图片 CQ 码
                    import re

                    # 匹配 [CQ:image,file=...,url=...] 的模式
                    # 优先使用 'url'，否则使用 'file'（本地路径或文件名）
                    # 注意: models_db 存储的 'content' 包含 CQ 码
                    # Standard OneBot CQ: [CQ:image,file=http://...,url=...] or [CQ:image,file=abc.jpg,url=...]

                    # 正则捕获 url 或 file
                    # 优先查找 'url' 参数
                    cq_matches = re.finditer(r"\[CQ:image,.*?\]", msg.content)
                    for match in cq_matches:
                        full_tag = match.group(0)

                        # 提取 URL
                        url_match = re.search(r"url=([^,\]]+)", full_tag)
                        if url_match:
                            history_images.append(url_match.group(1))
                            continue

                        # 如果没有 URL，尝试 file（可能是 URL 或文件名）
                        file_match = re.search(r"file=([^,\]]+)", full_tag)
                        if file_match:
                            val = file_match.group(1)
                            if val.startswith("http"):
                                history_images.append(val)
                            # 如果是文件名，可能需要通过 ImageCacheManager 解析
                            # 但没有原始 URL 重建哈希路径很困难
                            # 目前优先使用历史中发现的 URL

            # 合并历史图片和缓冲区图片
            # 缓冲区图片 (extra_images) 已经是本地路径或 URL
            # 历史图片是从 CQ 码提取的 URL。未缓存时需要下载吗？
            # 在此上下文中传 URL 给 LLM，或更好地使用本地缓存

            # [Optimization] 限制图片数量，防止上下文过大
            # 逻辑: 缓冲区图片（最新）> 历史图片（较旧）
            # 保留最新的图片，最多 2 张

            all_potential_images = history_images + (extra_images or [])
            session_images = []

            if all_potential_images:
                # 取最后 2 张（最新的）
                if len(all_potential_images) > 2:
                    dropped_count = len(all_potential_images) - 2
                    logger.debug(
                        f"[Social] 发现 {len(all_potential_images)} 张图片 (历史+缓冲)，丢弃旧的 {dropped_count} 张。保留最后 2 张。"
                    )
                    session_images = all_potential_images[-2:]
                else:
                    session_images = all_potential_images

                # 确保历史图片（URL）被正确处理
                # 如果是 URL，下游逻辑处理下载/base64 转换？
                # 下游逻辑（第 1448+ 行）检查 `os.path.exists(img_path)`
                # 如果是 URL，进入 `else` 分支（第 1463 行）
                # `else` 分支跳过不兼容的 URL (multimedia.nt.qq.com.cn 等) 但添加其他 URL
                # 因此如果历史中有有效的 http URL，会作为 `image_url` 传给 LLM
                # 如果历史中有不支持的 URL，则跳过
                # 如果历史中有本地路径（CQ 码中不太可能，除非修改了数据库），则加载

            xml_context += "    </session>\n"
            xml_context += "  </recent_messages>\n"

            xml_context += "</social_context>"

            # [优化] 上下文为空时跳过
            if not recent_messages and not private_contexts:
                logger.warning(f"[{session.session_id}] 上下文为空，跳过主动搭话。")
                return False

            # 2. 调用 AgentService
            from services.agent.agent_service import (
                AgentService,  # 延迟导入以避免循环依赖
            )

            logger.debug(f"[{session.session_id}] 正在建立主数据库连接...")
            async_session = sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )
            async with async_session() as db_session:
                logger.debug(
                    f"[{session.session_id}] 主数据库连接已建立。初始化 AgentService..."
                )
                from services.agent.agent_service import AgentService

                agent = AgentService(db_session)

                from services.core.prompt_service import PromptManager

                prompt_manager = PromptManager()
                # logger.info(f"[{session.session_id}] 获取系统 Prompt...")
                # [修复] 不在此处预渲染系统提示词，避免 AgentService 递归注入
                # core_system_prompt = await prompt_manager.get_rendered_system_prompt(db_session, is_social_mode=True)

                owner_qq = self.config_manager.get("owner_qq") or "未知"

                # 准备表情包列表
                # [重构] 根据配置从助手目录加载表情包
                sticker_list = ""
                sticker_expression_prompt = ""

                # 获取助手配置
                agent_manager = AgentManager()
                # 使用会话 agent_id 或回退到默认
                current_agent_id = session.agent_id or agent_manager.active_agent_id
                agent_profile = agent_manager.agents.get(current_agent_id)

                use_stickers = False
                if agent_profile and agent_profile.use_stickers:
                    use_stickers = True
                elif not agent_profile:
                    # 兼容旧版单助手设置的回退
                    use_stickers = self.config_manager.get("social.use_stickers", False)

                if use_stickers:
                    # [重构] 使用共享方法加载表情包
                    sticker_list = self._load_agent_stickers(current_agent_id)

                # [重构] 注入解耦的人设与特质
                # [用户要求] 暂时禁用社交模式的多助手支持
                # 始终使用默认 Pero 配置，不管活跃助手是谁

                # from services.agent.agent_manager import get_agent_manager
                # agent_manager = get_agent_manager()
                # active_agent = agent_manager.get_active_agent()

                # 默认值 (Fallback)
                agent_name = self.config_manager.get("bot_name", "Pero")
                custom_persona = None

                # 获取助手配置以动态注入人设
                agent_manager = AgentManager()
                # [修复] 使用会话 agent_id 代替 active_agent_id 实现真正的多助手支持
                agent_profile = agent_manager.agents.get(session.agent_id)

                # [已启用] 社交模式多助手支持
                if agent_profile:
                    agent_name = agent_profile.name
                    custom_persona = agent_profile.social_custom_persona
                    logger.debug(
                        f"[{session.session_id}] Using active agent persona: {agent_name}"
                    )

                if not custom_persona:
                    # 尝试从 MDP 加载默认人设模板 (personas/social_default.md)
                    fallback_persona = "你是一个智能助手，正在以社交模式与用户交流。"
                    try:
                        rendered_default = mdp.render(
                            "social/personas/social_default", {"owner_qq": owner_qq}
                        )
                        if (
                            "Missing Prompt" not in rendered_default
                            and "Error" not in rendered_default
                        ):
                            custom_persona = rendered_default
                        else:
                            custom_persona = fallback_persona
                    except Exception:
                        custom_persona = fallback_persona

                # 准备表情包表达提示词

                # 准备表情包表达提示词
                sticker_expression_prompt = ""
                if use_stickers and sticker_list:
                    sticker_expression_prompt = mdp.render(
                        "social/abilities/sticker_expression",
                        {"sticker_list": sticker_list},
                    )

                logger.debug(
                    f"[{session.session_id}] 渲染 Social Instructions (Agent: {agent_name})..."
                )
                social_instructions = mdp.render(
                    "social/social_instructions",
                    {
                        "agent_name": agent_name,
                        "current_mode": current_mode,
                        "owner_qq": owner_qq,
                        "sticker_expression": sticker_expression_prompt,
                        "custom_persona": custom_persona,
                    },
                )

                # [修复] 注入 XML 指南和时间感知以支持主动发起
                current_time_str = datetime.now().strftime("%H:%M:%S")
                xml_guide = mdp.render(
                    "social/active_mode_guide", {"current_time": current_time_str}
                )

                instruction_prompt = mdp.render(
                    "social/social_rules", {"current_mode": current_mode}
                )

                # [MDP Refactor] 构建变量字典供 MDP 渲染使用
                prompt_variables = {
                    # "system_core": core_system_prompt, # Removed to avoid duplication
                    "social_instructions": social_instructions,
                    "xml_guide": xml_guide,
                    "xml_context": xml_context,
                    "instruction_prompt": instruction_prompt,
                }

                # [Refactor] 仅传递 User Content (Images)，System Message 由 MDP 自动插入
                user_content = []

                # [Multimodal] 处理本地缓存图片转 Base64
                processed_images = []
                for img_path in session_images:
                    if os.path.exists(img_path):
                        try:
                            async with aiofiles.open(img_path, "rb") as f:
                                img_data = await f.read()
                                b64_data = base64.b64encode(img_data).decode("utf-8")
                                mime_type = "image/jpeg"
                                if img_path.endswith(".png"):
                                    mime_type = "image/png"
                                elif img_path.endswith(".gif"):
                                    mime_type = "image/gif"

                                data_url = f"data:{mime_type};base64,{b64_data}"
                                processed_images.append(data_url)
                        except Exception as e:
                            logger.error(f"[Social] 读取图片文件 {img_path} 失败: {e}")
                    else:
                        if (
                            "multimedia.nt.qq.com.cn" in img_path
                            or "c2cpicdw.qpic.cn" in img_path
                            or "gchat.qpic.cn" in img_path
                        ):
                            logger.warning(
                                f"[Social] 跳过不兼容的图片 URL: {img_path[:50]}..."
                            )
                            continue
                        processed_images.append(img_path)

                config = await agent._get_llm_config()
                if config.get("enable_vision") and processed_images:
                    logger.debug(
                        f"注入 {len(processed_images)} 张图片到社交聊天上下文。"
                    )
                    for img_url in processed_images:
                        user_content.append(
                            {"type": "image_url", "image_url": {"url": img_url}}
                        )

                # 构造最终的消息列表 (仅包含 User Content)
                # 为防止 Empty User Message 错误，如果没有图片则添加默认触发词

                # [Fix] 注入用户文本内容
                if user_text_context:
                    user_content.append({"type": "text", "text": user_text_context})

                if not user_content:
                    user_content.append({"type": "text", "text": "(Listening...)"})

                messages = [{"role": "user", "content": user_content}]

                logger.debug(
                    f"正在呼叫会话 {session.session_id} 的社交 Agent ({current_mode})..."
                )
                logger.debug(
                    f"[{session.session_id}] 准备调用 agent.chat (Unified Pipeline)..."
                )

                # [阶段 3 重构] 使用带有能力过滤器的统一聊天管道
                response_text = ""
                try:
                    logger.debug(
                        f"[{session.session_id}] 调用 AgentService.chat (source=social, MDP-Driven)..."
                    )

                    # [MDP 集成] 通过 initial_variables 将变量注入到 AgentService 上下文中

                    chat_gen = agent.chat(
                        messages,
                        source="social",
                        session_id=f"social_{session.session_id}",
                        capabilities=["social"],
                        skip_system_prompt=False,  # [MDP] 启用系统提示词生成
                        agent_id_override=(
                            agent_manager.active_agent_id
                            if "agent_manager" in locals()
                            else None
                        ),
                        initial_variables=prompt_variables,  # [新增] 传递变量
                    )

                    async for chunk in chat_gen:
                        response_text += chunk

                except Exception as e:
                    logger.error(
                        f"[{session.session_id}] Agent.chat 调用失败: {e}",
                        exc_info=True,
                    )
                    response_text = ""  # 回退

                logger.debug(
                    f"[{session.session_id}] agent.chat 完成。收到响应长度: {len(response_text)}"
                )

                logger.debug(f"社交 Agent 响应: {response_text}")

                # 3. 发送回复
                # [Fix] 增强空值检查，防止 response_text 为 None 时报错
                if response_text is None:
                    response_text = ""

                if (
                    response_text
                    and response_text.strip()
                    and "IGNORE" not in response_text
                    and "[PASS]" not in response_text
                ):
                    await self.send_msg(session, response_text)
                    spoke = True

                    # 更新会话状态
                    # session.last_active_time = datetime.now() # 移除
                    self._next_thought_time = datetime.now() + timedelta(seconds=120)

                    # [持久化] 保存 Pero 的回复
                    try:
                        await self.session_manager.persist_outgoing_message(
                            session.session_id,
                            session.session_type,
                            response_text,
                            sender_name=agent_name,
                        )
                    except Exception as e:
                        logger.error(f"持久化 Pero 回复失败: {e}")
                elif response_text and "[PASS]" in response_text:
                    logger.debug(f"[{session.session_id}] Agent 决定 PASS (活跃观察)。")
                else:
                    logger.debug(
                        f"[Social] 跳过回复。响应为空或 IGNORE。（内容: '{response_text}'）"
                    )

            # [State Reset] 如果是 Summoned，处理完必须清除
            if session.state == "summoned":
                logger.debug(
                    f"[{session.session_id}] 正在将状态从 SUMMONED 重置为 OBSERVING。"
                )
                session.state = "observing"

            return spoke

        except asyncio.CancelledError:
            logger.warning(
                f"[{session.session_id}] Active Agent Response 被取消（可能是因为用户发了新消息）。"
            )
            raise
        except Exception as e:
            logger.error(
                f"[{session.session_id}] Active Agent 错误: {e}", exc_info=True
            )
        finally:
            # [Preemption] 清理任务标记
            if session.active_response_task == asyncio.current_task():
                session.active_response_task = None

            if "token" in locals():
                injected_msg_ids_var.reset(token)

    async def handle_session_flush(self, session: SocialSession):
        """
        缓冲区刷新时来自 SessionManager 的回调。
        根据会话状态决定处理逻辑：
        - SUMMONED: 直接调用 AgentService 进行回复 (Action Layer)。
        - OBSERVING: 调用 Secretary (Think Layer) 决定是否插嘴。
        """
        logger.debug(
            f"--- [FLUSH] 处理会话 {session.session_id} (状态: {session.state}) ---"
        )

        # [New Feature] 尝试触发记忆总结
        # 即使这次不回复，我们也检查是否积累了足够的消息需要总结
        asyncio.create_task(self._check_and_summarize_memory(session))

        # [多模态屏障] 确保所有待下载图片已完成
        # 优先执行，确保秘书和助手都能看到图片
        all_pending_tasks = []
        task_to_msg_map = {}  # task -> (msg, index)

        for msg in session.buffer:
            if hasattr(msg, "image_tasks") and msg.image_tasks:
                for idx, task in enumerate(msg.image_tasks):
                    if not task.done():
                        all_pending_tasks.append(task)
                        task_to_msg_map[task] = (msg, idx)
                    else:
                        # 任务已完成，成功则更新图片路径
                        try:
                            res = task.result()
                            if res and os.path.exists(res) and idx < len(msg.images):
                                # 用本地路径替换 URL
                                msg.images[idx] = res
                        except Exception as e:
                            logger.warning(f"[Social] 图片下载任务失败（已完成）: {e}")

        if all_pending_tasks:
            logger.debug(
                f"[{session.session_id}] 等待 {len(all_pending_tasks)} 个图片下载..."
            )
            try:
                # 带超时等待（如 10 秒）
                done, pending = await asyncio.wait(all_pending_tasks, timeout=10.0)

                # 处理结果
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
                    logger.warning(
                        f"[{session.session_id}] {len(pending)} 个图片下载超时。"
                    )
            except Exception as e:
                logger.error(f"[{session.session_id}] 等待图片时出错: {e}")

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
            logger.debug(
                f"[{session.session_id}] 偷听刷新 (潜水模式)。委派给秘书 (后台任务)。"
            )

            # [Optimization] 使用 create_task 避免阻塞 flush 流程
            task = asyncio.create_task(
                self._attempt_random_thought(target_session=session)
            )

            # 保存任务引用，防止被 GC
            if not hasattr(session, "active_tasks"):
                session.active_tasks = set()
            session.active_tasks.add(task)
            task.add_done_callback(session.active_tasks.discard)

            return

        # 确定模式，供 Prompt 使用
        current_mode = (
            "SUMMONED" if session.state == "summoned" else "ACTIVE_OBSERVATION"
        )
        logger.debug(
            f"[{session.session_id}] 正在以 {current_mode} 模式处理。调用主 Agent。"
        )

        # --- 以下是被动呼唤 (Summoned) 或 活跃观察 (Active) 的处理逻辑 (Action Layer) ---

        try:
            # 收集当前 Buffer 中的图片用于 Vision 分析
            session_images = []
            session_texts = []
            for buf_msg in session.buffer:
                if buf_msg.images:
                    session_images.extend(buf_msg.images)
                if buf_msg.content:
                    session_texts.append(buf_msg.content)

            user_text_context = "\n".join(session_texts) if session_texts else None

            # 调用统一的 Action Layer
            logger.debug(
                f"[{session.session_id}] 正在进入 _perform_active_agent_response..."
            )

            # [CRITICAL FIX] 使用 create_task 避免阻塞 flush 逻辑，但必须确保持有引用
            # 注意：原代码是直接 await，这会导致 flush 阻塞，进而可能影响 WS 接收。
            # 如果改为 create_task，则必须持有引用防止 GC。
            task = asyncio.create_task(
                self._perform_active_agent_response(
                    session, current_mode, session_images, user_text_context
                )
            )

            # [CRITICAL FIX] 保存任务引用，防止被垃圾回收
            # 我们使用 session 对象本身来持有这个引用，因为它生命周期足够长
            if not hasattr(session, "active_tasks"):
                session.active_tasks = set()
            session.active_tasks.add(task)
            task.add_done_callback(session.active_tasks.discard)

            logger.debug(
                f"[{session.session_id}] _perform_active_agent_response 已调度为后台任务。"
            )

        except Exception as e:
            logger.error(f"handle_session_flush 错误: {e}", exc_info=True)
        finally:
            # 重置会话状态
            session.state = "observing"

    async def _check_and_summarize_memory(self, session: SocialSession):
        """
        检查会话是否满足总结条件 (每 200 条未总结消息触发一次)
        """
        try:
            from sqlmodel import func, select

            from .database import get_social_db_session
            from .models_db import QQMessage

            # 定义触发阈值
            SUMMARY_TRIGGER_COUNT = 200

            async for db_session in get_social_db_session():
                # 统计该会话未总结的消息数量
                statement = select(func.count(QQMessage.id)).where(
                    QQMessage.session_id == session.session_id,
                    QQMessage.session_type == session.session_type,
                    not QQMessage.is_summarized,
                    QQMessage.agent_id == session.agent_id,
                )
                count = (await db_session.exec(statement)).one()

                if count >= SUMMARY_TRIGGER_COUNT:
                    logger.info(
                        f"[{session.session_id}] 触发记忆总结 (未总结数量: {count})"
                    )
                    await self._perform_summarization(
                        session, db_session, SUMMARY_TRIGGER_COUNT
                    )

        except Exception as e:
            logger.error(f"_check_and_summarize_memory 错误: {e}")

    async def _perform_summarization(
        self, session: SocialSession, db_session, limit_count: int = 200
    ):
        """
        执行记忆总结逻辑
        """
        try:
            from sqlmodel import select

            from .models_db import QQMessage

            # 1. 获取未总结的消息 (按时间正序)
            statement = (
                select(QQMessage)
                .where(
                    QQMessage.session_id == session.session_id,
                    QQMessage.session_type == session.session_type,
                    not QQMessage.is_summarized,
                    QQMessage.agent_id == session.agent_id,
                )
                .order_by(QQMessage.timestamp.asc())
                .limit(limit_count)
            )

            messages = (await db_session.exec(statement)).all()
            if not messages:
                return

            # 2. 构建 Prompt
            chat_text = ""
            for msg in messages:
                chat_text += f"{msg.sender_name}: {msg.content}\n"

            prompt = mdp.render(
                "social/reporting/memory_segment_summarizer",
                {
                    "session_type": session.session_type,
                    "session_name": session.session_name,
                    "chat_text": chat_text,
                },
            )

            # 3. 调用 LLM (实例化 LLMService)
            from sqlmodel import select
            from sqlmodel.ext.asyncio.session import AsyncSession as MainAsyncSession

            # 获取主数据库配置
            # 注意：social_db 是独立的，我们需要主数据库连接来获取 AIModelConfig
            from database import engine as main_engine
            from models import AIModelConfig, Config
            from services.core.llm_service import LLMService

            llm_service = None
            async with MainAsyncSession(main_engine) as main_session:
                # 尝试使用 Reflection 模型 (通常用于轻量级任务)
                configs = {
                    c.key: c.value
                    for c in (await main_session.exec(select(Config))).all()
                }
                model_id = configs.get("reflection_model_id")

                # 如果没有 Reflection 模型，尝试使用主模型
                if not model_id:
                    model_id = configs.get("current_model_id")

                if model_id:
                    model_config = await main_session.get(AIModelConfig, int(model_id))
                    if model_config:
                        # [Fix] 正确处理 API Key 和 Base URL (参考 AgentService 逻辑)
                        global_api_key = configs.get("global_llm_api_key", "")
                        global_api_base = configs.get(
                            "global_llm_api_base", "https://api.openai.com"
                        )

                        final_api_key = (
                            model_config.api_key
                            if model_config.provider_type == "custom"
                            else global_api_key
                        )
                        final_api_base = (
                            model_config.api_base
                            if model_config.provider_type == "custom"
                            else global_api_base
                        )

                        llm_service = LLMService(
                            api_key=final_api_key,
                            api_base=final_api_base,
                            model=model_config.model_id,
                            provider=model_config.provider,
                        )

            if not llm_service:
                logger.error("[Social] 初始化 LLMService 失败: 未找到有效的模型配置。")
                return

            # 使用 chat 接口 (带重试机制)
            response = None
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    response = await llm_service.chat(
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                        response_format={"type": "json_object"},
                    )
                    break
                except Exception as api_err:
                    if attempt < max_retries - 1:
                        logger.warning(
                            f"[Social] 总结 API 调用失败 (尝试 {attempt + 1}/{max_retries}): {api_err}. 2秒后重试..."
                        )
                        await asyncio.sleep(2)
                    else:
                        # 最后一次失败，抛出异常供外层捕获
                        raise api_err

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
                    # agent_id = self.config_manager.get("bot_name", "Pero")
                    # 使用会话助手 ID
                    agent_id = session.agent_id

                    await mem_service.add_summary(
                        content=summary,
                        keywords=keywords,
                        session_id=session.session_id,
                        session_type=session.session_type,
                        msg_range=(messages[0].id, messages[-1].id),
                        agent_id=agent_id,
                    )

                    logger.info(
                        f"[{session.session_id}] 记忆已总结: {summary} | 关键词: {keywords}"
                    )

                    # 6. 标记消息为已总结
                    for msg in messages:
                        msg.is_summarized = True
                        db_session.add(msg)
                    await db_session.commit()

            except json.JSONDecodeError:
                logger.error(f"解析总结 JSON 失败: {response_json_str}")

        except Exception as e:
            import traceback

            logger.error(f"执行总结时出错: {e}\n{traceback.format_exc()}")

    async def send_msg(self, session: SocialSession, message: str):
        """
        通用发送消息助手
        """
        # [修复] 确保该助手的表情包已加载（修复不一致的解析）
        if hasattr(session, "agent_id") and session.agent_id:
            self._load_agent_stickers(session.agent_id)

        # [Fix] 移除 NIT 标签和清理文本，防止标签泄露到社交平台
        from nit_core.dispatcher import remove_nit_tags

        message = remove_nit_tags(message)

        # [Deduplication] 简单的重复检测，避免短时间内发送完全相同的内容
        # 检查最近 10 条消息（无论谁发的，因为有时候会重复别人的话，或者重复自己的）
        recent_contents = [m.content for m in session.buffer[-10:]]
        if message in recent_contents:
            logger.warning(f"检测到重复消息发送，已拦截: {message[:20]}...")
            return

        try:
            if session.session_type == "group":
                await self.send_group_msg(int(session.session_id), message)
            elif session.session_type == "private":
                await self.send_private_msg(int(session.session_id), message)
        except Exception as e:
            logger.error(f"发送消息到 {session.session_id} 失败: {e}")

    async def _send_api(
        self, action: str, params: Dict[str, Any], self_id: Optional[str] = None
    ):
        target_ws = self._get_target_ws(self_id)
        if not target_ws:
            raise RuntimeError("No active Social Adapter connection.")

        # 简单的即发即弃（旧版支持，或者如果手动处理 echo）
        # 但我们要使用 UUID 作为 echo 以避免冲突
        import uuid

        echo_id = str(uuid.uuid4())

        payload = {"action": action, "params": params, "echo": echo_id}
        await target_ws.send_text(json.dumps(payload))
        return echo_id

    async def _send_api_and_wait(
        self,
        action: str,
        params: Dict[str, Any],
        timeout: int = 10,
        self_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        发送 API 请求并等待响应。
        """
        target_ws = self._get_target_ws(self_id)
        if not target_ws:
            raise RuntimeError("No active Social Adapter connection.")

        import uuid

        echo_id = str(uuid.uuid4())

        payload = {"action": action, "params": params, "echo": echo_id}

        future = asyncio.get_running_loop().create_future()
        self.pending_requests[echo_id] = future

        await target_ws.send_text(json.dumps(payload))

        try:
            response = await asyncio.wait_for(future, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            if echo_id in self.pending_requests:
                del self.pending_requests[echo_id]
            self.record_error(f"API {action} timed out")
            raise TimeoutError(f"API {action} timed out.") from None

    def _load_agent_stickers(self, agent_id: str) -> str:
        """
        Load stickers for the specified agent into the global sticker map.
        Returns a comma-separated list of sticker names.
        """
        sticker_list = ""
        if not agent_id:
            return ""

        try:
            # 以防万一在此导入，虽然模块级导入已存在
            from services.agent.agent_manager import AgentManager

            agent_manager = AgentManager()

            # 优先尝试助手专属目录
            agent_stickers_dir = os.path.join(
                agent_manager.agents_dir, agent_id, "stickers"
            )

            # 内置未找到时回退到用户助手目录
            if not os.path.exists(agent_stickers_dir):
                agent_stickers_dir = os.path.join(
                    agent_manager.user_agents_dir, agent_id, "stickers"
                )

            # 回退到旧版全局资产（仅在助手目录未找到时）
            if not os.path.exists(agent_stickers_dir):
                # 检查旧版路径
                legacy_stickers_dir = os.path.abspath(
                    os.path.join(
                        os.path.dirname(
                            os.path.dirname(
                                os.path.dirname(
                                    os.path.dirname(os.path.abspath(__file__))
                                )
                            )
                        ),
                        "assets",
                        "stickers",
                    )
                )
                if os.path.exists(legacy_stickers_dir):
                    agent_stickers_dir = legacy_stickers_dir

            if os.path.exists(agent_stickers_dir):
                # 扫描表情包
                stickers = []
                for entry in os.scandir(agent_stickers_dir):
                    if entry.is_file() and entry.name.lower().endswith(
                        (".jpg", ".png", ".gif", ".jpeg")
                    ):
                        # 提取不含扩展名的名称
                        name = os.path.splitext(entry.name)[0]
                        stickers.append(name)
                        # 更新内部映射用于发送
                        self._sticker_map[name] = entry.path

                if stickers:
                    sticker_list = ", ".join(stickers)
                    # logger.debug(f"[Social] Loaded {len(stickers)} stickers for agent {agent_id}.")

        except Exception as e:
            logger.error(f"[Social] Failed to load stickers for agent {agent_id}: {e}")

        return sticker_list

    def _ensure_sticker_map(self):
        # [修复] 检查 _sticker_base_dir 而非 _sticker_map，因为 _sticker_map 在 __init__ 中初始化
        if self._sticker_base_dir is None:
            try:
                import json
                import os

                base_dir = os.path.dirname(
                    os.path.dirname(
                        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    )
                )
                sticker_path = os.path.join(
                    base_dir, "assets", "stickers", "index.json"
                )
                logger.debug(f"[Social] Loading sticker map from: {sticker_path}")

                if not os.path.exists(sticker_path):
                    # 回退到默认助手表情包路径
                    fallback_path = os.path.join(
                        base_dir,
                        "services",
                        "mdp",
                        "agents",
                        "pero",
                        "stickers",
                        "index.json",
                    )
                    logger.debug(
                        f"[Social] Primary sticker path not found. Trying fallback: {fallback_path}"
                    )
                    if os.path.exists(fallback_path):
                        sticker_path = fallback_path

                if os.path.exists(sticker_path):
                    with open(sticker_path, "r", encoding="utf-8") as f:
                        self._sticker_map = json.load(f)
                    self._sticker_base_dir = os.path.dirname(sticker_path)
                    logger.info(
                        f"[Social] Sticker map loaded from {sticker_path}. Count: {len(self._sticker_map)}"
                    )
                else:
                    logger.warning(
                        f"[Social] Sticker index not found at {sticker_path} (or fallback)"
                    )
                    self._sticker_map = {}
                    # 不将 _sticker_base_dir 设为空，以便文件出现后可重试
                    # self._sticker_base_dir = ""
            except Exception as e:
                logger.error(f"Failed to load sticker index: {e}")
                self._sticker_map = {}
                # 允许下次重试
                # self._sticker_base_dir = ""

    def _process_stickers(self, message: str) -> str:
        """
        Parse [sticker:name] tags and replace them with CQ codes.
        Robustness: Handles full/half width colons, spaces, and case-insensitivity.
        """
        import os
        import re

        self._ensure_sticker_map()

        def replace_match(match):
            # 清理表情包名称：移除空格
            sticker_name_raw = match.group(1).strip()

            # 调试日志
            # logger.debug(f"[Sticker] Processing tag: {sticker_name_raw}")

            # 先尝试精确匹配
            filename = self._sticker_map.get(sticker_name_raw)

            # 未找到时尝试不区分大小写匹配（较慢但稳健）
            if not filename:
                for k, v in self._sticker_map.items():
                    if k.lower() == sticker_name_raw.lower():
                        filename = v
                        # logger.debug(f"[Sticker] Found case-insensitive match: {k} -> {filename}")
                        break

            if filename:
                # 构建 NapCat/OneBot 的绝对路径
                # OneBot 通常支持 file:// 协议
                base_dir = self._sticker_base_dir if self._sticker_base_dir else ""
                full_path = os.path.join(base_dir, filename)
                # 转换为正斜杠以兼容
                full_path = full_path.replace("\\", "/")

                cq_code = f"[CQ:image,file=file:///{full_path}]"
                # logger.debug(f"[Sticker] Generated CQ: {cq_code}")
                return cq_code

            # 仍未找到则保留原文（让用户知道失败，或静默失败）
            logger.warning(
                f"[Sticker] Sticker not found in map: '{sticker_name_raw}'. Map size: {len(self._sticker_map)}"
            )
            return match.group(0)

        # 查找 [sticker:xxx] 的正则
        # 支持:
        # - 标准: [sticker:name]
        # - 空格: [ sticker : name ]
        # - 全角冒号: [sticker：name]
        # - 混合: [sticker ： name]
        pattern = r"\[\s*sticker\s*[:：]\s*(.*?)\s*\]"

        return re.sub(pattern, replace_match, message, flags=re.IGNORECASE)

    async def send_group_msg(self, group_id: int, message: str):
        # 预处理表情包
        final_message = self._process_stickers(message)
        logger.debug(f"[Social] 准备发送群消息给 {group_id}: {final_message}")
        # 使用 _send_api_and_wait 确保送达并捕获错误（如被禁言、群不存在）
        try:
            await self._send_api_and_wait(
                "send_group_msg", {"group_id": group_id, "message": final_message}
            )
            logger.debug(f"[Social] 群消息发送成功 (Group: {group_id})")
        except Exception as e:
            logger.error(f"[Social] Failed to send group message to {group_id}: {e}")
            raise e

    async def send_private_msg(self, user_id: int, message: str):
        # 预处理表情包
        final_message = self._process_stickers(message)
        # 使用 _send_api_and_wait 确保送达
        try:
            await self._send_api_and_wait(
                "send_private_msg", {"user_id": user_id, "message": final_message}
            )
        except Exception as e:
            logger.error(f"[Social] Failed to send private message to {user_id}: {e}")
            raise e

    async def handle_friend_request(self, flag: str, approve: bool, remark: str = ""):
        await self._send_api(
            "set_friend_add_request",
            {"flag": flag, "approve": approve, "remark": remark},
        )

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
            resp = await self._send_api_and_wait(
                "get_stranger_info", {"user_id": user_id}
            )
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取陌生人信息失败: {e}")
            return {"user_id": user_id, "nickname": "Unknown"}

    async def get_group_info(self, group_id: int):
        """
        获取群信息 (OneBot V11 Standard)
        """
        try:
            resp = await self._send_api_and_wait(
                "get_group_info", {"group_id": group_id}
            )
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取群信息失败: {e}")
            return {}

    async def get_group_name(self, group_id: str) -> str:
        try:
            info = await self.get_group_info(int(group_id))
            return info.get("group_name", "")
        except Exception:
            return ""

    async def get_user_nickname(self, user_id: str) -> str:
        try:
            info = await self.get_stranger_info(int(user_id))
            return info.get("nickname", "")
        except Exception:
            return ""

    async def get_group_member_info(self, group_id: int, user_id: int):
        """
        获取群成员信息 (OneBot V11 Standard)
        """
        try:
            resp = await self._send_api_and_wait(
                "get_group_member_info", {"group_id": group_id, "user_id": user_id}
            )
            return resp.get("data", {})
        except Exception as e:
            logger.error(f"获取群成员信息失败: {e}")
            return {}

    async def search_social_memory(self, query: str):
        """
        搜索社交记忆 (PEDSA 引擎 + 扩散)。
        替代旧的 read_memory 和 get_group_msg_history。
        """
        try:
            # 获取 SocialMemoryService 实例
            from .social_memory_service import SocialMemoryService

            memory_service = SocialMemoryService()

            # 调用搜索
            memories = await memory_service.search_memories(query, limit=10)

            if not memories:
                return "No relevant social memories found via PEDSA engine."

            result_text = "Found Social Memories (PEDSA Diffusion):\n"

            # 批量获取会话名称
            session_names = {}
            sessions_to_fetch = set()
            for mem in memories:
                sessions_to_fetch.add((mem.source_session_type, mem.source_session_id))

            for s_type, s_id in sessions_to_fetch:
                if s_type == "group":
                    session_names[s_id] = await self.get_group_name(s_id) or s_id
                elif s_type == "private":
                    session_names[s_id] = await self.get_user_nickname(s_id) or s_id

            for mem in memories:
                time_str = mem.created_at.strftime("%Y-%m-%d %H:%M")
                session_name = session_names.get(
                    mem.source_session_id, mem.source_session_id
                )
                # 来源标注
                source_label = f"[{mem.source_session_type}:{mem.source_session_id}({session_name})]"
                # Sender 标记为 Memory (因为是总结)
                sender_name = "Memory"

                result_text += (
                    f"{source_label} [{time_str}] {sender_name}: {mem.content}\n"
                )

            return result_text

        except Exception as e:
            logger.error(f"搜索社交记忆失败: {e}")
            return f"Error: {e}"

    async def read_agent_memory(self, query: str):
        """
        读取 Agent (Master) 记忆。
        """
        try:
            async_session = sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )
            async with async_session() as db_session:
                # 在核心记忆中搜索（向量搜索）
                memories = await MemoryService.get_relevant_memories(
                    db_session, text=query, limit=5
                )

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
            from services.core.realtime_session_manager import realtime_session_manager

            await realtime_session_manager.broadcast(
                {
                    "type": "text_response",
                    "content": f"【社交汇报】\n{content}",
                    "status": "report",
                }
            )
        except ImportError:
            pass

        # 发送到主人 QQ（如果已配置并启用）
        if self.active_ws:
            owner_qq = self.config_manager.get("owner_qq")
            if owner_qq:
                try:
                    qq_num = int(owner_qq)
                    bot_name = self.config_manager.get("bot_name", "Pero")
                    await self.send_private_msg(
                        qq_num, f"【{bot_name}汇报】\n{content}"
                    )
                    logger.info(f"[Social] 通知已发送给主人 QQ: {qq_num}")
                except Exception as e:
                    logger.error(f"[Social] 发送通知给主人 QQ 失败: {e}")


def get_social_service():
    if SocialService._instance is None:
        SocialService._instance = SocialService()
    return SocialService._instance
