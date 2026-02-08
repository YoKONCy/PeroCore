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
import os
import sys

# 路径防御：确保打包后或不同目录下启动都能正确找到模块
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

import json
import base64
import re
import uuid
import psutil
import time
import secrets
from datetime import datetime
from typing import List, Dict, Any, Optional
import io

if os.name == 'nt':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if sys.stdout is not None:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if sys.stderr is not None:
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Initialize Logging
import logging
from utils.logging_config import configure_logging
log_file = os.environ.get("PERO_LOG_FILE")
configure_logging(log_file=log_file)

logger = logging.getLogger(__name__)

# [DEBUG] Print startup args and env for troubleshooting
print(f"[启动调试] sys.argv: {sys.argv}")
print(f"[启动调试] ENABLE_SOCIAL_MODE 环境变量: {os.environ.get('ENABLE_SOCIAL_MODE')}")

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Body, BackgroundTasks, UploadFile, File, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select, delete, desc
from sqlalchemy import func
from sqlmodel.ext.asyncio.session import AsyncSession
from pydantic import BaseModel, Field
import subprocess

from models import Memory, Config, PetState, ScheduledTask, AIModelConfig, MCPConfig, VoiceConfig, ConversationLog, MaintenanceRecord, AgentProfile
from database import init_db, get_session
from services.agent_service import AgentService
from services.memory_service import MemoryService
from services.memory_secretary_service import MemorySecretaryService
from services.asr_service import get_asr_service
from services.tts_service import get_tts_service
from services.realtime_session_manager import realtime_session_manager
from services.companion_service import companion_service
from services.embedding_service import embedding_service
from services.browser_bridge_service import browser_bridge_service
from services.screenshot_service import screenshot_manager
from nit_core.plugins.social_adapter.social_service import get_social_service
from core.config_manager import get_config_manager
from core.nit_manager import get_nit_manager
from nit_core.dispatcher import XMLStreamFilter
from routers.ide_router import router as ide_router
from routers.agent_router import router as agent_router
from routers.group_chat_router import router as group_chat_router



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup Technical Fingerprint
    print(r"""
██████╗ ███████╗██████╗  ██████╗  ██████╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
██████╔╝█████╗  ██████╔╝██║   ██║██║     ██║   ██║██████╔╝█████╗  
██╔═══╝ ██╔══╝  ██╔══██╗██║   ██║██║     ██║   ██║██╔══██╗██╔══╝  
██║     ███████╗██║  ██║╚██████╔╝╚██████╗╚██████╔╝██║  ██║███████╗
╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
""")
    print("="*50)
    print("🚀 PeroCore 后端启动中...")
    print(f"📅 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📂 数据目录: {os.environ.get('PERO_DATA_DIR', 'Default')}")
    
    # Check Rust Core
    try:
        from pero_memory_core import SemanticVectorIndex
        print("🧠 KDN 引擎: [就绪] (pero_memory_core 已加载)")
    except ImportError:
        print("🧠 KDN 引擎: [禁用] (未找到 pero_memory_core)")
    
    # Check Vector Store
    from services.vector_store_service import VectorStoreService
    vs = VectorStoreService()
    print(f"📊 记忆节点数: {vs.count_memories() if hasattr(vs, 'count_memories') else 'N/A'}")
    print("="*50)

    # Startup
    await init_db()
    
    # Load Config from DB
    await get_config_manager().load_from_db()
    
    # [Debug] Print loaded critical configs
    cm = get_config_manager()
    print(f"🔧 当前配置状态:")
    print(f"   - 轻量模式: {cm.get('lightweight_mode')}")
    print(f"   - 陪伴模式: {cm.get('companion_mode_enabled')}")
    print(f"   - 社交模式: {cm.get('enable_social_mode')}")
    print("="*50)
    
    await seed_voice_configs()
    await companion_service.start()
    screenshot_manager.start_background_task()
    
    # 异步预热 Embedding 模型
    asyncio.create_task(asyncio.to_thread(embedding_service.warm_up))
    
    # Start Social Service (if enabled)
    social_service = get_social_service()
    await social_service.start()

    # Start AuraVision (if enabled)
    config_mgr = get_config_manager()
    if config_mgr.get("aura_vision_enabled", False):
        from services.aura_vision_service import aura_vision_service
        if aura_vision_service.initialize():
            asyncio.create_task(aura_vision_service.start_vision_loop())
        else:
            print("[Main] 初始化 AuraVision 服务失败。")

    # Cleanup task
    async def periodic_cleanup():
        while True:
            try:
                tts = get_tts_service()
                tts.cleanup_old_files(max_age_seconds=3600)
                
                # Cleanup temp_vision
                # [Refactor] 统一指向 backend/data/temp_vision
                default_data_dir = os.path.join(current_dir, "data")
                data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
                temp_vision = os.path.join(data_dir, "temp_vision")
                if os.path.exists(temp_vision):
                    now = time.time()
                    for f in os.listdir(temp_vision):
                        f_path = os.path.join(temp_vision, f)
                        if os.path.isfile(f_path):
                            if now - os.path.getmtime(f_path) > 3600: # 1 hour
                                try:
                                    os.remove(f_path)
                                except: pass
            except Exception as e:
                print(f"[Main] 清理任务错误: {e}")
            await asyncio.sleep(3600)
    
    cleanup_task = asyncio.create_task(periodic_cleanup())

    # [Feature] Thinking Pipeline: Weekly Report Task
    async def periodic_weekly_report_check():
        from services.chain_service import chain_service
        from database import engine
        from sqlalchemy.orm import sessionmaker
        
        # Initial delay to let DB settle
        await asyncio.sleep(30) 
        
        while True:
            try:
                async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    # Check last report time
                    config_key = "last_weekly_report_time"
                    config = await session.get(Config, config_key)
                    
                    should_run = False
                    now = datetime.now()
                    
                    if not config:
                        # First run: Run immediately for demo purposes
                        should_run = True
                    else:
                        try:
                            last_time = datetime.fromisoformat(config.value)
                            if (now - last_time).total_seconds() > 7 * 24 * 3600:
                                should_run = True
                        except:
                            should_run = True # corrupted date
                            
                    if should_run:
                        print("[Main] 正在触发周报生成...")
                        report = await chain_service.generate_weekly_report(session)
                        
                        if report:
                            # [Modified] No longer saving to ConversationLog (Chat Window)
                            # log = ConversationLog(...)
                            # session.add(log)

                            # [Feature] Save Weekly Report to File (pero_workspace/log)
                            try:
                                import os
                                # Get backend dir (assuming main.py is in backend/)
                                backend_dir = os.path.dirname(os.path.abspath(__file__))
                                # Path: PeroCore/pero_workspace/log
                                # We need to go up from backend? No, structure is PeroCore/backend.
                                # User said "PeroCore\pero_workspace\log". 
                                # Assuming workspace is at project root (PeroCore/).
                                project_root = os.path.dirname(backend_dir)
                                # [Update] Change path to pero_workspace/{agent_id}/weeklyport
                                from services.agent_manager import AgentManager
                                agent_manager = AgentManager()
                                active_agent_id = agent_manager.active_agent_id
                                log_dir = os.path.join(project_root, "pero_workspace", active_agent_id, "weeklyport")
                                os.makedirs(log_dir, exist_ok=True)
                                
                                filename = f"{now.strftime('%Y-%m-%d')}_Weekly_Report.md"
                                file_path = os.path.join(log_dir, filename)
                                
                                with open(file_path, "w", encoding="utf-8") as f:
                                    f.write(report)
                                    
                                print(f"[Main] 周报已保存到文件: {file_path}")
                                
                                # [Feature] Persist Weekly Report Index to Memory (VectorDB)
                                # We store a summary/pointer instead of full content to keep context clean?
                                # User said "store index for retrieval in database".
                                # We will store the full content but mark it with specific type for "Independent Retrieval".
                                # Actually, storing full content is better for search unless it's huge.
                                # But we'll add the file path reference.
                                
                                # [Update] Update file path in DB content
                                # [Modified] User requested NOT to store document types in DB at all.
                                # db_content = f"【周报归档】{now.strftime('%Y-%m-%d')}\n> 📁 File Archived: weeklyport/{filename}\n\n{report}"
                                
                                # await MemoryService.save_memory(
                                #     session=session,
                                #     content=db_content,
                                #     tags="weekly_report,summary",
                                #     clusters="[周报归档]",
                                #     importance=3, # High importance
                                #     memory_type="weekly_report", # Special type for independent retrieval
                                #     source="system"
                                # )
                                print("[Main] 周报仅保存到文件 (DB 存储已按用户请求禁用)。")
                            except Exception as e:
                                print(f"[Main] 保存周报失败: {e}")
                            
                            # Update Config
                            if not config:
                                config = Config(key=config_key, value=now.isoformat())
                                session.add(config)
                            else:
                                config.value = now.isoformat()
                                config.updated_at = now
                            
                            await session.commit()
                            print("[Main] 周报已生成并保存 (静默模式)。")

                            # [Modified] No longer broadcasting to Frontend
                            # try:
                            #     ...
                            # except ...
                        else:
                            print("[Main] 周报生成已跳过 (无内容/错误)。")
                            
            except Exception as e:
                print(f"[Main] 周报任务错误: {e}")
            
            # Check every hour
            await asyncio.sleep(3600)

    weekly_report_task = asyncio.create_task(periodic_weekly_report_check())

    # [Feature] Dream Mode: Daily trigger at 22:00
    async def periodic_dream_check():
        from database import engine
        from sqlalchemy.orm import sessionmaker
        from datetime import timedelta
        
        await asyncio.sleep(60) # Initial delay
        
        while True:
            try:
                async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    now = datetime.now()
                    
                    # Calculate the latest scheduled trigger time (22:00)
                    if now.hour < 22:
                        latest_scheduled = now.replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
                    else:
                        latest_scheduled = now.replace(hour=22, minute=0, second=0, microsecond=0)
                    
                    # Check last trigger time
                    config_key = "last_dream_trigger_time"
                    config = await session.get(Config, config_key)
                    
                    last_trigger_time = datetime.min
                    if config:
                        try:
                            last_trigger_time = datetime.fromisoformat(config.value)
                        except:
                            pass
                    
                    if last_trigger_time < latest_scheduled:
                        print(f"[Main] 触发定时梦境模式 (上次: {last_trigger_time}, 计划: {latest_scheduled})")
                        # Instantiate AgentService to use its _trigger_dream method
                        from services.agent_service import AgentService
                        agent_service = AgentService(session)
                        await agent_service._trigger_dream()
            except Exception as e:
                print(f"[Main] 梦境检查任务错误: {e}")
            
            # Check every 15 minutes
            await asyncio.sleep(900)

    # [Feature] Memory Maintenance & Dream: Daily trigger at 22:00 PM
    async def periodic_memory_maintenance_check():
        from database import engine
        from sqlalchemy.orm import sessionmaker
        from datetime import timedelta
        
        await asyncio.sleep(120) # Initial delay
        
        while True:
            try:
                async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    now = datetime.now()
                    
                    # Calculate the latest scheduled trigger time (22:00 PM)
                    if now.hour < 22:
                        latest_scheduled = now.replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
                    else:
                        latest_scheduled = now.replace(hour=22, minute=0, second=0, microsecond=0)
                    
                    # Check last maintenance time
                    config_key = "last_memory_maintenance_time"
                    config = await session.get(Config, config_key)
                    
                    last_time = datetime.min
                    if config:
                        try:
                            last_time = datetime.fromisoformat(config.value)
                        except:
                            pass
                    
                    if last_time < latest_scheduled:
                        print(f"[Main] 触发定时记忆维护与梦境 (上次: {last_time}, 计划: {latest_scheduled})")
                        
                        # 1. Trigger Memory Secretary (Maintenance)
                        from services.memory_secretary_service import MemorySecretaryService
                        maintenance_service = MemorySecretaryService(session)
                        
                        # 2. Trigger Agent Service (Dream)
                        from services.agent_service import AgentService
                        agent_service = AgentService(session)

                        # Run both in parallel
                        try:
                            await asyncio.gather(
                                maintenance_service.run_maintenance(),
                                agent_service._trigger_dream()
                            )
                        except Exception as inner_e:
                            print(f"[Main] 维护/梦境任务内部错误: {inner_e}")
                        
                        # Update config
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
            
            # Check every 1 hour
            await asyncio.sleep(3600)

    maintenance_task = asyncio.create_task(periodic_memory_maintenance_check())

    # [Feature] Lonely Memory Scanner: Hourly trigger
    async def periodic_lonely_scan_check():
        from database import engine
        from sqlalchemy.orm import sessionmaker
        from services.reflection_service import ReflectionService
        
        # Initial delay to stagger with other tasks
        await asyncio.sleep(300) 
        
        while True:
            try:
                # [Optimization] Check if system is under heavy load or user is chatting?
                # For now, rely on async concurrency. 
                # scan_lonely_memories yields frequently (DB, LLM).
                
                # print("[Main] Starting hourly lonely memory scan...", flush=True)
                async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    service = ReflectionService(session)
                    await service.scan_lonely_memories(limit=2)
            except Exception as e:
                print(f"[Main] 孤独记忆扫描任务错误: {e}")
            
            # Check every 1 hour
            await asyncio.sleep(3600)

    lonely_scan_task = asyncio.create_task(periodic_lonely_scan_check())

    # [Feature] Periodic Trigger Check (Reminders & Topics)
    # Replaces frontend polling with backend scheduling
    async def execute_and_broadcast_chat(instruction: str, session: AsyncSession):
        """Execute a trigger chat and broadcast the result to all connected clients."""
        from services.agent_service import AgentService
        agent_service = AgentService(session)
        full_response = ""
        
        try:
            # 1. Notify clients that Pero is thinking
            await realtime_session_manager.broadcast({"type": "status", "content": "thinking"})
            
            # 2. Run the chat
            async for chunk in agent_service.chat(
                messages=[], 
                source="system_trigger", 
                system_trigger_instruction=instruction
            ):
                if chunk:
                    full_response += chunk
            
            if full_response:
                # 3. Clean and parse response (using realtime_session_manager's logic)
                ui_response = realtime_session_manager._clean_text(full_response, for_tts=False)
                tts_response = realtime_session_manager._clean_text(full_response, for_tts=True)
                
                # 4. Broadcast the text response
                await realtime_session_manager.broadcast({"type": "status", "content": "speaking"})
                await realtime_session_manager.broadcast({"type": "text_response", "content": ui_response})
                
                # 5. Handle TTS and broadcast audio (Optional but recommended for consistency)
                target_voice, target_rate, target_pitch = realtime_session_manager._get_voice_params(full_response)
                tts_service = get_tts_service()
                audio_path = await tts_service.synthesize(
                    tts_response,
                    voice=target_voice,
                    rate=target_rate,
                    pitch=target_pitch
                )
                
                if audio_path:
                    ext = os.path.splitext(audio_path)[1].replace('.', '') or "mp3"
                    with open(audio_path, "rb") as f:
                        audio_content = f.read()
                        audio_b64 = base64.b64encode(audio_content).decode('utf-8')
                        await realtime_session_manager.broadcast({
                            "type": "audio_response", 
                            "data": audio_b64,
                            "format": ext
                        })
                
                # 6. Reset to idle
                await realtime_session_manager.broadcast({"type": "status", "content": "idle"})
        except Exception as e:
            print(f"[Main] 执行并广播触发对话失败: {e}")
            await realtime_session_manager.broadcast({"type": "status", "content": "idle"})

    async def periodic_trigger_check():
        from database import engine
        from sqlalchemy.orm import sessionmaker
        
        await asyncio.sleep(10) # Initial delay
        
        while True:
            try:
                async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    now = datetime.now()
                    tasks = (await session.exec(select(ScheduledTask).where(ScheduledTask.is_triggered == False))).all()
                    
                    # 1. Reminders
                    due_reminders = [t for t in tasks if t.type == "reminder" and datetime.fromisoformat(t.time.replace('Z', '+00:00')).replace(tzinfo=None) <= now]
                    for task in due_reminders:
                        print(f"[Main] 触发提醒: {task.content}")
                        instruction = f"【管理系统提醒：Pero，你与主人的约定时间已到，请主动提醒主人。约定内容：{task.content}】"
                        
                        # Mark as triggered FIRST
                        task.is_triggered = True
                        session.add(task)
                        await session.commit()
                        
                        # Trigger Chat and Broadcast
                        await execute_and_broadcast_chat(instruction, session)
                            
                    # 2. Topics (Grouped)
                    due_topics = [t for t in tasks if t.type == "topic" and not t.is_triggered and datetime.fromisoformat(t.time.replace('Z', '+00:00')).replace(tzinfo=None) <= now]
                    
                    if due_topics:
                        topic_list_str = "\n".join([f"- {t.content}" for t in due_topics])
                        print(f"[Main] Triggering Topics: {len(due_topics)} items")
                        instruction = f"【管理系统提醒：Pero，以下是你之前想找主人聊的话题（已汇总）：\n{topic_list_str}\n\n请将这些话题自然地融合在一起，作为一次主动的聊天开场。】"
                        
                        for t in due_topics:
                            t.is_triggered = True
                            session.add(t)
                        await session.commit()
                        
                        # Trigger Chat and Broadcast
                        await execute_and_broadcast_chat(instruction, session)

                    # 3. Reactions (Pre-actions)
                    due_reactions = [t for t in tasks if t.type == "reaction" and not t.is_triggered and datetime.fromisoformat(t.time.replace('Z', '+00:00')).replace(tzinfo=None) <= now]
                    for task in due_reactions:
                        print(f"[Main] Triggering Reaction: {task.content}")
                        instruction = f"【管理系统提醒：Pero，你之前决定：‘{task.content}’。现在触发时间已到，请立刻执行该行为。】"
                        
                        task.is_triggered = True
                        session.add(task)
                        await session.commit()
                        
                        await execute_and_broadcast_chat(instruction, session)

            except Exception as e:
                print(f"[Main] 触发检查任务错误: {e}")
            
            await asyncio.sleep(30) # Check every 30 seconds

    trigger_task = asyncio.create_task(periodic_trigger_check())
    
    yield
    
    # Shutdown
    cleanup_task.cancel()
    weekly_report_task.cancel()
    # dream_task is not defined here, it's inside maintenance_task
    maintenance_task.cancel()
    trigger_task.cancel()
    lonely_scan_task.cancel() # Added
    
    try:
        await cleanup_task
        await weekly_report_task
        await maintenance_task
        await trigger_task
        await lonely_scan_task # Added
    except asyncio.CancelledError:
        pass
    await companion_service.stop()

