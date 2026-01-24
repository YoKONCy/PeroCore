from fastapi import APIRouter, HTTPException, Body
from typing import List, Dict, Any
from services.agent_manager import get_agent_manager
from pydantic import BaseModel

router = APIRouter(prefix="/api/agents", tags=["agents"])

class AgentInfo(BaseModel):
    id: str
    name: str
    description: str
    is_active: bool
    is_enabled: bool

class EnabledAgentsRequest(BaseModel):
    agent_ids: List[str]

class ActiveAgentRequest(BaseModel):
    agent_id: str

@router.get("", response_model=List[AgentInfo])
async def list_agents():
    """List all available agents with their status."""
    manager = get_agent_manager()
    return manager.list_agents()

@router.get("/enabled", response_model=List[str])
async def get_enabled_agents():
    """Get list of enabled agent IDs."""
    manager = get_agent_manager()
    return manager.get_enabled_agents()

@router.post("/enabled")
async def set_enabled_agents(request: EnabledAgentsRequest):
    """Set the list of enabled agents."""
    manager = get_agent_manager()
    manager.set_enabled_agents(request.agent_ids)
    return {"status": "ok", "enabled_agents": manager.get_enabled_agents()}

@router.get("/active", response_model=Dict[str, Any])
async def get_active_agent():
    """Get the current active agent."""
    manager = get_agent_manager()
    profile = manager.get_active_agent()
    if not profile:
        raise HTTPException(status_code=404, detail="No active agent")
    
    return {
        "id": profile.id,
        "name": profile.name,
        "description": profile.description
    }

@router.post("/active")
async def set_active_agent(request: ActiveAgentRequest):
    """Switch the active agent."""
    manager = get_agent_manager()
    success = manager.set_active_agent(request.agent_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Agent '{request.agent_id}' not found or cannot be activated")
    
    return {"status": "ok", "active_agent": request.agent_id}
