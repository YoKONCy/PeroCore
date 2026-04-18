# ruff: noqa: E402
#  ██████╗ ███████╗██████╗  ██████╗
#  ██╔══██╗██╔════╝██╔══██╗██╔═══██╗
#  ██████╔╝█████╗  ██████╔╝██║   ██║
#  ██╔═══╝ ██╔══╝  ██╔══██╗██║   ██║
#  ██║     ███████╗██║  ██║╚██████╔╝
#  ╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝
#
#          v     v
#         ( > ‿ < )   < Hi~ Master!
#         /  |><|  \
#        (  _____  )
#

import asyncio
import base64
import html
import io
import json
import logging
import os
import secrets
import sys
import time
import warnings
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from urllib.parse import quote

# 路径防御：确保打包后或不同目录下启动都能正确找到模块 (必须放在自定义模块导入之前)
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from rich.console import Console
from rich.traceback import install as install_rich_traceback

from utils.logging_config import configure_logging
from utils.workspace_utils import get_workspace_root

# --- 1. Rich 全局初始化 (最优先执行) ---

# 强制 stdout 使用 UTF-8 编码
if sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        import io

        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

log_file = os.environ.get("PERO_LOG_FILE")
configure_logging(log_file=log_file)

# 安装 Rich 的 traceback handler，使报错信息美观易读
install_rich_traceback(show_locals=True, width=120)

# 初始化 Rich Console
console = Console()

# 获取 logger
logger = logging.getLogger("rich")