app = FastAPI(title="PeroCore Backend", description="AI Agent powered backend for Pero", lifespan=lifespan)
app.include_router(ide_router)
app.include_router(agent_router)
app.include_router(group_chat_router)

class TTSPreviewRequest(BaseModel):
    text: str

@app.post("/api/tts/preview")
async def preview_tts(request: TTSPreviewRequest):
    """
    Generate TTS audio for the given text, applying the same filtering and mood analysis as the voice mode.
    """
    text = request.text
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")

    # 1. Clean Text (Reuse logic from RealtimeSessionManager)
    # _clean_text is protected but we access it here for consistency
    cleaned_text = realtime_session_manager._clean_text(text, for_tts=True)
    
    if not cleaned_text or not cleaned_text.strip():
        # If nothing remains (e.g. only thinking process), return 204 No Content or 400
        # Front-end should handle this gracefully
        raise HTTPException(status_code=400, detail="No speakable text content")
    
    # 2. Get Voice Params (Mood analysis based on FULL original text)
    voice, rate, pitch = realtime_session_manager._get_voice_params(text)
    
    # 3. Synthesize
    tts = get_tts_service()
    
    filepath = await tts.synthesize(cleaned_text, voice=voice, rate=rate, pitch=pitch)
    
    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=500, detail="TTS generation failed")
        
    return FileResponse(filepath, media_type="audio/mpeg", filename="preview.mp3")


