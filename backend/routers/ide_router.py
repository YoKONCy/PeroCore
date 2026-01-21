
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
    
    agent_service = AgentService(session)
    
    # Check if we are in work mode and if session_id should be overridden
    if request.session_id == "current_work_session":
        config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        if config_id and config_id.value.startswith("work_"):
            request.session_id = config_id.value
        else:
            request.session_id = "default"

    # [Feature] Real-time ReAct Broadcasting
    # We use realtime_session_manager's broadcast capability to send "thinking" statuses to the frontend (ChatInterface/PetView)
    # This ensures that even for IDE chats, we get real-time visualization via WebSocket.
    from services.realtime_session_manager import realtime_session_manager
    
    async def on_status(status_type: str, content: str):
        # Broadcast thinking steps to all connected clients (IDE, PetView, etc.)
        if status_type == "thinking":
            await realtime_session_manager.broadcast({
                "type": "status",
                "content": "thinking",
                "detail": content # Pass detailed thought
            })

    # Use streaming response
    async def generate():
        async for chunk in agent_service.chat(
            request.messages, 
            source=request.source, 
            session_id=request.session_id,
            on_status=on_status
        ):
            if chunk:
                yield chunk
        
        # Reset status to idle after generation
        await realtime_session_manager.broadcast({"type": "status", "content": "idle"})

    return StreamingResponse(generate(), media_type="text/plain")

def get_workspace_root():
    """
    Get the absolute path to the workspace root.
    Defaults to PeroCore/pero_workspace
    """
    current_file_dir = os.path.dirname(os.path.abspath(__file__)) # PeroCore/backend/routers
    backend_dir = os.path.dirname(current_file_dir) # PeroCore/backend
    project_root = os.path.dirname(backend_dir) # PeroCore
    
    workspace_dir = os.path.join(project_root, "pero_workspace")
    
    if not os.path.exists(workspace_dir):
        os.makedirs(workspace_dir, exist_ok=True)
        
    return workspace_dir

@router.get("/image")
async def get_workspace_image(path: str):
    base_dir = get_workspace_root()
    # Path should be relative to workspace, e.g. "uploads/2026-01-21/xxx.png"
    # Prevent directory traversal
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
    List files in the given directory path.
    If path is None, list from the workspace root.
    """
    base_dir = get_workspace_root()
    
    if path:
        target_dir = os.path.abspath(os.path.join(base_dir, path))
        # Simple security check to prevent directory traversal
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
                # Skip hidden files and common ignore folders
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

    # Sort directories first, then files
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
    
    try:
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
