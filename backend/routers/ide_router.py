
import os
import glob
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlmodel.ext.asyncio.session import AsyncSession
from database import get_session
from services.session_service import enter_work_mode, exit_work_mode

router = APIRouter(prefix="/api/ide", tags=["ide"])

class FileNode(BaseModel):
    name: str
    path: str
    type: str  # "file" or "directory"
    children: Optional[List['FileNode']] = None

class WorkModeRequest(BaseModel):
    task_name: str

class ReadFileRequest(BaseModel):
    path: str

class CreateFileRequest(BaseModel):
    path: str
    is_directory: bool = False

class WriteFileRequest(BaseModel):
    path: str
    content: str

class DeleteFileRequest(BaseModel):
    path: str

class RenameFileRequest(BaseModel):
    path: str
    new_name: str

class ChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    source: str = "ide"
    session_id: str = "default"

class SkipCommandRequest(BaseModel):
    pid: int

@router.post("/tools/terminal/skip")
async def skip_terminal_command(request: SkipCommandRequest):
    from services.realtime_session_manager import realtime_session_manager
    success = realtime_session_manager.skip_command(request.pid)
    if not success:
        raise HTTPException(status_code=404, detail="Command not found or not active")
    return {"status": "ok"}

@router.post("/chat")
async def chat(request: ChatRequest, session: AsyncSession = Depends(get_session)):
    from services.agent_service import AgentService
    from models import Config
    from sqlmodel import select
    from services.agent_manager import get_agent_manager
    
    agent_service = AgentService(session)
    agent_manager = get_agent_manager()
    agent_id = agent_manager.active_agent_id
    
    # 检查我们是否处于工作模式，以及是否应覆盖 session_id
    if request.session_id == "current_work_session":
        session_key = f"current_session_id_{agent_id}"
        config_id = (await session.exec(select(Config).where(Config.key == session_key))).first()
        
        # 如果未找到，回退到全局 (向后兼容)
        if not config_id:
             config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
             
        if config_id and config_id.value.startswith("work_"):
            request.session_id = config_id.value
        else:
            request.session_id = "default"

    # [Feature] 实时 ReAct 广播
    # 我们使用 realtime_session_manager 的广播功能将“思考”状态发送到前端 (ChatInterface/PetView)
    # 这确保了即使是 IDE 聊天，我们也能通过 WebSocket 获得实时可视化。
    from services.realtime_session_manager import realtime_session_manager
    
    async def on_status(status_type: str, content: str):
        # 广播思考步骤到所有连接的客户端 (IDE, PetView 等)
        if status_type == "thinking":
            await realtime_session_manager.broadcast({
                "type": "status",
                "content": "thinking",
                "detail": content # 传递详细思考内容
            })

    # 使用流式响应
    async def generate():
        async for chunk in agent_service.chat(
            request.messages, 
            source=request.source, 
            session_id=request.session_id,
            on_status=on_status
        ):
            if chunk:
                yield chunk
        
        # 生成后重置状态为空闲
        await realtime_session_manager.broadcast({"type": "status", "content": "idle"})

    return StreamingResponse(generate(), media_type="text/plain")

# [Refactor] 使用 workspace_utils 支持多代理
from utils.workspace_utils import get_workspace_root, get_global_workspace_root

# def get_workspace_root(): ... (Removed)

@router.get("/image")
async def get_workspace_image(path: str):
    # 对于图像，我们可能希望在当前代理的工作区或全局工作区中搜索
    # 但为了简单起见，我们暂时坚持使用活跃代理的工作区
    base_dir = get_workspace_root() 
    # 路径应相对于工作区，例如 "uploads/2026-01-21/xxx.png"
    # 防止目录遍历攻击
    safe_path = os.path.normpath(path)
    if safe_path.startswith("..") or os.path.isabs(safe_path):
         raise HTTPException(status_code=403, detail="Access denied")
         
    target_path = os.path.join(base_dir, safe_path)
    
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    return FileResponse(target_path)

@router.get("/files", response_model=List[FileNode])
async def list_files(path: Optional[str] = None):
    """
    列出给定目录路径中的文件。
    如果 path 为 None，则从工作区根目录列出。
    """
    base_dir = get_workspace_root()
    
    if path:
        target_dir = os.path.abspath(os.path.join(base_dir, path))
        # 简单的安全检查以防止目录遍历
        if not target_dir.startswith(base_dir):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        target_dir = base_dir

    if not os.path.exists(target_dir):
        raise HTTPException(status_code=404, detail="Directory not found")

    items = []
    try:
        with os.scandir(target_dir) as entries:
            for entry in entries:
                # 跳过隐藏文件和常见的忽略文件夹
                if entry.name.startswith('.') or entry.name in ['__pycache__', 'node_modules', 'venv', 'dist']:
                    continue
                
                node = FileNode(
                    name=entry.name,
                    path=os.path.relpath(entry.path, base_dir),
                    type="directory" if entry.is_dir() else "file"
                )
                items.append(node)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 先对目录排序，然后是文件
    items.sort(key=lambda x: (x.type != "directory", x.name.lower()))
    return items