dist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
if os.path.exists(dist_path):
    app.mount("/web", StaticFiles(directory=dist_path, html=True), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models for Validation ---

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    source: str = "desktop"
    session_id: str = Field(default="default", alias="sessionId")
    
    # 允许前端传入建议值，但后端会根据策略决定是否使用
    model: Optional[str] = None
    temperature: Optional[float] = None

async def verify_token(authorization: Optional[str] = Header(None), session: AsyncSession = Depends(get_session)):
    """
    验证前端传来的 Token。实现“前端不可信”原则的第一步。
    """
    # 获取后端预设的 Access Token
    config_stmt = select(Config).where(Config.key == "frontend_access_token")
    config_result = await session.exec(config_stmt)
    db_config = config_result.first()
    
    expected_token = db_config.value if db_config else "pero_default_token"
    
    # 如果是本地开发环境且没有设置 token，可以放行 (可选)
    # if not db_config and os.environ.get("ENV") == "dev": return
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权访问：缺少令牌")
    
    token = authorization.split(" ")[1]
    if token != expected_token:
        raise HTTPException(status_code=403, detail="未授权访问：令牌无效")
    
    return token

async def seed_voice_configs():
    async for session in get_session():
        # Seed Voice Configs
        result = await session.exec(select(VoiceConfig).where(VoiceConfig.type == "stt"))
        if not result.first():
            stt = VoiceConfig(type="stt", name="Local Whisper (Default)", provider="local_whisper", is_active=True, model="whisper-tiny", config_json='{"device": "cpu", "compute_type": "int8"}')
            session.add(stt)
        result = await session.exec(select(VoiceConfig).where(VoiceConfig.type == "tts"))
        if not result.first():
            tts = VoiceConfig(type="tts", name="Edge TTS (Default)", provider="edge_tts", is_active=True, config_json='{"voice": "zh-CN-XiaoyiNeural", "rate": "+15%", "pitch": "+5Hz"}')
            session.add(tts)
            
        # Seed Frontend Access Token (Dynamic Handshake Security)
        # 每次启动都生成一个新的强加密随机令牌
        new_dynamic_token = secrets.token_urlsafe(32)
        
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
            
        print(f"\n" + "="*60)
        print(f"🛡️  PERO-CORE 安全模式已启动")
        print(f"🔑 动态访问令牌 (Handshake Token):")
        print(f"    {new_dynamic_token}")
        print(f"⚠️  请注意：此令牌仅本次启动有效，重启后端后需重新配置。")
        print(f"="*60 + "\n")
            
        await session.commit()
        break

@app.websocket("/ws/browser")
async def websocket_browser_endpoint(websocket: WebSocket):
    await browser_bridge_service.connect(websocket)

@app.websocket("/ws/voice")
async def websocket_voice_endpoint(websocket: WebSocket):
    await realtime_session_manager.handle_websocket(websocket)

@app.get("/api/pet/state")
async def get_pet_state(session: AsyncSession = Depends(get_session)):
    try:
        # Get active agent info FIRST
        from services.agent_manager import get_agent_manager
        agent_manager = get_agent_manager()
        active_agent = agent_manager.get_active_agent()
        active_agent_id = active_agent.id if active_agent else "pero"

        # Find PetState for active agent
        statement = select(PetState).where(PetState.agent_id == active_agent_id)
        state = (await session.exec(statement)).first()
        
        if not state:
            # 初始化默认状态
            state = PetState(
                agent_id=active_agent_id,
                mood="开心",
                vibe="正常",
                mind="正在想主人..."
            )
            session.add(state)
            await session.commit()
            await session.refresh(state)
            
        # Convert to dict and add active_agent info
        response_data = state.model_dump()
        if active_agent:
            response_data["active_agent"] = {
                "id": active_agent.id,
                "name": active_agent.name
            }
            
        return response_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ping")
async def ping():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.get("/api/system/status")
async def get_system_status():
    try:
        # psutil.cpu_percent(interval=None) returns immediately if called before, 
        # but might return 0.0 on first call. 
        # Since we poll, it should be fine.
        cpu_percent = psutil.cpu_percent(interval=None) 
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        return {
            "cpu": {
                "percent": cpu_percent,
                "count": psutil.cpu_count()
            },
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "percent": memory.percent,
                "used": memory.used
            },
            "disk": {
                "total": disk.total,
                "used": disk.used,
                "percent": disk.percent
            },
            "boot_time": psutil.boot_time()
        }
    except Exception as e:
        print(f"System status error: {e}")
        return {"error": str(e)}

@app.get("/api/nit/settings")
async def get_nit_settings():
    """获取所有 NIT 调度设置"""
    return get_nit_manager().get_all_settings()

@app.post("/api/nit/settings/category")
async def set_nit_category(category: str = Body(..., embed=True), enabled: bool = Body(..., embed=True)):
    """设置分类开关 (Level 1)"""
    get_nit_manager().set_category_status(category, enabled)
    return {"status": "success", "message": f"Category {category} set to {enabled}. Restart required for some changes."}