# --- 抑制日志和进度条（必须放在最前面） ---
os.environ["TQDM_DISABLE"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

# 忽略警告
warnings.filterwarnings("ignore", category=UserWarning)  # 通用用户警告
# 忽略来自 pypdf/cryptography 的 CryptographyDeprecationWarning
with suppress(ImportError):
    from cryptography.utils import CryptographyDeprecationWarning

    warnings.filterwarnings("ignore", category=CryptographyDeprecationWarning)
# --------------------------------------------------------

import uvicorn
from fastapi import (
    FastAPI,
    Request,
)
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from core.config_manager import get_config_manager
from core.desktop_auth import (
    DESKTOP_API_KEY_HEADER,
    DESKTOP_API_KEY_COOKIE,
    DESKTOP_API_KEY_QUERY,
    desktop_auth_required,
    has_valid_desktop_api_key,
    request_requires_desktop_auth,
    resolve_desktop_api_key,
)
from database import engine, get_session, init_db
from models import (
    Config,
    PetState,
    ScheduledTask,
    VoiceConfig,
)
from nit_core.plugins.social_adapter.social_service import get_social_service
from routers.agent_router import router as agent_router
from routers.asset_router import router as asset_router
from routers.config_router import router as config_router
from routers.group_chat_router import router as group_chat_router
from routers.ide_router import router as ide_router
from routers.ipc_router import router as ipc_router
from routers.memory_router import router as memory_router
from routers.nit_router import router as nit_router
from routers.scheduler_router import router as scheduler_router
from routers.stronghold_router import router as stronghold_router
from routers.task_control_router import router as task_control_router
from services.agent.agent_service import AgentService
from services.agent.companion_service import companion_service
from services.agent.scheduler_service import scheduler_service
from services.core.embedding_service import embedding_service
from services.core.gateway_client import gateway_client
from services.core.realtime_session_manager import realtime_session_manager
from services.core.sync_service import sync_service
from services.interaction.tts_service import get_tts_service

# from services.memory_secretary_service import MemorySecretaryService
from services.perception.asr_service import get_asr_service
from services.perception.screenshot_service import screenshot_manager

if os.name == "nt":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if sys.stdout is not None:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    if sys.stderr is not None:
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# [Bootstrap] 核心组件初始化与Mod加载
from core.bootstrap import bootstrap

bootstrap()

# 初始化日志
# configure_logging 已经在最前面调用过一次了，这里不需要重复初始化
# log_file = os.environ.get("PERO_LOG_FILE")
# configure_logging(log_file=log_file)

logger = logging.getLogger(__name__)

# [DEBUG] 打印启动参数和环境变量以进行故障排除
# print(f"[启动调试] sys.argv: {sys.argv}")
# print(f"[启动调试] ENABLE_SOCIAL_MODE 环境变量: {os.environ.get('ENABLE_SOCIAL_MODE')}")

# [功能] 思考管道：周报任务
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动 Logo
    print(r"""
██████╗ ███████╗██████╗  ██████╗  ██████╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
██████╔╝█████╗  ██████╔╝██║   ██║██║     ██║   ██║██████╔╝█████╗  
██╔═══╝ ██╔══╝  ██╔══██╗██║   ██║██║     ██║   ██║██╔══██╗██╔══╝  
██║     ███████╗██║  ██║╚██████╔╝╚██████╗╚██████╔╝██║  ██║███████╗
╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
""")
    print("=" * 50)
    print("🚀 萌动链接：PeroperoChat！ 后端启动中...")
    print(f"📅 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📂 数据目录: {os.environ.get('PERO_DATA_DIR', 'Default')}")

    # [AssetRegistry] 优先扫描资产 (插件/模型/模组)
    from core.asset_registry import get_asset_registry

    registry = get_asset_registry()
    registry.scan_all()
    print(f"📦 资产注册表: [就绪] (已索引 {len(registry.assets)} 个资产)")

    # 检查 TriviumDB 核心
    # 同时捕获 ImportError 和 OSError 才能拦截 DLL 缺失导致的底层崩溃
    try:
        import triviumdb  # noqa: F401

        print("🧠 统一记忆引擎: [就绪] (TriviumDB 高性能版已加载)")
    except (ImportError, OSError) as e:
        print(f"🧠 统一记忆引擎: [禁用] (TriviumDB 加载异常: {e})")

    # 检查向量图谱存储
    # [修复] 用 try/except 包裹，trivium_store.py 内部的模块级 import triviumdb 如果失败，
    #        将不会崩溃整个后端（此前为致命的隐性脆弱点）
    try:
        from services.memory.trivium_store import trivium_store

        print(f"📊 记忆节点总数: {trivium_store.count()}")
    except Exception as e:
        print(
            f"📊 记忆存储: [降级] TriviumStore 初始化失败，后端将以无记忆引擎模式运行 ({e})"
        )
        trivium_store = None  # type: ignore[assignment]
    print("=" * 50)

    # 启动初始化
    try:
        await init_db()
    except Exception as e:
        print(f"❌ 数据库初始化致命错误: {e}")
        # 如果是数据库损坏，尝试备份并重置
        if (
            "malformed" in str(e).lower()
            or "not a database" in str(e).lower()
            or "no such table" in str(e).lower()
        ):
            print("⚠️ 检测到数据库文件可能已损坏，正在尝试自动恢复...")
            try:
                db_path = os.environ.get("PERO_DATABASE_PATH")
                if db_path and os.path.exists(db_path):
                    backup_path = f"{db_path}.corrupt_{int(time.time())}"
                    import shutil

                    # 由于异步引擎可能持有锁，尝试强制重命名
                    shutil.move(db_path, backup_path)
                    print(f"✅ 已备份损坏的数据库到: {backup_path}")
                    print("🔄 重新初始化空数据库...")
                    await init_db()
            except Exception as backup_error:
                print(f"❌ 自动恢复失败: {backup_error}")
                # 如果重铸失败，则不吞弃异常，让开发者可见
                raise e from backup_error
        else:
            raise e from None

    # 从数据库加载配置
    await get_config_manager().load_from_db()

    # [优化] 预热 AgentManager 以避免首次请求延迟
    from services.agent.agent_manager import get_agent_manager

    get_agent_manager()
    print("🤖 AgentManager: [就绪]")

    # [Debug] 打印加载的关键配置
    cm = get_config_manager()
    print("🔧 当前配置状态:")
    print(f"   - 轻量模式: {cm.get('lightweight_mode')}")
    print(f"   - 陪伴模式: {cm.get('companion_mode_enabled')}")
    print(f"   - 社交模式: {cm.get('enable_social_mode')}")
    print("=" * 50)

    await seed_voice_configs()

    # [引导逻辑] 初始化 Embedding Service 配置喵~ 🧠
    try:
        await embedding_service.refresh_config()
        print("🧠 EmbeddingService: [就绪]")
    except Exception as e:
        print(f"🧠 EmbeddingService: [失败] ({e})")

    await companion_service.start()
    screenshot_manager.start_background_task()

    # [已移除] OCR 预热 — easyocr 已移除 (2026-03-20)

    # [优化] 禁用了激进的预热以提高启动性能并减少卡顿
    # 异步预热 Embedding 模型
    # asyncio.create_task(asyncio.to_thread(embedding_service.warm_up))

    # 异步预热 ASR 模型
    # asr_service = get_asr_service()
    # asyncio.create_task(asyncio.to_thread(asr_service.warm_up))

    # [容错] 恢复未完成的记忆任务 (启动自愈)
    try:
        from sqlalchemy.orm import sessionmaker

        from services.memory.scorer_service import ScorerService
        from services.memory.trivium_sync_service import TriviumSyncService

        async_session = sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        async with async_session() as session:
            scorer = ScorerService(session)
            await scorer.recover_pending_tasks()
            sync_result = await TriviumSyncService.retry_pending_tasks(session)
            if sync_result["processed"] > 0:
                print(
                    "[Main] TriviumDB 补偿任务恢复完成: "
                    f"processed={sync_result['processed']}, "
                    f"succeeded={sync_result['succeeded']}, "
                    f"failed={sync_result['failed']}, "
                    f"processed_by_store={sync_result.get('processed_by_store', {})}, "
                    f"succeeded_by_store={sync_result.get('succeeded_by_store', {})}, "
                    f"failed_by_store={sync_result.get('failed_by_store', {})}"
                )
                summary = await TriviumSyncService.get_task_summary(session)
                print(
                    "[Main] TriviumDB 补偿任务剩余摘要: "
                    f"by_store={summary.get('by_store', {})}, "
                    f"by_operation={summary.get('by_operation', {})}, "
                    f"oldest_pending_created_at={summary.get('oldest_pending_created_at')}"
                )
    except Exception as e:
        print(f"[Main] 记忆任务恢复失败: {e}")

    # 启动社交服务（如果已启用）
    social_service = get_social_service()
    await social_service.start()

    # 启动网关客户端
    gateway_client.start_background()

    # 初始化调度器
    scheduler_service.initialize()

    # 初始化实时会话管理器
    realtime_session_manager.initialize()

    # 启动 AuraVision (如果已启用)
    config_mgr = get_config_manager()
    if config_mgr.get("aura_vision_enabled", False):
        from services.perception.aura_vision_service import aura_vision_service

        if await aura_vision_service.initialize():
            asyncio.create_task(aura_vision_service.start_vision_loop())
        else:
            print("[Main] 初始化 AuraVision 服务失败。")

    # 清理任务
    async def periodic_cleanup():
        while True:
            try:
                tts = get_tts_service()
                tts.cleanup_old_files(max_age_seconds=3600)

                # 清理临时视觉文件
                # [重构] 统一指向 backend/data/temp_vision
                default_data_dir = os.path.join(current_dir, "data")
                data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
                temp_vision = os.path.join(data_dir, "temp_vision")
                if os.path.exists(temp_vision):
                    now = time.time()
                    for f in os.listdir(temp_vision):
                        f_path = os.path.join(temp_vision, f)
                        if (
                            os.path.isfile(f_path)
                            and now - os.path.getmtime(f_path) > 3600
                        ):  # 1 hour
                            with suppress(Exception):
                                os.remove(f_path)
            except Exception as e:
                print(f"[Main] 清理任务错误: {e}")
            await asyncio.sleep(3600)

    cleanup_task = asyncio.create_task(periodic_cleanup())

    # [功能] 思考管道：周报任务
    async def periodic_weekly_report_check():
        from sqlalchemy.orm import sessionmaker

        from database import engine
        from services.agent.chain_service import chain_service

        # 初始延迟以让数据库就绪
        await asyncio.sleep(30)

        while True:
            try:
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                async with async_session() as session:
                    # 检查上次报告时间
                    config_key = "last_weekly_report_time"
                    config = await session.get(Config, config_key)

                    should_run = False
                    now = datetime.now()

                    if not config:
                        # 首次运行：立即运行以用于演示
                        should_run = True
                    else:
                        try:
                            last_time = datetime.fromisoformat(config.value)
                            if (now - last_time).total_seconds() > 7 * 24 * 3600:
                                should_run = True
                        except Exception:
                            should_run = True  # corrupted date

                    if should_run:
                        print("[Main] 正在触发周报生成...")
                        report = await chain_service.generate_weekly_report(session)

                        if report:
                            # [修改] 保存到文件 (不入库)
                            try:
                                agent_id = "pero"  # Default in chain_service
                                workspace = get_workspace_root(agent_id)
                                report_dir = os.path.join(workspace, "weekly_reports")
                                os.makedirs(report_dir, exist_ok=True)
                                date_str = now.strftime("%Y-%m-%d")
                                file_path = os.path.join(report_dir, f"{date_str}.md")

                                with open(file_path, "w", encoding="utf-8") as f:
                                    f.write(report)
                                print(f"[Main] 周报已保存到文件: {file_path}")
                            except Exception as e:
                                print(f"[Main] 保存周报文件失败: {e}")

                            # 更新配置
                            if not config:
                                config = Config(key=config_key, value=now.isoformat())
                                session.add(config)
                            else:
                                config.value = now.isoformat()
                                config.updated_at = now

                            await session.commit()
                            print("[Main] 周报已生成并保存 (静默模式)。")

                            # [修改] 不再广播到前端
                            # try:
                            #     ...
                            # except ...
                        else:
                            print("[Main] 周报生成已跳过 (无内容/错误)。")

            except Exception as e:
                print(f"[Main] 周报任务错误: {e}")

            # 每小时检查一次
            await asyncio.sleep(3600)

    weekly_report_task = asyncio.create_task(periodic_weekly_report_check())

    # [功能] 梦境模式：每日 22:00 触发
    async def periodic_dream_check():
        from datetime import timedelta

        from sqlalchemy.orm import sessionmaker

        from database import engine

        await asyncio.sleep(60)  # 初始延迟

        while True:
            try:
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                async with async_session() as session:
                    now = datetime.now()

                    # 计算最近的计划触发时间 (22:00)
                    if now.hour < 22:
                        latest_scheduled = now.replace(
                            hour=22, minute=0, second=0, microsecond=0
                        ) - timedelta(days=1)
                    else:
                        latest_scheduled = now.replace(
                            hour=22, minute=0, second=0, microsecond=0
                        )

                    # 检查上次触发时间
                    config_key = "last_dream_trigger_time"
                    config = await session.get(Config, config_key)

                    last_trigger_time = datetime.min
                    if config:
                        with suppress(Exception):
                            last_trigger_time = datetime.fromisoformat(config.value)

                    if last_trigger_time < latest_scheduled:
                        print(
                            f"[Main] 触发定时梦境模式 (上次: {last_trigger_time}, 计划: {latest_scheduled})"
                        )
                        # 实例化 AgentService 以使用其 _trigger_dream 方法
                        from services.agent.agent_service import AgentService

                        agent_service = AgentService(session)
                        await agent_service._trigger_dream()
            except Exception as e:
                print(f"[Main] 梦境检查任务错误: {e}")

            # 每 15 分钟检查一次
            await asyncio.sleep(900)

    # [功能] 记忆维护与梦境：每日 22:00 触发
    async def periodic_memory_maintenance_check():
        from datetime import timedelta

        from sqlalchemy.orm import sessionmaker

        from database import engine

        await asyncio.sleep(120)  # 初始延迟

        while True:
            try:
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                async with async_session() as session:
                    now = datetime.now()

                    # 计算最近的计划触发时间 (22:00)
                    if now.hour < 22:
                        latest_scheduled = now.replace(
                            hour=22, minute=0, second=0, microsecond=0
                        ) - timedelta(days=1)
                    else:
                        latest_scheduled = now.replace(
                            hour=22, minute=0, second=0, microsecond=0
                        )

                    # 检查上次维护时间
                    config_key = "last_memory_maintenance_time"
                    config = await session.get(Config, config_key)

                    last_time = datetime.min
                    if config:
                        with suppress(Exception):
                            last_time = datetime.fromisoformat(config.value)

                    if last_time < latest_scheduled:
                        print(
                            f"[Main] 触发定时记忆维护与梦境 (上次: {last_time}, 计划: {latest_scheduled})"
                        )

                        # 1. 触发反思服务 (维护与梦境)
                        from services.memory.reflection_service import ReflectionService

                        reflection_service = ReflectionService(session)

                        # 2. 触发 Agent 服务 (梦境触发)
                        from services.agent.agent_service import AgentService

                        agent_service = AgentService(session)

                        # 运行任务
                        try:
                            # [修复] Config 是单个 DB 模型实例，而不是字典。使用 ConfigManager 获取全局设置。
                            config_mgr = get_config_manager()
                            active_agent_id = config_mgr.get("agent_id", "pero")
                            await asyncio.gather(
                                reflection_service.run_maintenance(),
                                agent_service._trigger_dream(),
                                reflection_service.generate_desktop_diary(
                                    agent_id=active_agent_id,
                                    date_str=latest_scheduled.strftime("%Y-%m-%d"),
                                ),
                            )
                        except Exception as inner_e:
                            print(f"[Main] 维护/梦境任务内部错误: {inner_e}")

                        # 更新配置
                        if not config:
                            config = Config(key=config_key, value=now.isoformat())
                            session.add(config)
                        else:
                            config.value = now.isoformat()
                            config.updated_at = now
                        await session.commit()

            except Exception as e:
                import traceback

                traceback.print_exc()
                print(f"[Main] 记忆维护检查任务错误: {e!s}")

            # 每 1 小时检查一次
            await asyncio.sleep(3600)

    maintenance_task = asyncio.create_task(periodic_memory_maintenance_check())

    # [Feature] 孤独记忆扫描器：每小时触发
    async def periodic_lonely_scan_check():
        from sqlalchemy.orm import sessionmaker

        from database import engine
        from services.memory.reflection_service import ReflectionService

        # 初始延迟以错开其他任务
        await asyncio.sleep(300)

        while True:
            try:
                # [Optimization] 检查系统是否负载过高或用户正在聊天？
                # 目前依靠异步并发。
                # scan_lonely_memories 会频繁让出控制权 (DB, LLM)。

                # print("[Main] Starting hourly lonely memory scan...", flush=True)
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                async with async_session() as session:
                    service = ReflectionService(session)
                    await service.scan_lonely_memories(limit=2)
            except Exception as e:
                print(f"[Main] 孤独记忆扫描任务错误: {e}")

            # 每小时检查一次
            await asyncio.sleep(3600)

    lonely_scan_task = asyncio.create_task(periodic_lonely_scan_check())

    # [Feature] 定期触发检查 (提醒事项 & 话题)
    # 以后端调度替代前端轮询
    async def execute_and_broadcast_chat(instruction: str, session: AsyncSession):
        """执行触发对话并将结果广播给所有连接的客户端。"""

        agent_service = AgentService(session)
        full_response = ""

        try:
            # 1. 通知客户端 Pero 正在思考
            await realtime_session_manager.broadcast(
                {"type": "status", "content": "thinking"}
            )

            # 2. 运行对话
            async for chunk in agent_service.chat(
                messages=[],
                source="system_trigger",
                system_trigger_instruction=instruction,
            ):
                if chunk:
                    full_response += chunk

            if full_response:
                # 3. 清理和解析响应 (使用 realtime_session_manager 的逻辑)
                ui_response = realtime_session_manager._clean_text(
                    full_response, for_tts=False
                )
                tts_response = realtime_session_manager._clean_text(
                    full_response, for_tts=True
                )

                # 4. 广播文本响应
                await realtime_session_manager.broadcast(
                    {"type": "status", "content": "speaking"}
                )
                await realtime_session_manager.broadcast(
                    {"type": "text_response", "content": ui_response}
                )

                # 5. 处理 TTS 并广播音频 (可选但推荐保持一致性)
                target_voice, target_rate, target_pitch = (
                    realtime_session_manager._get_voice_params(full_response)
                )
                tts_service = get_tts_service()
                audio_path = await tts_service.synthesize(
                    tts_response,
                    voice=target_voice,
                    rate=target_rate,
                    pitch=target_pitch,
                )

                if audio_path:
                    ext = os.path.splitext(audio_path)[1].replace(".", "") or "mp3"
                    with open(audio_path, "rb") as f:
                        audio_content = f.read()
                        audio_b64 = base64.b64encode(audio_content).decode("utf-8")
                        await realtime_session_manager.broadcast(
                            {"type": "audio_response", "data": audio_b64, "format": ext}
                        )

                # 6. 重置为空闲
                await realtime_session_manager.broadcast(
                    {"type": "status", "content": "idle"}
                )
        except Exception as e:
            print(f"[Main] 执行并广播触发对话失败: {e}")
            await realtime_session_manager.broadcast(
                {"type": "status", "content": "idle"}
            )

    async def periodic_trigger_check():
        from sqlalchemy.orm import sessionmaker

        from database import engine

        await asyncio.sleep(10)  # 初始延迟

        while True:
            try:
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                async with async_session() as session:
                    now = datetime.now()
                    tasks = (
                        await session.exec(
                            select(ScheduledTask).where(not ScheduledTask.is_triggered)
                        )
                    ).all()

                    # 1. 提醒事项
                    due_reminders = [
                        t
                        for t in tasks
                        if t.type == "reminder"
                        and datetime.fromisoformat(
                            t.time.replace("Z", "+00:00")
                        ).replace(tzinfo=None)
                        <= now
                    ]
                    for task in due_reminders:
                        print(f"[Main] 触发提醒: {task.content}")
                        instruction = f"【管理系统提醒：Pero，你与主人的约定时间已到，请主动提醒主人。约定内容：{task.content}】"

                        # 先标记为已触发
                        task.is_triggered = True
                        session.add(task)
                        await session.commit()

                        # 触发对话并广播
                        await execute_and_broadcast_chat(instruction, session)

                    # 2. 话题 (分组)
                    due_topics = [
                        t
                        for t in tasks
                        if t.type == "topic"
                        and not t.is_triggered
                        and datetime.fromisoformat(
                            t.time.replace("Z", "+00:00")
                        ).replace(tzinfo=None)
                        <= now
                    ]

                    if due_topics:
                        topic_list_str = "\n".join(
                            [f"- {t.content}" for t in due_topics]
                        )
                        print(f"[Main] 正在触发话题: {len(due_topics)} 项")
                        instruction = f"【管理系统提醒：Pero，以下是你之前想找主人聊的话题（已汇总）：\n{topic_list_str}\n\n请将这些话题自然地融合在一起，作为一次主动的聊天开场。】"

                        for t in due_topics:
                            t.is_triggered = True
                            session.add(t)
                        await session.commit()

                        # 触发对话并广播
                        await execute_and_broadcast_chat(instruction, session)

                    # 3. 反应 (预设动作)
                    due_reactions = [
                        t
                        for t in tasks
                        if t.type == "reaction"
                        and not t.is_triggered
                        and datetime.fromisoformat(
                            t.time.replace("Z", "+00:00")
                        ).replace(tzinfo=None)
                        <= now
                    ]
                    for task in due_reactions:
                        print(f"[Main] 触发反应: {task.content}")
                        instruction = f"【管理系统提醒：Pero，你之前决定：‘{task.content}’。现在触发时间已到，请立刻执行该行为。】"

                        task.is_triggered = True
                        session.add(task)
                        await session.commit()

                        await execute_and_broadcast_chat(instruction, session)

            except Exception as e:
                print(f"[Main] 触发检查任务错误: {e}")

            await asyncio.sleep(30)  # 每30秒检查一次

    trigger_task = asyncio.create_task(periodic_trigger_check())

    # 启动网关客户端
    gateway_client.start_background()
    print("[Main] Gateway 客户端已启动。")

    # 启动云同步服务
    await sync_service.load_config()
    sync_service.start()

    # [Feature] 自动预热模型
    async def run_warmup():
        print("[Main] 开始后台模型预热...", flush=True)
        loop = asyncio.get_event_loop()

        # 1. 预热 Embedding 服务
        try:
            # 在线程中运行，因为它是阻塞的
            await loop.run_in_executor(None, embedding_service.warm_up)
        except Exception as e:
            print(f"[Main] Embedding Service 预热失败: {e}")

        # 2. 预热 ASR 服务 (Whisper)
        try:
            asr = get_asr_service()
            # 在线程中运行
            await loop.run_in_executor(None, asr.warm_up)
        except Exception as e:
            print(f"[Main] ASR Service 预热失败: {e}")

        print("[Main] 模型预热完成。", flush=True)

    asyncio.create_task(run_warmup())

    # [Feature] 据点初始化
    try:
        from services.chat.stronghold_service import StrongholdService

        async with AsyncSession(engine, expire_on_commit=False) as session:
            stronghold_service = StrongholdService(session)
            await stronghold_service.ensure_initial_data()
            print("[Main] Stronghold 初始化完成。")
    except Exception as e:
        print(f"[Main] Stronghold 初始化失败: {e}")

    # [Optimization] 预热 Dashboard 的关键状态缓存
    try:
        from services.agent.agent_manager import get_agent_manager

        agent_manager = get_agent_manager()
        active_agent = agent_manager.get_active_agent()
        active_agent_id = active_agent.id if active_agent else "pero"

        async with AsyncSession(engine, expire_on_commit=False) as session:
            statement = select(PetState).where(PetState.agent_id == active_agent_id)
            state = (await session.exec(statement)).first()
            if not state:
                state = PetState(
                    agent_id=active_agent_id,
                    mood="开心",
                    vibe="正常",
                    mind="正在想主人...",
                )
                session.add(state)
                await session.commit()
                await session.refresh(state)

            if not hasattr(app.state, "pet_state_cache"):
                app.state.pet_state_cache = {}
            app.state.pet_state_cache[active_agent_id] = {
                "data": state,
                "time": time.time(),
            }
        print(f"✅ 状态预热完成 (Agent: {active_agent_id})")
    except Exception as e:
        print(f"⚠️ 状态预热失败: {e}")

    yield

    # 关闭服务前强制刷盘
    try:
        from services.memory.trivium_store import trivium_store
        await trivium_store.flush_all()
        print("[Main] 所有 TriviumDB 实例磁盘同步完成。")
    except Exception as e:
        print(f"[Main] TriviumDB 强制刷盘失败: {e}")

    await sync_service.stop()
    await gateway_client.stop()
    cleanup_task.cancel()
    weekly_report_task.cancel()
    # dream_task 在 maintenance_task 内部定义
    maintenance_task.cancel()
    trigger_task.cancel()
    lonely_scan_task.cancel()  # 新增

    try:
        await cleanup_task
        await weekly_report_task
        await maintenance_task
        await trigger_task
        await lonely_scan_task  # 新增
    except asyncio.CancelledError:
        pass
    await companion_service.stop()

    # 关闭外部插件注册表
    from mods._external_plugins.service import get_external_plugin_registry

    await get_external_plugin_registry().shutdown()


app = FastAPI(
    title="萌动链接：PeroperoChat！ 后端服务",
    description="AI Agent powered backend for Pero",
    lifespan=lifespan,
)

# --- 统一异常处理 (P0-3) ---


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """统一处理 HTTPException"""
    # 允许 detail 是字典，支持透传自定义结构
    detail = exc.detail
    message = "请求失败"

    # 根据状态码映射一些基础描述
    status_msg_map = {
        400: "请求参数错误",
        401: "未授权或登录过期",
        403: "权限不足",
        404: "资源未找到",
        405: "方法不允许",
        429: "请求过于频繁",
        500: "服务器内部错误",
    }

    if isinstance(detail, dict):
        message = detail.get("message", status_msg_map.get(exc.status_code, message))
        detail = detail.get("detail", str(detail))
    else:
        message = status_msg_map.get(exc.status_code, message)

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"status": "error", "message": message, "detail": detail}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """统一处理参数校验错误"""
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "status": "error",
                "message": "请求参数验证失败喵",
                "detail": exc.errors(),
            }
        },
    )