@router.post("/file/read")
async def read_file(request: ReadFileRequest):
    base_dir = get_workspace_root()
    target_path = os.path.abspath(os.path.join(base_dir, request.path))
    
    if not target_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")
        
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    try:
        # Check file size (limit to 1MB for now to prevent freezing)
        if os.path.getsize(target_path) > 1024 * 1024:
             raise HTTPException(status_code=400, detail="File too large")

        with open(target_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"content": content}
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Binary file not supported")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/file/create")
async def create_file_or_dir(request: CreateFileRequest):
    base_dir = get_workspace_root()
    target_path = os.path.abspath(os.path.join(base_dir, request.path))
    
    if not target_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")
        
    if os.path.exists(target_path):
        raise HTTPException(status_code=400, detail="Path already exists")
        
    try:
        if request.is_directory:
            os.makedirs(target_path)
        else:
            # Create parent dirs if needed
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, 'w', encoding='utf-8') as f:
                f.write("")
        return {"status": "success", "path": request.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/file/write")
async def write_file(request: WriteFileRequest):
    base_dir = get_workspace_root()
    target_path = os.path.abspath(os.path.join(base_dir, request.path))
    
    if not target_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")
        
    try:
        # Create parent dirs if needed (just in case)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write(request.content)
        return {"status": "success", "path": request.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/file/delete")
async def delete_file(request: DeleteFileRequest):
    base_dir = get_workspace_root()
    target_path = os.path.abspath(os.path.join(base_dir, request.path))
    
    if not target_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")
        
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Path not found")
        
    try:
        if os.path.isdir(target_path):
            import shutil
            shutil.rmtree(target_path)
        else:
            os.remove(target_path)
        return {"status": "success", "path": request.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/file/rename")
async def rename_file(request: RenameFileRequest):
    base_dir = get_workspace_root()
    target_path = os.path.abspath(os.path.join(base_dir, request.path))
    
    if not target_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")
        
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Path not found")
        
    parent_dir = os.path.dirname(target_path)
    new_path = os.path.join(parent_dir, request.new_name)
    
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail="New name already exists")
        
    try:
        os.rename(target_path, new_path)
        return {"status": "success", "old_path": request.path, "new_path": request.new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/work_mode/enter")
async def api_enter_work_mode(request: WorkModeRequest, session: AsyncSession = Depends(get_session)):
    # Inject session into SessionOps context (as it relies on global context currently)
    from services.session_service import set_current_session_context
    set_current_session_context(session)
    
    result = await enter_work_mode(request.task_name)
    return {"message": result}

@router.post("/work_mode/exit")
async def api_exit_work_mode(session: AsyncSession = Depends(get_session)):
    # Inject session
    from services.session_service import set_current_session_context
    set_current_session_context(session)
    
    result = await exit_work_mode()
    return {"message": result}

@router.post("/work_mode/abort")
async def api_abort_work_mode(session: AsyncSession = Depends(get_session)):
    """
    Exit work mode WITHOUT summarization (Quiet Exit).
    """
    from models import Config
    from sqlmodel import select
    from core.nit_manager import get_nit_manager
    from services.agent_manager import get_agent_manager
    
    try:
        agent_manager = get_agent_manager()
        agent_id = agent_manager.active_agent_id
        session_key = f"current_session_id_{agent_id}"
        
        config_id = (await session.exec(select(Config).where(Config.key == session_key))).first()
        
        # Fallback
        if not config_id:
             config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        
        if config_id and config_id.value.startswith("work_"):
            config_id.value = "default"
            await session.commit()
            
            # [NIT] Deactivate Work Toolchain
            try:
                get_nit_manager().set_category_status("work", False)
            except Exception as nit_e:
                print(f"[IDE Router] Failed to deactivate NIT work category: {nit_e}")

            return {"message": "Work Mode aborted (No summary generated)."}
        else:
            return {"message": "Not in Work Mode."}
    except Exception as e:
        return {"message": f"Error aborting Work Mode: {e}"}