@app.post("/api/nit/settings/plugin")
async def set_nit_plugin(plugin_name: str = Body(..., embed=True), enabled: bool = Body(..., embed=True)):
    """设置插件开关 (Level 2)"""
    get_nit_manager().set_plugin_status(plugin_name, enabled)
    return {"status": "success", "message": f"Plugin {plugin_name} set to {enabled}. Restart required for some changes."}

@app.post("/api/config/social_mode")
async def set_social_mode(enabled: bool = Body(..., embed=True)):
    """
    (Deprecated) Toggle Social Mode. Now handled by NITManager Level 2.
    """
    get_nit_manager().set_plugin_status("social_adapter", enabled)
    
    social_service = get_social_service()
    if enabled:
        await social_service.start()
    else:
        await social_service.stop()
        
    return {"status": "success", "enabled": enabled, "message": "Plugin status updated. Restart required for full effect."}

@app.get("/api/config/social_mode")
async def get_social_mode():
    return {"enabled": get_nit_manager().is_plugin_enabled("social_adapter")}

@app.websocket("/api/social/ws")
async def social_websocket(websocket: WebSocket):
    social_service = get_social_service()
    await social_service.handle_websocket(websocket)

@app.get("/api/config/lightweight_mode")
async def get_lightweight_mode():
    return {"enabled": get_config_manager().get("lightweight_mode", False)}

@app.post("/api/config/lightweight_mode")
async def set_lightweight_mode(enabled: bool = Body(..., embed=True)):
    await get_config_manager().set("lightweight_mode", enabled)
    return {"status": "success", "enabled": enabled}

@app.get("/api/config/aura_vision")
async def get_aura_vision_mode():
    return {"enabled": get_config_manager().get("aura_vision_enabled", False)}

@app.post("/api/config/aura_vision")
async def set_aura_vision_mode(enabled: bool = Body(..., embed=True)):
    await get_config_manager().set("aura_vision_enabled", enabled)
    
    from services.aura_vision_service import aura_vision_service
    if enabled:
        if not aura_vision_service.is_running:
            if aura_vision_service.initialize():
                asyncio.create_task(aura_vision_service.start_vision_loop())
            else:
                return {"status": "error", "message": "Failed to initialize AuraVision Service"}
    else:
        aura_vision_service.stop()
        
    return {"status": "success", "enabled": enabled}

@app.get("/api/config/tts")
async def get_tts_mode():
    return {"enabled": get_config_manager().get("tts_enabled", True)}

@app.post("/api/config/tts")
async def set_tts_mode(enabled: bool = Body(..., embed=True)):
    await get_config_manager().set("tts_enabled", enabled)
    return {"status": "success", "enabled": enabled}

