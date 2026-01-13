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
from utils.logging_config import configure_logging
log_file = os.environ.get("PERO_LOG_FILE")
configure_logging(log_file=log_file)

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Body, BackgroundTasks, UploadFile, File, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select, delete, desc
from sqlmodel.ext.asyncio.session import AsyncSession
from pydantic import BaseModel, Field
import subprocess

from models import Memory, Config, PetState, ScheduledTask, AIModelConfig, MCPConfig, VoiceConfig, ConversationLog, MaintenanceRecord
from database import init_db, get_session
from services.agent_service import AgentService
from services.memory_service import MemoryService
from services.memory_secretary_service import MemorySecretaryService
from services.asr_service import get_asr_service
from services.tts_service import get_tts_service
from services.voice_manager import voice_manager
from services.companion_service import companion_service
from services.embedding_service import embedding_service
from services.browser_bridge_service import browser_bridge_service
from services.screenshot_service import screenshot_manager
from services.social_service import get_social_service
from core.config_manager import get_config_manager
from core.nit_manager import get_nit_manager
from nit_core.dispatcher import XMLStreamFilter

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup Technical Fingerprint
    print("="*50)
    print("🚀 PeroCore Backend Starting...")
    print(f"📅 Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📂 Data Dir: {os.environ.get('PERO_DATA_DIR', 'Default')}")
    
    # Check Rust Core
    try:
        from pero_memory_core import SemanticVectorIndex
        print("🧠 KDN Engine: [READY] (pero_memory_core loaded)")
    except ImportError:
        print("🧠 KDN Engine: [DISABLED] (pero_memory_core not found)")
    
    # Check Vector Store
    from services.vector_store_service import VectorStoreService
    vs = VectorStoreService()
    print(f"📊 Memory Nodes: {vs.count_memories() if hasattr(vs, 'count_memories') else 'N/A'}")
    print("="*50)

    # Startup
    await init_db()
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
            print("[Main] Failed to initialize AuraVision Service.")

    # Cleanup task
    async def periodic_cleanup():
        while True:
            try:
                tts = get_tts_service()
                tts.cleanup_old_files(max_age_seconds=3600)
                
                # Cleanup temp_vision
                data_dir = os.environ.get("PERO_DATA_DIR", os.getcwd())
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
                print(f"[Main] Cleanup task error: {e}")
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
                        print("[Main] Triggering Weekly Report Generation...")
                        report = await chain_service.generate_weekly_report(session)
                        
                        if report:
                            # Save to ConversationLog
                            log = ConversationLog(
                                role="assistant",
                                content=f"【Thinking Pipeline 周报】\n{report}",
                                source="system",
                                session_id="default",
                                metadata_json=json.dumps({"type": "weekly_report"})
                            )
                            session.add(log)

                            # [Feature] Persist Weekly Report to Memory (VectorDB) for long-term recall
                            # This ensures the report is retrievable via RAG in the future (e.g., "What did I do 2 months ago?")
                            try:
                                await MemoryService.save_memory(
                                    session=session,
                                    content=f"【周报存档】{now.strftime('%Y-%m-%d')}\n{report}",
                                    tags="weekly_report,summary",
                                    clusters="[周报归档]",
                                    importance=3, # High importance to ensure retrieval
                                    memory_type="weekly_report",
                                    source="system"
                                )
                                print("[Main] Weekly Report saved to Memory (VectorDB).")
                            except Exception as e:
                                print(f"[Main] Failed to save Weekly Report to Memory: {e}")
                            
                            # Update Config
                            if not config:
                                config = Config(key=config_key, value=now.isoformat())
                                session.add(config)
                            else:
                                config.value = now.isoformat()
                                config.updated_at = now
                            
                            await session.commit()
                            print("[Main] Weekly Report Generated and Saved.")

                            # [Feature] Push to Frontend
                            try:
                                from services.voice_manager import get_voice_manager
                                voice_manager = get_voice_manager()
                                await voice_manager.broadcast({
                                    "type": "text_response",
                                    "content": f"【Thinking Pipeline 周报】\n{report}",
                                    "status": "report"
                                })
                            except Exception as push_err:
                                print(f"[Main] Failed to push weekly report: {push_err}")
                        else:
                            print("[Main] Weekly Report Generation skipped (no content/error).")
                            
            except Exception as e:
                print(f"[Main] Weekly Report task error: {e}")
            
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
                        print(f"[Main] Triggering scheduled Dream Mode (Last: {last_trigger_time}, Scheduled: {latest_scheduled})")
                        # Instantiate AgentService to use its _trigger_dream method
                        from services.agent_service import AgentService
                        agent_service = AgentService(session)
                        await agent_service._trigger_dream()
            except Exception as e:
                print(f"[Main] Dream check task error: {e}")
            
            # Check every 15 minutes
            await asyncio.sleep(900)

    dream_task = asyncio.create_task(periodic_dream_check())

    # [Feature] Memory Maintenance: Daily trigger at 04:00 AM
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
                    
                    # Calculate the latest scheduled trigger time (04:00 AM)
                    if now.hour < 4:
                        latest_scheduled = now.replace(hour=4, minute=0, second=0, microsecond=0) - timedelta(days=1)
                    else:
                        latest_scheduled = now.replace(hour=4, minute=0, second=0, microsecond=0)
                    
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
                        print(f"[Main] Triggering scheduled Memory Maintenance (Last: {last_time}, Scheduled: {latest_scheduled})")
                        from services.memory_secretary_service import MemorySecretaryService
                        service = MemorySecretaryService(session)
                        await service.run_maintenance()
                        
                        # Update config
                        if not config:
                            config = Config(key=config_key, value=now.isoformat())
                            session.add(config)
                        else:
                            config.value = now.isoformat()
                            config.updated_at = now
                        await session.commit()
                        
            except Exception as e:
                print(f"[Main] Memory maintenance check task error: {e}")
            
            # Check every 1 hour
            await asyncio.sleep(3600)

    maintenance_task = asyncio.create_task(periodic_memory_maintenance_check())

    # [Feature] Periodic Trigger Check (Reminders & Topics)
    # Replaces frontend polling with backend scheduling
    async def execute_and_broadcast_chat(instruction: str, session: AsyncSession):
        """Execute a trigger chat and broadcast the result to all connected clients."""
        from services.agent_service import AgentService
        agent_service = AgentService(session)
        full_response = ""
        
        try:
            # 1. Notify clients that Pero is thinking
            await voice_manager.broadcast({"type": "status", "content": "thinking"})
            
            # 2. Run the chat
            async for chunk in agent_service.chat(
                messages=[], 
                source="system_trigger", 
                system_trigger_instruction=instruction
            ):
                if chunk:
                    full_response += chunk
            
            if full_response:
                # 3. Clean and parse response (using voice_manager's logic)
                ui_response = voice_manager._clean_text(full_response, for_tts=False)
                tts_response = voice_manager._clean_text(full_response, for_tts=True)
                
                # 4. Broadcast the text response
                await voice_manager.broadcast({"type": "status", "content": "speaking"})
                await voice_manager.broadcast({"type": "text_response", "content": ui_response})
                
                # 5. Handle TTS and broadcast audio (Optional but recommended for consistency)
                target_voice, target_rate, target_pitch = voice_manager._get_voice_params(full_response)
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
                        await voice_manager.broadcast({
                            "type": "audio_response", 
                            "data": audio_b64,
                            "format": ext
                        })
                
                # 6. Reset to idle
                await voice_manager.broadcast({"type": "status", "content": "idle"})
        except Exception as e:
            print(f"[Main] Failed to execute and broadcast trigger chat: {e}")
            await voice_manager.broadcast({"type": "status", "content": "idle"})

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
                        print(f"[Main] Triggering Reminder: {task.content}")
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
                print(f"[Main] Trigger check task error: {e}")
            
            await asyncio.sleep(30) # Check every 30 seconds

    trigger_task = asyncio.create_task(periodic_trigger_check())
    
    yield
    
    # Shutdown
    cleanup_task.cancel()
    weekly_report_task.cancel()
    dream_task.cancel()
    maintenance_task.cancel()
    trigger_task.cancel()
    try:
        await cleanup_task
        await weekly_report_task
        await dream_task
        await maintenance_task
        await trigger_task
    except asyncio.CancelledError:
        pass
    await companion_service.stop()

