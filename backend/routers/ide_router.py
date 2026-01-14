
import os
import glob
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
from sqlmodel.ext.asyncio.session import AsyncSession
from database import get_session
from nit_core.tools.core.SessionOps.session_ops import enter_work_mode, exit_work_mode

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

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    source: str = "ide"
    session_id: str = "default"

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
    # We use voice_manager's broadcast capability to send "thinking" statuses to the frontend (IdeChat/PetView)
    # This ensures that even for IDE chats, we get real-time visualization via WebSocket.
    from services.voice_manager import voice_manager
    
    async def on_status(status_type: str, content: str):
        # Broadcast thinking steps to all connected clients (IDE, PetView, etc.)
        if status_type == "thinking":
            await voice_manager.broadcast({
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
        await voice_manager.broadcast({"type": "status", "content": "idle"})

    return StreamingResponse(generate(), media_type="text/plain")

def get_workspace_root():
    """
    Get the absolute path to the workspace root.
    Defaults to the parent directory of the backend (project root).
    """
    base_dir = os.getcwd()
    # Go up one level to reach PeroCore root
    workspace_root = os.path.abspath(os.path.join(base_dir, ".."))
    return workspace_root

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

@router.post("/work_mode/enter")
async def api_enter_work_mode(request: WorkModeRequest, session: AsyncSession = Depends(get_session)):
    # Inject session into SessionOps context (as it relies on global context currently)
    from nit_core.tools.core.SessionOps.session_ops import set_current_session_context
    set_current_session_context(session)
    
    result = await enter_work_mode(request.task_name)
    return {"message": result}

@router.post("/work_mode/exit")
async def api_exit_work_mode(session: AsyncSession = Depends(get_session)):
    # Inject session
    from nit_core.tools.core.SessionOps.session_ops import set_current_session_context
    set_current_session_context(session)
    
    result = await exit_work_mode()
    return {"message": result}

@router.post("/work_mode/abort")
async def api_abort_work_mode(session: AsyncSession = Depends(get_session)):
    """
    Exit work mode WITHOUT summarization (Quiet Exit).
    """
    from backend.models import Config
    from sqlmodel import select
    
    try:
        config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        if config_id and config_id.value.startswith("work_"):
            config_id.value = "default"
            await session.commit()
            return {"message": "Work Mode aborted (No summary generated)."}
        else:
            return {"message": "Not in Work Mode."}
    except Exception as e:
        return {"message": f"Error aborting Work Mode: {e}"}