@app.delete("/api/memories/by_timestamp/{msg_timestamp}")
async def delete_memory_by_timestamp(msg_timestamp: str, session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    await service.delete_by_msg_timestamp(session, msg_timestamp)
    return {"status": "success"}

@app.post("/api/memory/secretary/run")
async def run_memory_secretary(session: AsyncSession = Depends(get_session)):
    try:
        service = MemorySecretaryService(session)
        return await service.run_maintenance()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{source}/{session_id}")
async def get_chat_history(
    source: str, 
    session_id: str, 
    limit: int = 50, 
    offset: int = 0,
    date: str = None,
    sort: str = "asc",
    agent_id: Optional[str] = None, # Add agent_id param
    session: AsyncSession = Depends(get_session)
):
    service = MemoryService()
    # If agent_id is not provided, default to "pero" to maintain backward compatibility,
    # OR we can make it optional in service.get_recent_logs?
    # service.get_recent_logs defaults to "pero".
    # If we want to support "all agents" when agent_id is None, we need to modify service.
    # But usually dashboard views a specific agent.
    # Let's pass agent_id if provided, otherwise default "pero" (handled by service default).
    
    target_agent = agent_id if agent_id else "pero"
    logs = await service.get_recent_logs(session, source, session_id, limit, offset=offset, date_str=date, sort=sort, agent_id=target_agent)
    return [{
        "id": log.id, 
        "role": log.role, 
        "content": log.content, 
        "raw_content": getattr(log, "raw_content", None), # Return raw content
        "timestamp": log.timestamp,
        "sentiment": getattr(log, "sentiment", None),
        "importance": getattr(log, "importance", None),
        "metadata_json": log.metadata_json,
        "pair_id": getattr(log, "pair_id", None),
        "analysis_status": getattr(log, "analysis_status", "pending"),
        "retry_count": getattr(log, "retry_count", 0),
        "last_error": getattr(log, "last_error", None)
    } for log in logs]

async def run_retry_background(log_id: int):
    from database import engine
    from sqlmodel.ext.asyncio.session import AsyncSession
    from sqlalchemy.orm import sessionmaker
    from services.scorer_service import ScorerService
    
    try:
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with async_session() as session:
            scorer = ScorerService(session)
            await scorer.retry_interaction(log_id)
    except Exception as e:
        print(f"[Main] 后台重试日志 {log_id} 失败: {e}")

@app.post("/api/history/{log_id}/retry_analysis")
async def retry_log_analysis(log_id: int, background_tasks: BackgroundTasks, session: AsyncSession = Depends(get_session)):
    log = await session.get(ConversationLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    
    # Check if retryable (e.g. only assistant logs or user logs that are part of a pair)
    # Actually, the user can retry any log, but only paired ones will work in ScorerService.
    # We let ScorerService handle the validation.
    
    background_tasks.add_task(run_retry_background, log_id)
    return {"status": "queued", "message": "Analysis retry started in background"}

@app.delete("/api/history/{log_id}")
async def delete_chat_log(log_id: int, session: AsyncSession = Depends(get_session)):
    try:
        service = MemoryService()
        await service.delete_log(session, log_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/history/{log_id}")
async def update_chat_log(log_id: int, payload: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    try:
        log = await session.get(ConversationLog, log_id)
        if not log:
            raise HTTPException(status_code=404, detail="Log not found")
        if "content" in payload:
            log.content = payload["content"]
        await session.commit()
        await session.refresh(log)
        return log
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/companion/status")
async def get_companion_status(session: AsyncSession = Depends(get_session)):
    config = await session.get(Config, "companion_mode_enabled")
    enabled = config.value == "true" if config else False
    return {"enabled": enabled}

# --- Task Control APIs ---
from services.task_manager import task_manager

@app.post("/api/task/{session_id}/pause")
async def pause_task(session_id: str):
    success = task_manager.pause(session_id)
    if success:
        return {"status": "success", "message": "Task paused"}
    raise HTTPException(status_code=404, detail="Task not found")

@app.post("/api/task/{session_id}/resume")
async def resume_task(session_id: str):
    success = task_manager.resume(session_id)
    if success:
        return {"status": "success", "message": "Task resumed"}
    raise HTTPException(status_code=404, detail="Task not found")

@app.post("/api/task/{session_id}/inject")
async def inject_instruction(session_id: str, payload: Dict[str, str] = Body(...)):
    instruction = payload.get("instruction")
    if not instruction:
        raise HTTPException(status_code=400, detail="Instruction is required")
        
    success = task_manager.inject_instruction(session_id, instruction)
    if success:
        return {"status": "success", "message": "Instruction injected"}
    raise HTTPException(status_code=404, detail="Task not found")

@app.get("/api/task/{session_id}/status")
async def get_task_status(session_id: str):
    status = task_manager.get_status(session_id)
    if status:
        return {"status": status}
    # If not found, assume idle/completed
    return {"status": "idle"}

@app.post("/api/companion/toggle")
async def toggle_companion(enabled: bool = Body(..., embed=True), session: AsyncSession = Depends(get_session)):
    # [Requirement] Companion mode depends on Lightweight mode
    config_mgr = get_config_manager()
    if enabled and not config_mgr.get("lightweight_mode", False):
        raise HTTPException(status_code=400, detail="请先开启“轻量模式”后再启动陪伴模式。")

    config = await session.get(Config, "companion_mode_enabled")
    if not config:
        config = Config(key="companion_mode_enabled", value="false")
        session.add(config)
    
    config.value = "true" if enabled else "false"
    config.updated_at = datetime.utcnow()
    await session.commit()
    
    # Sync with ConfigManager
    await get_config_manager().set("companion_mode_enabled", enabled)
    
    if enabled:
        await companion_service.start()
    else:
        await companion_service.stop()
        
    return {"status": "success", "enabled": enabled}

# --- Social Mode APIs ---
@app.get("/api/social/status")
async def get_social_status(session: AsyncSession = Depends(get_session)):
    config = await session.get(Config, "enable_social_mode")
    enabled = config.value == "true" if config else False
    return {"enabled": enabled}

@app.post("/api/social/toggle")
async def toggle_social(enabled: bool = Body(..., embed=True), session: AsyncSession = Depends(get_session)):
    # 1. Update DB & Memory
    await get_config_manager().set("enable_social_mode", enabled)
    
    # 2. Update Service
    social_service = get_social_service()
    
    # 3. Refresh NIT Tools (ensure social tools are added/removed)
    try:
        from nit_core.dispatcher import get_dispatcher
        dispatcher = get_dispatcher()
        dispatcher.reload_tools()
        print(f"[Main] NIT Tools reloaded after social mode toggle (Enabled: {enabled})")
    except Exception as e:
        print(f"[Main] Failed to reload NIT tools: {e}")
    
    if enabled:
        await social_service.start()
    else:
        await social_service.stop()
        
    return {"status": "success", "enabled": enabled}

@app.get("/api/tasks", response_model=List[ScheduledTask])
async def get_tasks(agent_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    statement = select(ScheduledTask).where(ScheduledTask.is_triggered == False)
    if agent_id:
        statement = statement.where(ScheduledTask.agent_id == agent_id)
    return (await session.exec(statement)).all()

@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    try:
        task = await session.get(ScheduledTask, task_id)
        if not task: raise HTTPException(status_code=404, detail="Task not found")
        await session.delete(task)
        await session.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/check")
async def check_tasks(session: AsyncSession = Depends(get_session)):
    import pytz
    now = datetime.now()
    tasks = (await session.exec(select(ScheduledTask).where(ScheduledTask.is_triggered == False))).all()
    triggered_prompts = []
    
    due_reminders = [t for t in tasks if t.type == "reminder" and datetime.fromisoformat(t.time.replace('Z', '+00:00')).replace(tzinfo=None) <= now]
    if due_reminders:
        task = due_reminders[0]
        triggered_prompts.append(f"【管理系统提醒：Pero，你与主人的约定时间已到，请主动提醒主人。约定内容：{task.content}】")
        task.is_triggered = True
        session.add(task)

    if not triggered_prompts:
         due_topics = [t for t in tasks if t.type == "topic" and datetime.fromisoformat(t.time.replace('Z', '+00:00')).replace(tzinfo=None) <= now]
         if due_topics:
            topic_list_str = "\n".join([f"- {t.content}" for t in due_topics])
            triggered_prompts.append(f"【管理系统提醒：Pero，以下是你之前想找主人聊的话题（已汇总）：\n{topic_list_str}\n\n请将这些话题自然地融合在一起，作为一次主动的聊天开场。】")

            for t in due_topics:
                t.is_triggered = True
                session.add(t)
    
    if not triggered_prompts:
        last_log = (await session.exec(select(ConversationLog).where(ConversationLog.role != "system").order_by(desc(ConversationLog.timestamp)).limit(1))).first()
        if last_log and (now - last_log.timestamp).total_seconds() > 1200:
             pass

    await session.commit()
    return {"prompts": triggered_prompts}

@app.get("/api/configs")
async def get_configs(session: AsyncSession = Depends(get_session)):
    configs = (await session.exec(select(Config))).all()
    return {c.key: c.value for c in configs}

@app.post("/api/configs")
async def update_config(configs: Dict[str, str], session: AsyncSession = Depends(get_session)):
    # [Check] Block enabling incompatible modes if in Work Mode
    try:
        current_session = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        is_work_mode = current_session and current_session.value.startswith("work_")
        
        if is_work_mode:
            blocking_modes = ["lightweight_mode", "companion_mode", "aura_vision_enabled"]
            # Map keys to Chinese names
            name_map = {
                "lightweight_mode": "轻量模式",
                "companion_mode": "陪伴模式",
                "aura_vision_enabled": "主动视觉模式"
            }
            
            for key, value in configs.items():
                if key in blocking_modes:
                    # Check if user is trying to enable it (value is true)
                    is_enabling = str(value).lower() == 'true'
                    if is_enabling:
                         raise HTTPException(status_code=403, detail=f"无法启用{name_map.get(key, key)}：当前处于工作模式（会话隔离中）。请先退出工作模式。")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Config] Work Mode check failed: {e}")

    for key, value in configs.items():
        config_obj = await session.get(Config, key)
        if config_obj:
            config_obj.value = value
        else:
            config_obj = Config(key=key, value=value)
            session.add(config_obj)
    await session.commit()
    return {"status": "success"}

@app.get("/api/models", response_model=List[AIModelConfig])
async def get_models(session: AsyncSession = Depends(get_session)):
    return (await session.exec(select(AIModelConfig))).all()

@app.post("/api/models", response_model=AIModelConfig)
async def create_model(model_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    model_data.pop('id', None)
    model = AIModelConfig(**model_data)
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return model

@app.put("/api/models/{model_id}", response_model=AIModelConfig)
async def update_model(model_id: int, model_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    db_model = await session.get(AIModelConfig, model_id)
    if not db_model: raise HTTPException(status_code=404, detail="Model not found")
    for key, value in model_data.items():
        if hasattr(db_model, key) and key not in ['id', 'created_at']:
            setattr(db_model, key, value)
    db_model.updated_at = datetime.utcnow()
    session.add(db_model)
    await session.commit()
    await session.refresh(db_model)
    return db_model

@app.delete("/api/models/{model_id}")
async def delete_model(model_id: int, session: AsyncSession = Depends(get_session)):
    db_model = await session.get(AIModelConfig, model_id)
    if not db_model: raise HTTPException(status_code=404, detail="Model not found")
    await session.delete(db_model)
    await session.commit()
    return {"status": "success"}

@app.get("/api/mcp", response_model=List[MCPConfig])
async def get_mcps(session: AsyncSession = Depends(get_session)):
    return (await session.exec(select(MCPConfig))).all()

@app.post("/api/mcp", response_model=MCPConfig)
async def create_mcp(mcp_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    mcp_data.pop('id', None)
    mcp_data.pop('created_at', None)
    mcp_data.pop('updated_at', None)
    new_mcp = MCPConfig(**mcp_data)
    session.add(new_mcp)
    await session.commit()
    await session.refresh(new_mcp)
    return new_mcp

@app.put("/api/mcp/{mcp_id}", response_model=MCPConfig)
async def update_mcp(mcp_id: int, mcp_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    db_mcp = await session.get(MCPConfig, mcp_id)
    if not db_mcp: raise HTTPException(status_code=404, detail="MCP not found")
    for key, value in mcp_data.items():
        if hasattr(db_mcp, key) and key not in ['id', 'created_at', 'updated_at']:
            setattr(db_mcp, key, value)
    db_mcp.updated_at = datetime.utcnow()
    session.add(db_mcp)
    await session.commit()
    await session.refresh(db_mcp)
    return db_mcp

@app.delete("/api/mcp/{mcp_id}")
async def delete_mcp(mcp_id: int, session: AsyncSession = Depends(get_session)):
    db_mcp = await session.get(MCPConfig, mcp_id)
    if not db_mcp: raise HTTPException(status_code=404, detail="MCP not found")
    await session.delete(db_mcp)
    await session.commit()
    return {"status": "success"}

@app.get("/api/nit/status")
async def get_nit_status(session: AsyncSession = Depends(get_session)):
    from nit_core.dispatcher import get_dispatcher
    dispatcher = get_dispatcher()
    
    # Use PluginManager to get high-level plugin names (e.g. "TimeOps") instead of all commands
    plugin_names = dispatcher.pm.list_plugins()
    plugins_data = [{"name": name} for name in plugin_names]
    
    # Get enabled MCPs count
    mcp_count = len((await session.exec(select(MCPConfig).where(MCPConfig.enabled == True))).all())
    
    return {
        "nit_version": "1.0",
        "plugins_count": len(plugin_names),
        "active_mcp_count": mcp_count,
        "plugins": plugins_data
    }

# --- Memory Dashboard API ---

@app.get("/api/memories/list")
async def list_memories(
    limit: int = 50, 
    offset: int = 0, 
    date_start: str = None, 
    date_end: str = None, 
    tags: str = None,
    type: str = None, # Allow filtering by memory type
    agent_id: Optional[str] = None, # Add agent_id param
    session: AsyncSession = Depends(get_session)
):
    service = MemoryService()
    # Pass agent_id to get_all_memories
    target_agent = agent_id if agent_id else "pero"
    return await service.get_all_memories(session, limit, offset, date_start, date_end, tags, memory_type=type, agent_id=target_agent)

@app.get("/api/memories/graph")
async def get_memory_graph(limit: int = 100, agent_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    target_agent = agent_id if agent_id else "pero"
    return await service.get_memory_graph(session, limit, agent_id=target_agent)

@app.delete("/api/memories/orphaned_edges")
async def delete_orphaned_edges(session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    count = await service.delete_orphaned_edges(session)
    return {"status": "success", "deleted_count": count}

@app.post("/api/memories/scan_lonely")
async def scan_lonely_memories(limit: int = 5, session: AsyncSession = Depends(get_session)):
    from services.reflection_service import ReflectionService
    service = ReflectionService(session)
    result = await service.scan_lonely_memories(limit=limit)
    return result

@app.post("/api/memories/maintenance")
async def run_maintenance(session: AsyncSession = Depends(get_session)):
    from services.memory_secretary_service import MemorySecretaryService
    service = MemorySecretaryService(session)
    result = await service.run_maintenance()
    return result

@app.post("/api/memories/dream")
async def trigger_dream(limit: int = 10, session: AsyncSession = Depends(get_session)):
    from services.reflection_service import ReflectionService
    service = ReflectionService(session)
    result = await service.dream_and_associate(limit=limit)
    return result

@app.get("/api/memories/tags")
async def get_tag_cloud(agent_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    target_agent = agent_id if agent_id else "pero"
    return await service.get_tag_cloud(session, agent_id=target_agent)

@app.get("/api/voice-configs", response_model=List[VoiceConfig])
async def get_voice_configs(session: AsyncSession = Depends(get_session)):
    return (await session.exec(select(VoiceConfig))).all()

@app.post("/api/voice-configs", response_model=VoiceConfig)
async def create_voice_config(config_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    try:
        # 检查重名
        name = config_data.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="名称不能为空")
            
        existing = (await session.exec(select(VoiceConfig).where(VoiceConfig.name == name))).first()
        if existing:
            raise HTTPException(status_code=400, detail="名称已存在")
        
        # 移除自动字段
        config_data.pop('id', None)
        config_data.pop('created_at', None)
        config_data.pop('updated_at', None)
        
        new_config = VoiceConfig(**config_data)
        
        # 如果是激活状态，需要取消同类型的其他激活
        if new_config.is_active:
             others = (await session.exec(
                select(VoiceConfig).where(VoiceConfig.type == new_config.type)
            )).all()
             for other in others:
                 other.is_active = False
        
        session.add(new_config)
        await session.commit()
        await session.refresh(new_config)
        return new_config
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error creating voice config: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")

@app.put("/api/voice-configs/{config_id}", response_model=VoiceConfig)
async def update_voice_config(config_id: int, config_data: Dict[str, Any] = Body(...), session: AsyncSession = Depends(get_session)):
    try:
        db_config = await session.get(VoiceConfig, config_id)
        if not db_config:
            raise HTTPException(status_code=404, detail="Config not found")
        
        # 检查重名
        new_name = config_data.get("name")
        if new_name and new_name != db_config.name:
            existing = (await session.exec(
                select(VoiceConfig)
                .where(VoiceConfig.name == new_name)
                .where(VoiceConfig.id != config_id)
            )).first()
            if existing:
                raise HTTPException(status_code=400, detail="名称已存在")
        
        # 处理激活状态变更
        is_activating = config_data.get("is_active") and not db_config.is_active
        if is_activating:
            others = (await session.exec(
                select(VoiceConfig).where(VoiceConfig.type == db_config.type).where(VoiceConfig.id != config_id)
            )).all()
            for other in others:
                other.is_active = False
        
        # 更新字段
        exclude_fields = {'id', 'created_at', 'updated_at'}
        for key, value in config_data.items():
            if key not in exclude_fields and hasattr(db_config, key):
                setattr(db_config, key, value)
        
        db_config.updated_at = datetime.utcnow()
        session.add(db_config)
        await session.commit()
        await session.refresh(db_config)
        return db_config
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error updating voice config: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")

@app.delete("/api/voice-configs/{config_id}")
async def delete_voice_config(config_id: int, session: AsyncSession = Depends(get_session)):
    try:
        db_config = await session.get(VoiceConfig, config_id)
        if not db_config:
            raise HTTPException(status_code=404, detail="Config not found")
        
        if db_config.is_active:
             raise HTTPException(status_code=400, detail="无法删除当前激活的配置")

        await session.delete(db_config)
        await session.commit()
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error deleting voice config: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")

@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    token: str = Depends(verify_token),
    session: AsyncSession = Depends(get_session)
):
    # 将 Pydantic 模型转换为 Dict，但仅提取后端信任的字段
    messages = [m.model_dump() for m in request.messages]
    source = request.source
    session_id = request.session_id
    
    # 严格校验 source
    valid_sources = ["desktop", "mobile", "system_trigger", "ide", "qq"]
    if source not in valid_sources:
        print(f"[Security] Invalid source detected: {source}. Resetting to desktop.")
        source = "desktop"
    
    agent = AgentService(session)
    tts_service = get_tts_service()
    
    async def event_generator():
        full_response_text = ""
        
        try:
            # 使用队列统一管理文本流和状态流
            queue = asyncio.Queue()
            
            async def status_callback(status_type, message):
                await queue.put({"type": "status", "payload": {"type": status_type, "message": message}})

            async def run_chat():
                try:
                    async for chunk in agent.chat(messages, source=source, session_id=session_id, on_status=status_callback, skip_save=False):
                        if chunk:
                            await queue.put({"type": "text", "payload": chunk})
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    await queue.put({"type": "error", "payload": str(e)})
                finally:
                    await queue.put({"type": "done"})

            # 启动异步任务执行聊天逻辑
            # asyncio.create_task(run_chat()) # Moved below

            # TTS Buffer & Delimiters
            # tts_buffer = "" # Moved to run_tts
            # tts_delimiters = re.compile(r'[。！？\.\!\?\n]+') # Moved to run_tts

            async def generate_tts_chunk(text_chunk):
                try:
                    # Filter out XML/HTML tags
                    clean_text = re.sub(r'<([A-Z_]+)>.*?</\1>', '', text_chunk, flags=re.S)
                    clean_text = re.sub(r'<[^>]+>', '', clean_text)
                    # Filter out Thinking blocks (Safety net)
                    # Use strict pattern but case insensitive
                    clean_text = re.sub(r'【(Thinking|Monologue).*?】', '', clean_text, flags=re.S | re.IGNORECASE)
                    
                    # Filter out Emoji and special symbols that edge-tts might read
                    clean_text = re.sub(r'[\U00010000-\U0010ffff]', '', clean_text)
                    clean_text = re.sub(r'[^\w\s\u4e00-\u9fa5，。！？；：“”（）\n\.,!\?\-]', '', clean_text)
                    
                    # [Feature] Chatter Removal: Only read the last paragraph
                    # Split by newline and take the last non-empty segment to avoid reading "Thinking" chatter
                    segments = [s.strip() for s in clean_text.split('\n') if s.strip()]
                    if segments:
                        clean_text = segments[-1]

                    clean_text = clean_text.strip()
                    
                    if clean_text:
                        audio_path = await tts_service.synthesize(clean_text)
                        if audio_path and os.path.exists(audio_path):
                            with open(audio_path, "rb") as audio_file:
                                audio_data = base64.b64encode(audio_file.read()).decode('utf-8')
                            
                            # Clean up file immediately
                            try:
                                os.remove(audio_path)
                            except:
                                pass
                                
                            return audio_data
                except Exception as e:
                    print(f"TTS Chunk Error: {e}")
                return None

            # TTS Queue
            tts_queue = asyncio.Queue()

            async def run_tts():
                import re
                import asyncio
                import os
                tts_buffer = ""
                # 恢复分段机制，实现流式播放 (。！？.!?)
                tts_delimiters = re.compile(r'([。！？\.\!\?\n]+)')
                
                # 垫话机制状态
                filler_played = False
                filler_phrase = "唔...让我想想..."
                filler_cache_path = os.path.join(current_dir, "assets", "filler_thinking.mp3")

                # 初始化过滤器，防止 TTS 读取 XML 标签和 NIT 工具调用块
                from nit_core.dispatcher import XMLStreamFilter, NITStreamFilter
                # 显式过滤 thought 标签和 PEROCUE 等标签
                xml_filter = XMLStreamFilter(tag_names=["THOUGHT", "PEROCUE", "CHARACTER_STATUS", "METADATA"])
                nit_filter = NITStreamFilter()
                
                try:
                    while True:
                        try:
                            # 监控队列，如果 3 秒没反应且没播过垫话，则触发
                            if not filler_played:
                                raw_chunk = await asyncio.wait_for(tts_queue.get(), timeout=3.0)
                            else:
                                raw_chunk = await tts_queue.get()
                        except asyncio.TimeoutError:
                            if not filler_played:
                                logger.info(f"TTS Timeout detected, playing local filler for Pero...")
                                audio_data = None
                                
                                # 优先尝试读取本地缓存
                                if os.path.exists(filler_cache_path):
                                    try:
                                        with open(filler_cache_path, "rb") as f:
                                            # 读取二进制并转为 base64 字符串，与 generate_tts_chunk 输出保持一致
                                            audio_data = base64.b64encode(f.read()).decode('utf-8')
                                    except Exception as e:
                                        logger.error(f"Failed to read local filler: {e}")
                                
                                # 如果没有缓存，则生成并保存
                                if not audio_data:
                                    audio_data = await generate_tts_chunk(filler_phrase)
                                    if audio_data:
                                        try:
                                            # audio_data 是 base64 字符串，保存为二进制音频文件
                                            with open(filler_cache_path, "wb") as f:
                                                f.write(base64.b64decode(audio_data))
                                            logger.info(f"Saved filler to cache: {filler_cache_path}")
                                        except Exception as e:
                                            logger.error(f"Failed to save filler cache: {e}")
                                
                                if audio_data:
                                    await queue.put({"type": "audio", "payload": audio_data})
                                filler_played = True
                            # 继续等待
                            raw_chunk = await tts_queue.get()
                        
                        if raw_chunk is None: # Sentinel
                            # Flush filters buffer
                            remaining_xml = xml_filter.flush()
                            remaining_nit = nit_filter.filter(remaining_xml) + nit_filter.flush()
                            
                            if remaining_nit:
                                tts_buffer += remaining_nit
                                
                            # 处理最后剩余的文本
                            if tts_buffer.strip():
                                audio_data = await generate_tts_chunk(tts_buffer)
                                if audio_data:
                                    await queue.put({"type": "audio", "payload": audio_data})
                            break
                        
                        # 一旦有了实际输出，也将 filler_played 设为 True，防止中途再蹦出一句垫话
                        if not filler_played and len(raw_chunk.strip()) > 0:
                            filler_played = True

                        # Apply Filters: First XML, then NIT
                        filtered_xml = xml_filter.filter(raw_chunk)
                        filtered_nit = nit_filter.filter(filtered_xml)
                        tts_buffer += filtered_nit
                        
                        # 流式分句逻辑：查找分隔符
                        # 只有当 buffer 长度达到一定程度或出现标点符号时才切分，保证语调
                        if len(tts_buffer) > 10: 
                            parts = tts_delimiters.split(tts_buffer)
                            # 如果有至少一个完整句子（parts 长度 > 1）
                            if len(parts) > 1:
                                # 拼接已完成的句子 (i 是文本, i+1 是标点)
                                for i in range(0, len(parts) - 1, 2):
                                    sentence = parts[i] + parts[i+1]
                                    if sentence.strip():
                                        audio_data = await generate_tts_chunk(sentence)
                                        if audio_data:
                                            await queue.put({"type": "audio", "payload": audio_data})
                                
                                # 将剩余不完整的文本留到下一次处理
                                tts_buffer = parts[-1]
                except Exception as e:
                    print(f"TTS Worker Error: {e}")
                finally:
                    # Signal done to the main queue
                    await queue.put({"type": "done"})

            # 状态回调包装器，用于追踪 ReAct 轮次
            react_turn = [0] # 使用 list 以便在闭包中修改
            turn_buffer = [""] # 缓存非首轮的内容

            def wrapped_status_callback(status, msg):
                if status == "thinking":
                    react_turn[0] += 1
                    # 如果进入了新的一轮（轮次 > 2），说明上一轮不是最后一轮，清空缓存
                    if react_turn[0] > 2:
                        turn_buffer[0] = ""
                return status_callback(status, msg)

            async def run_chat():
                try:
                    async for chunk in agent.chat(messages, source=source, session_id=session_id, on_status=wrapped_status_callback):
                        if chunk:
                            # 文本流始终发送给 UI
                            await queue.put({"type": "text", "payload": chunk})
                            
                            # TTS 逻辑：
                            # 1. 第一轮直接发送给 TTS 队列（流式念出）
                            # 2. 后续轮次先进入 turn_buffer 缓存
                            if react_turn[0] <= 1:
                                await tts_queue.put(chunk)
                            else:
                                turn_buffer[0] += chunk
                    
                    # 当 chat 结束时，最后的 turn_buffer 就是“最后一段话”
                    if react_turn[0] > 1 and turn_buffer[0].strip():
                        await tts_queue.put(turn_buffer[0])

                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    await queue.put({"type": "error", "payload": str(e)})
                    # Ensure TTS worker also finishes if chat errors
                    await tts_queue.put(None)
                finally:
                    # Signal TTS to finish
                    await tts_queue.put(None)

            # 启动任务
            asyncio.create_task(run_chat())
            asyncio.create_task(run_tts())

            # 消费队列中的内容并发送 SSE
            while True:
                item = await queue.get()
                if item["type"] == "done":
                    break
                
                if item["type"] == "error":
                    error_chunk = {
                        "choices": [{"delta": {"content": f"Error: {item['payload']}"}}]
                    }
                    yield f"data: {json.dumps(error_chunk)}\n\n"
                    # If error occurs, we might want to stop or continue? 
                    # Usually error is fatal for the response.
                    break
                
                if item["type"] == "audio":
                     yield f"data: {json.dumps({'audio': item['payload']})}\n\n"

                if item["type"] == "status":
                    status_chunk = {"status": item["payload"]}
                    yield f"data: {json.dumps(status_chunk)}\n\n"
                
                if item["type"] == "text":
                    chunk = item["payload"]
                    full_response_text += chunk
                    
                    response_chunk = {
                        "choices": [{"delta": {"content": chunk}}]
                    }
                    yield f"data: {json.dumps(response_chunk)}\n\n"
            
            yield "data: [DONE]\n\n"
        except Exception as e:
            print(f"Chat error: {e}")
            import traceback
            traceback.print_exc()
            error_chunk = {
                "choices": [
                    {
                        "delta": {
                            "content": f"Error: {str(e)}"
                        }
                    }
                ]
            }
            yield f"data: {json.dumps(error_chunk)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/system/reset")
async def reset_system(session: AsyncSession = Depends(get_session)):
    """一键恢复出厂设置：清理所有记忆、对话记录、状态和任务，但保留模型配置"""
    try:
        # 1. 清理记忆
        await session.exec(delete(Memory))
        # 2. 清理对话记录
        await session.exec(delete(ConversationLog))
        # 3. 清理任务
        await session.exec(delete(ScheduledTask))
        # 4. 重置宠物状态
        await session.exec(delete(PetState))
        # 5. 清理配置 (保留模型配置相关的 key)
        # 常见的需要保留的配置：current_model_id, reflection_model_id, reflection_enabled
        # 需要清理的配置：owner_name, user_persona, last_maintenance_log_count 等
        keep_configs = ["current_model_id", "reflection_model_id", "reflection_enabled", "global_llm_api_key", "global_llm_api_base"]
        await session.exec(
            delete(Config).where(Config.key.not_in(keep_configs))
        )
        
        # 6. 初始化一个新的默认状态
        default_state = PetState()
        session.add(default_state)
        
        await session.commit()
        return {"status": "success", "message": "系统已成功恢复出厂设置"}
    except Exception as e:
        await session.rollback()
        import traceback
        print(f"Error resetting system: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"恢复出厂设置失败: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/api/maintenance/run")
async def run_maintenance_api(session: AsyncSession = Depends(get_session)):
    service = MemorySecretaryService(session)
    return await service.run_maintenance()

@app.post("/api/open-path")
async def open_path(payload: Dict[str, str] = Body(...)):
    """打开本地文件或文件夹"""
    path = payload.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    
    # 规范化路径，处理不同平台的斜杠
    path = os.path.normpath(path)
    
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Path does not exist")
    
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        try:
            if os.path.isfile(path):
                # 使用 explorer /select, path 定位文件
                # 注意：这里不能用 subprocess.run(..., shell=True)，否则会有控制台闪烁
                # 直接调用 explorer.exe
                subprocess.Popen(['explorer', '/select,', path], startupinfo=startupinfo)
            else:
                os.startfile(path)
        except Exception as e:
             # Fallback
             try:
                os.startfile(path)
             except Exception as inner_e:
                print(f"Error opening path {path}: {inner_e}")
                raise HTTPException(status_code=500, detail=str(inner_e))
    else:
        # Non-Windows fallback (though Pero is Windows focused)
        subprocess.Popen(['xdg-open', path])
        
    return {"status": "success", "message": f"Opened {path}"}

# ============================================================================
# RESTORED ENDPOINTS (Voice, Memory, etc.)
# ============================================================================

# --- Voice API ---

@app.post("/api/voice/asr")
async def voice_asr(file: UploadFile = File(...)):
    """语音转文字接口"""
    try:
        # Save temp file
        # [Refactor] 统一指向 backend/data/temp_audio
        default_data_dir = os.path.join(current_dir, "data")
        data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
        temp_dir = os.path.join(data_dir, "temp_audio")
        
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
            
        temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}.wav")
        with open(temp_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
            
        asr = get_asr_service()
        text = await asr.transcribe(temp_path)
        
        # Cleanup
        try:
            os.remove(temp_path)
        except:
            pass
            
        if not text:
            raise HTTPException(status_code=500, detail="ASR failed")
            
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/voice/tts")
async def voice_tts(payload: Dict[str, str] = Body(...)):
    """文字转语音接口"""
    text = payload.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    
    tts = get_tts_service()
    filepath = await tts.synthesize(text)
    if not filepath:
        raise HTTPException(status_code=500, detail="TTS synthesis failed")
    
    filename = os.path.basename(filepath)
    return {"audio_url": f"/api/voice/audio/{filename}"}

@app.get("/api/voice/audio/{filename}")
async def get_audio_file(filename: str):
    """获取语音文件"""
    # [Refactor] 统一指向 backend/data/temp_audio
    default_data_dir = os.path.join(current_dir, "data")
    data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
    file_path = os.path.join(data_dir, "temp_audio", filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(file_path, media_type="audio/mpeg")

@app.delete("/api/voice/audio/{filename}")
async def delete_audio(filename: str):
    """手动删除音频文件 (由前端播放完毕后触发)"""
    tts = get_tts_service()
    # Check both temp_audio and tts output dir just in case
    # [Refactor] 统一指向 backend/data/temp_audio
    default_data_dir = os.path.join(current_dir, "data")
    data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
    
    paths_to_check = [
        os.path.join(data_dir, "temp_audio", filename),
        os.path.join(tts.output_dir, filename)
    ]
    
    deleted = False
    for filepath in paths_to_check:
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
                deleted = True
            except:
                pass
    
    if not deleted:
        # It's fine if it's already gone
        pass
        
    return {"status": "success"}

# --- Memory API ---

@app.get("/api/configs/waifu-texts")
async def get_waifu_texts(session: AsyncSession = Depends(get_session)):
    """获取动态生成的 Live2D 台词配置 (Agent 专属)"""
    try:
        # 1. 获取当前活跃 Agent
        from services.agent_manager import get_agent_manager
        agent_manager = get_agent_manager()
        active_agent = agent_manager.get_active_agent()
        agent_id = active_agent.id if active_agent else "pero"
        
        # 2. 尝试从 Agent 目录加载 waifu_texts.json
        agent_dir = os.path.join(current_dir, "services", "mdp", "agents", agent_id)
        texts_path = os.path.join(agent_dir, "waifu_texts.json")
        
        if os.path.exists(texts_path):
            try:
                with open(texts_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[Main] Failed to load waifu_texts for agent {agent_id}: {e}")
        
        # 3. 如果没找到，尝试回退到 Config (旧版逻辑)
        config = await session.get(Config, "waifu_dynamic_texts")
        if config:
            return json.loads(config.value)
            
        return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memories")
async def get_memories(
    query: str = None, 
    limit: int = 20, 
    offset: int = 0, 
    session: AsyncSession = Depends(get_session)
):
    """获取记忆列表"""
    try:
        stmt = select(Memory).order_by(desc(Memory.timestamp)).offset(offset).limit(limit)
        if query:
            stmt = stmt.where(Memory.content.contains(query))
        
        memories = (await session.exec(stmt)).all()
        return memories
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memories", response_model=Memory)
async def add_memory(
    payload: Dict[str, Any], 
    session: AsyncSession = Depends(get_session)
):
    """手动添加记忆"""
    try:
        service = MemoryService()
        return await service.save_memory(
            session, 
            content=payload.get("content", ""), 
            tags=payload.get("tags", ""), 
            importance=payload.get("importance", 1), 
            msg_timestamp=payload.get("msgTimestamp"), 
            source=payload.get("source", "desktop"), 
            memory_type=payload.get("type", "event")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/memories/{memory_id}")
async def delete_memory(
    memory_id: int, 
    session: AsyncSession = Depends(get_session)
):
    """删除记忆"""
    try:
        memory = await session.get(Memory, memory_id)
        if not memory:
            raise HTTPException(status_code=404, detail="Memory not found")
        
        await session.delete(memory)
        await session.commit()
        return {"status": "success", "id": memory_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/models/remote")
async def fetch_remote_models(payload: Dict[str, Any] = Body(...)):
    """获取远程服务商提供的模型列表"""
    api_key = payload.get("api_key", "")
    api_base = payload.get("api_base", "https://api.openai.com")
    provider = payload.get("provider", "openai")
    
    from services.llm_service import LLMService
    llm = LLMService(api_key, api_base, "", provider=provider)
    models = await llm.list_models()
    print(f"后端返回模型列表: {models} (服务商: {provider})") # 打印返回给前端的内容
    return {"models": models}

@app.post("/api/maintenance/undo/{record_id}")
async def undo_maintenance_api(record_id: int, session: AsyncSession = Depends(get_session)):
    service = MemorySecretaryService(session)
    success = await service.undo_maintenance(record_id)
    if not success:
        raise HTTPException(status_code=400, detail="Undo failed or record not found")
    return {"status": "success", "message": "Maintenance undone"}

@app.get("/api/maintenance/records")
async def get_maintenance_records(session: AsyncSession = Depends(get_session)):
    """获取最近的维护记录"""
    from sqlmodel import desc
    from models import MaintenanceRecord
    statement = select(MaintenanceRecord).order_by(desc(MaintenanceRecord.timestamp)).limit(10)
    return (await session.exec(statement)).all()

@app.get("/api/stats/overview")
async def get_overview_stats(agent_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    """
    获取概览页面的统计数据（总数），解耦渲染数量和显示数量。
    """
    try:
        # Count memories
        mem_statement = select(func.count()).select_from(Memory)
        if agent_id:
            mem_statement = mem_statement.where(Memory.agent_id == agent_id)
        mem_count = (await session.exec(mem_statement)).one()
        
        # Count logs
        log_statement = select(func.count()).select_from(ConversationLog)
        if agent_id:
            log_statement = log_statement.where(ConversationLog.agent_id == agent_id)
        log_count = (await session.exec(log_statement)).one()
        
        # Count tasks (ScheduledTask)
        task_statement = select(func.count()).select_from(ScheduledTask)
        if agent_id:
            task_statement = task_statement.where(ScheduledTask.agent_id == agent_id)
        task_count = (await session.exec(task_statement)).one()

        return {
            "total_memories": mem_count,
            "total_logs": log_count,
            "total_tasks": task_count
        }
    except Exception as e:
        logger.error(f"Failed to get overview stats: {e}")
        # Fallback to 0 if error, frontend should handle or use length
        return {
            "total_memories": 0,
            "total_logs": 0,
            "total_tasks": 0
        }

if __name__ == "__main__":
    # 优先从环境变量读取端口
    port = int(os.environ.get("PORT", 9120))
    # 强制禁用 reload 模式，因为 Uvicorn 的 reloader 在 Windows 下会强制使用 SelectorEventLoop
    # 这会导致 subprocess (MCP Stdio) 报错 NotImplementedError
    print(f"后端启动，事件循环: {asyncio.get_event_loop().__class__.__name__}")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)