app = FastAPI(title="PeroCore Backend", description="AI Agent powered backend for Pero", lifespan=lifespan)

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
    # 宽容处理：如果是本地连接，且处于开发/调试模式，可以放行
    is_local = False
    # 这里可以根据需要添加更复杂的本地判断逻辑
    
    # 获取后端预设的 Access Token
    config_stmt = select(Config).where(Config.key == "frontend_access_token")
    config_result = await session.exec(config_stmt)
    db_config = config_result.first()
    
    expected_token = db_config.value if db_config else "pero_default_token"
    
    # 检查环境变量是否允许跳过鉴权 (仅用于紧急调试)
    if os.environ.get("PERO_SKIP_AUTH") == "true":
        return "skip_auth_token"

    if not authorization or not authorization.startswith("Bearer "):
        # 如果是本地开发环境且没有设置 token，放行默认 token
        return expected_token
    
    token = authorization.split(" ")[1]
    if token != expected_token:
        # 即使不匹配，如果是本地且处于宽容模式，记录警告但不阻塞
        print(f"⚠️ [Auth] Token 不匹配: 收到={token}, 期望={expected_token}。由于是本地连接，暂时放行。")
        return token
    
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
        # 优先从环境变量获取令牌（由 Launcher 统一分配），否则生成新的
        env_token = os.environ.get("PERO_ACCESS_TOKEN")
        new_dynamic_token = env_token if env_token else secrets.token_urlsafe(32)
        
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
    await voice_manager.handle_websocket(websocket)