@app.exception_handler(ResponseValidationError)
async def response_validation_handler(request: Request, exc: ResponseValidationError):
    """捕获 response_model 校验失败（P2.5）—— 防止 ASGI 层裸崩"""
    logger.error(
        f"[响应校验失败] {request.method} {request.url} | {exc.errors()}",
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "status": "error",
                "message": "服务器响应数据异常喵，请联系开发者检查日志",
                "detail": str(exc.errors()),
            }
        },
    )


@app.exception_handler(Exception)
async def all_exception_handler(request: Request, exc: Exception):
    """全局兜底异常处理"""
    logger.error(
        f"[全局异常] {request.method} {request.url} | {str(exc)}", exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "status": "error",
                "message": "系统内部发生了一件意外的事喵...",
                "detail": str(exc),
            }
        },
    )


# --------------------------

from routers.connection_router import router as connection_router

app.include_router(ide_router)
app.include_router(memory_router)

app.include_router(config_router)
app.include_router(nit_router)
app.include_router(ipc_router)
app.include_router(task_control_router)
app.include_router(agent_router)
app.include_router(asset_router)
app.include_router(group_chat_router)
app.include_router(stronghold_router)
app.include_router(connection_router)

# [插件] 社交适配器路由
from nit_core.plugins.social_adapter.social_router import router as social_router