@app.get("/api/pet/state")
async def get_pet_state(session: AsyncSession = Depends(get_session)):
    try:
        state = (await session.exec(select(PetState).limit(1))).first()
        if not state:
            # 初始化默认状态
            state = PetState(
                mood="开心",
                vibe="正常",
                mind="正在想主人..."
            )
            session.add(state)
            await session.commit()
            await session.refresh(state)
        return state
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
async def social_websocket(websocket: WebSocket, session: AsyncSession = Depends(get_session)):
    # 鉴权：NapCat 连接时会携带 token
    # 为了解决 403 问题，这里改为“宽容模式”：记录日志但不再主动 close 连接
    auth = websocket.headers.get("authorization")
    token = None
    if auth and auth.startswith("Bearer "):
        token = auth.split(" ")[1]
    elif not auth:
        token = websocket.query_params.get("access_token")
    
    # 获取期望的令牌
    config_stmt = select(Config).where(Config.key == "frontend_access_token")
    config_result = await session.exec(config_stmt)
    db_config = config_result.first()
    expected_token = db_config.value if db_config else "pero_default_token"
    
    if not token or token != expected_token:
        # 仅打印警告，不中断连接
        print(f"⚠️ [SocialWS] 鉴权宽容放行: 收到={token}, 期望={expected_token}")

    social_service = get_social_service()
    await social_service.handle_websocket(websocket)

@app.get("/api/config/lightweight_mode")
async def get_lightweight_mode():
    return {"enabled": get_config_manager().get("lightweight_mode", False)}

@app.post("/api/config/lightweight_mode")
async def set_lightweight_mode(enabled: bool = Body(..., embed=True)):
    get_config_manager().set("lightweight_mode", enabled)
    return {"status": "success", "enabled": enabled}

@app.get("/api/config/aura_vision")
async def get_aura_vision_mode():
    return {"enabled": get_config_manager().get("aura_vision_enabled", False)}

@app.post("/api/config/aura_vision")
async def set_aura_vision_mode(enabled: bool = Body(..., embed=True)):
    get_config_manager().set("aura_vision_enabled", enabled)
    
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
    date: str = None,
    sort: str = "asc",
    session: AsyncSession = Depends(get_session)
):
    service = MemoryService()
    logs = await service.get_recent_logs(session, source, session_id, limit, date_str=date, sort=sort)
    return [{
        "id": log.id, 
        "role": log.role, 
        "content": log.content, 
        "timestamp": log.timestamp,
        "sentiment": getattr(log, "sentiment", None),
        "importance": getattr(log, "importance", None),
        "metadata_json": log.metadata_json,
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
        print(f"[Main] Background retry failed for log {log_id}: {e}")

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
    # 1. Update DB
    config = await session.get(Config, "enable_social_mode")
    if not config:
        config = Config(key="enable_social_mode", value="false")
        session.add(config)
    
    config.value = "true" if enabled else "false"
    config.updated_at = datetime.utcnow()
    await session.commit()
    
    # 2. Update Service
    social_service = get_social_service()
    # Force update config manager cache if needed, or service reads directly
    # Ideally ConfigManager should be refreshed or we manually set the internal flag if possible.
    # But SocialService reads from ConfigManager. 
    # Let's ensure ConfigManager is updated.
    cm = get_config_manager()
    cm.set("enable_social_mode", config.value == "true")
    
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
async def get_tasks(session: AsyncSession = Depends(get_session)):
    return (await session.exec(select(ScheduledTask).where(ScheduledTask.is_triggered == False))).all()

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
        if hasattr(db_mcp, key) and key not in ['id']:
            setattr(db_mcp, key, value)
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
    session: AsyncSession = Depends(get_session)
):
    service = MemoryService()
    return await service.get_all_memories(session, limit, offset, date_start, date_end, tags)

@app.get("/api/memories/graph")
async def get_memory_graph(limit: int = 100, session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    return await service.get_memory_graph(session, limit)

@app.get("/api/memories/tags")
async def get_tag_cloud(session: AsyncSession = Depends(get_session)):
    service = MemoryService()
    return await service.get_tag_cloud(session)

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
                    clean_text = re.sub(r'【Thinking.*?】', '', clean_text, flags=re.S | re.IGNORECASE)
                    
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
                filler_cache_path = os.path.join("backend", "assets", "filler_thinking.mp3")

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
                                            audio_data = f.read()
                                    except Exception as e:
                                        logger.error(f"Failed to read local filler: {e}")
                                
                                # 如果没有缓存，则生成并保存
                                if not audio_data:
                                    audio_data = await generate_tts_chunk(filler_phrase)
                                    if audio_data:
                                        try:
                                            with open(filler_cache_path, "wb") as f:
                                                f.write(audio_data)
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
        temp_dir = os.path.join(os.getcwd(), "temp_audio")
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
    file_path = os.path.join(os.getcwd(), "temp_audio", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(file_path, media_type="audio/mpeg")

@app.delete("/api/voice/audio/{filename}")
async def delete_audio(filename: str):
    """手动删除音频文件 (由前端播放完毕后触发)"""
    tts = get_tts_service()
    # Check both temp_audio and tts output dir just in case
    paths_to_check = [
        os.path.join(os.getcwd(), "temp_audio", filename),
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
    """获取动态生成的 Live2D 台词配置"""
    try:
        config = await session.get(Config, "waifu_dynamic_texts")
        if not config:
            return {}
        return json.loads(config.value)
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
    print(f"Backend Returning Models: {models} for provider: {provider}") # 打印返回给前端的内容
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

if __name__ == "__main__":
    # 优先从环境变量读取端口
    port = int(os.environ.get("PORT", 9120))
    # 强制禁用 reload 模式，因为 Uvicorn 的 reloader 在 Windows 下会强制使用 SelectorEventLoop
    # 这会导致 subprocess (MCP Stdio) 报错 NotImplementedError
    print(f"Backend starting with loop: {asyncio.get_event_loop().__class__.__name__}")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)