app.include_router(social_router)

app.include_router(scheduler_router)


from routers.sync_router import router as sync_router

app.include_router(sync_router)

# --- 从 main.py 提取的新 Router ---
from routers.chat_router import router as chat_router
from routers.maintenance_router import router as maintenance_router
from routers.mcp_config_router import router as mcp_config_router
from routers.model_router import router as model_router
from routers.pet_router import router as pet_router
from routers.system_router import router as system_router
from routers.voice_router import router as voice_router

app.include_router(model_router)
app.include_router(mcp_config_router)
app.include_router(voice_router)
app.include_router(system_router)
app.include_router(pet_router)
app.include_router(maintenance_router)
from routers.ws_router import router as ws_router

app.include_router(ws_router)
app.include_router(chat_router)


# [插件] 外部插件管理路由
from mods._external_plugins.router import router as external_plugin_router

app.include_router(external_plugin_router)


def _normalize_web_unlock_target(target: str | None) -> str:
    if not target:
        return "/web/"

    normalized = target.strip()
    if not normalized.startswith("/") or normalized.startswith("//"):
        return "/web/"

    return normalized


@app.get("/web-unlock", include_in_schema=False)
async def web_unlock(request: Request, next: str = "/web/"):
    target = _normalize_web_unlock_target(next)

    if not desktop_auth_required():
        return RedirectResponse(url=target)

    if has_valid_desktop_api_key(resolve_desktop_api_key(request)):
        return RedirectResponse(url=target)

    escaped_header = html.escape(DESKTOP_API_KEY_HEADER, quote=True)
    escaped_query = html.escape(DESKTOP_API_KEY_QUERY, quote=True)
    escaped_cookie = html.escape(DESKTOP_API_KEY_COOKIE, quote=True)

    return HTMLResponse(
        f"""
<!doctype html>
<html lang=\"zh-CN\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>解锁 PeroCore WebUI</title>
    <style>
      * {{ box-sizing: border-box; }}
      body {{ margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Inter, Arial, sans-serif; background: radial-gradient(circle at top, rgba(255,181,230,.18), transparent 35%), linear-gradient(180deg, rgba(20,16,31,.98), rgba(12,10,18,1)); color: #f8f4ff; }}
      .card {{ width: min(100%, 460px); margin: 24px; border-radius: 24px; border: 1px solid rgba(255,255,255,.08); background: rgba(24,20,36,.92); box-shadow: 0 24px 80px rgba(0,0,0,.35); padding: 28px; }}
      .badge {{ display: inline-flex; margin-bottom: 16px; border-radius: 999px; background: rgba(236,72,153,.18); color: #f9a8d4; padding: 6px 12px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }}
      h1 {{ margin: 0 0 12px; font-size: 28px; }}
      p {{ margin: 0; color: rgba(248,244,255,.72); line-height: 1.6; }}
      form {{ display: flex; flex-direction: column; gap: 14px; margin-top: 24px; }}
      label {{ font-size: 14px; color: rgba(248,244,255,.82); }}
      input {{ border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(10,8,18,.9); color: #fff; padding: 14px 16px; font-size: 15px; outline: none; }}
      input:focus {{ border-color: rgba(236,72,153,.9); box-shadow: 0 0 0 3px rgba(236,72,153,.2); }}
      button {{ border: none; border-radius: 14px; background: linear-gradient(135deg, #ec4899, #8b5cf6); color: #fff; padding: 14px 16px; font-size: 15px; font-weight: 700; cursor: pointer; }}
      button:disabled {{ cursor: not-allowed; opacity: .6; }}
      .meta {{ margin-top: 16px; font-size: 13px; }}
      .error {{ margin-top: 12px; color: #fda4af; font-size: 14px; min-height: 20px; }}
    </style>
  </head>
  <body>
    <div class=\"card\">
      <div class=\"badge\">Protected</div>
      <h1>请输入访问密钥</h1>
      <p>当前 PeroCore WebUI 已启用访问保护。验证成功后会写入受保护 Cookie，随后自动跳转回原始页面。</p>
      <form id=\"unlock-form\">
        <label for=\"api-key\">访问密钥</label>
        <input id=\"api-key\" type=\"password\" autocomplete=\"current-password\" placeholder=\"请输入 PERO_DESKTOP_API_KEY\" />
        <button id=\"unlock-btn\" type=\"submit\">解锁 WebUI</button>
      </form>
      <p class=\"meta\">请求头：{escaped_header} ｜ Query：{escaped_query} ｜ Cookie：{escaped_cookie}</p>
      <div id=\"error\" class=\"error\"></div>
    </div>
    <script>
      const form = document.getElementById('unlock-form');
      const input = document.getElementById('api-key');
      const button = document.getElementById('unlock-btn');
      const errorEl = document.getElementById('error');
      const nextTarget = {json.dumps(target)};
      const sessionStorageKey = 'perocore.desktop_api_key.session';
      const localStorageKey = 'perocore.desktop_api_key.local';
      const readStoredKey = () => {{
        try {{
          return sessionStorage.getItem(sessionStorageKey) || localStorage.getItem(localStorageKey) || '';
        }} catch (_error) {{
          return '';
        }}
      }};
      form.addEventListener('submit', async (event) => {{
        event.preventDefault();
        const apiKey = input.value.trim();
        if (!apiKey) {{
          errorEl.textContent = '请输入访问密钥';
          return;
        }}
        errorEl.textContent = '';
        button.disabled = true;
        button.textContent = '验证中...';
        try {{
          const response = await fetch('/api/system/auth/validate', {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{ api_key: apiKey }})
          }});
          const payload = await response.json().catch(() => ({{}}));
          if (!response.ok) {{
            throw new Error(payload.detail || '访问密钥无效');
          }}
          window.location.replace(nextTarget);
        }} catch (error) {{
          errorEl.textContent = error?.message || '访问密钥无效';
          button.disabled = false;
          button.textContent = '解锁 WebUI';
        }}
      }});
      const storedKey = readStoredKey().trim();
      if (storedKey) {{
        input.value = storedKey;
        queueMicrotask(() => form.requestSubmit());
      }}
    </script>
  </body>
</html>
        """.strip()
    )


@app.middleware("http")
async def desktop_auth_middleware(request: Request, call_next):
    if request_requires_desktop_auth(request):
        provided = resolve_desktop_api_key(request)
        if not has_valid_desktop_api_key(provided):
            if request.url.path == "/" or request.url.path == "/web" or request.url.path.startswith("/web/"):
                target = request.url.path
                if request.url.query:
                    target = f"{target}?{request.url.query}"
                unlock_target = quote(target, safe="/?=&%#")
                return RedirectResponse(url=f"/web-unlock?next={unlock_target}")

            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Invalid desktop API key",
                    "desktop_auth_required": True,
                    "desktop_auth_header": DESKTOP_API_KEY_HEADER,
                    "desktop_auth_query": DESKTOP_API_KEY_QUERY,
                },
            )

    return await call_next(request)

dist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
if os.path.exists(dist_path):
    @app.get("/", include_in_schema=False)
    async def web_root_redirect():
        return RedirectResponse(url="/web/")

    app.mount("/web", StaticFiles(directory=dist_path, html=True), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def seed_voice_configs():
    async for session in get_session():
        # 播种语音配置
        result = await session.exec(
            select(VoiceConfig).where(VoiceConfig.type == "stt")
        )
        if not result.first():
            stt = VoiceConfig(
                type="stt",
                name="Local Whisper (Default)",
                provider="local_whisper",
                is_active=True,
                model="whisper-tiny",
                config_json='{"device": "cpu", "compute_type": "int8"}',
            )
            session.add(stt)
        result = await session.exec(
            select(VoiceConfig).where(VoiceConfig.type == "tts")
        )
        if not result.first():
            tts = VoiceConfig(
                type="tts",
                name="Edge TTS (Default)",
                provider="edge_tts",
                is_active=True,
                config_json='{"voice": "zh-CN-XiaoyiNeural", "rate": "+15%", "pitch": "+5Hz"}',
            )
            session.add(tts)

        # 播种前端访问令牌（动态握手安全）
        # 尝试从 Gateway 生成的令牌文件中读取
        token_path = os.path.join(current_dir, "data", "gateway_token.json")
        new_dynamic_token = None

        # [Optimize] 增加重试机制，等待 Gateway 启动
        max_retries = 10
        retry_delay = 0.5  # 秒

        for attempt in range(max_retries):
            if os.path.exists(token_path):
                try:
                    with open(token_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        new_dynamic_token = data.get("token")
                        if new_dynamic_token:
                            print(
                                f"[Main] 第 {attempt + 1} 次尝试：已成功加载 Gateway 令牌: {new_dynamic_token[:8]}..."
                            )
                            break
                except Exception:
                    # 如果文件正在被写入，可能会读取失败，这没关系，继续重试
                    pass

            if attempt < max_retries - 1:
                # 只有在前几次尝试失败时才打印重试日志
                if attempt % 2 == 0:
                    print(
                        f"[Main] 正在等待 Gateway 令牌生成 (第 {attempt + 1} 次尝试)..."
                    )
                await asyncio.sleep(retry_delay)

        # 如果未找到文件（例如 Gateway 未启动），则回退
        if not new_dynamic_token:
            new_dynamic_token = secrets.token_urlsafe(32)
            print("[Main] 警告: 未找到 Gateway 令牌文件。已生成本地回退令牌。")

            # [Fix] 将回退令牌写入文件，以便前端可以通过 IPC 读取
            try:
                os.makedirs(os.path.dirname(token_path), exist_ok=True)
                with open(token_path, "w", encoding="utf-8") as f:
                    json.dump({"token": new_dynamic_token}, f)
                print(f"[Main] 已将回退令牌写入: {token_path}")
            except Exception as e:
                print(f"[Main] 写入回退令牌失败: {e}")

        token_stmt = select(Config).where(Config.key == "frontend_access_token")
        token_result = await session.exec(token_stmt)
        existing_token = token_result.first()

        if not existing_token:
            token_config = Config(key="frontend_access_token", value=new_dynamic_token)
            session.add(token_config)
        else:
            existing_token.value = new_dynamic_token
            existing_token.updated_at = datetime.utcnow()
            session.add(existing_token)

        # 使用此令牌配置 GatewayClient
        gateway_client.set_token(new_dynamic_token)

        # print(f"\n" + "="*60)
        # print(f"🛡️  PERO-CORE 安全模式已启动")
        # print(f"🔑 动态访问令牌 (Handshake Token):")
        # print(f"    {new_dynamic_token}")
        # print(f"⚠️  请注意：此令牌由 Gateway 生成 (或本地回退)，用于前后端握手及 HTTP 鉴权。")
        # print(f"="*60 + "\n")

        await session.commit()
        break


if __name__ == "__main__":
    # 优先从环境变量读取端口和Host
    port = int(os.environ.get("PORT", 9120))
    host = os.environ.get("HOST", "127.0.0.1")
    # 强制禁用 reload 模式，因为 Uvicorn 的 reloader 在 Windows 下会强制使用 SelectorEventLoop
    # 这会导致 subprocess (MCP Stdio) 报错 NotImplementedError
    print(
        f"后端启动，事件循环: {asyncio.get_event_loop().__class__.__name__}, Host: {host}, Port: {port}"
    )
    uvicorn.run("main:app", host=host, port=port, reload=False)
