from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from typing import List, Optional, Any
from pydantic import BaseModel
from database import get_session
from services.group_chat_service import GroupChatService
from models import GroupChatRoom, GroupChatMessage

router = APIRouter(prefix="/api/groupchat", tags=["groupchat"])

class CreateRoomRequest(BaseModel):
    name: str
    description: Optional[str] = None
    creator_id: str
    member_ids: List[str]

class SendMessageRequest(BaseModel):
    sender_id: str
    content: str
    role: str = "user" # user or assistant
    mentions: List[str] = []

@router.post("/rooms", response_model=GroupChatRoom)
async def create_room(request: CreateRoomRequest, session: Session = Depends(get_session)):
    service = GroupChatService(session)
    return await service.create_room(request.name, request.creator_id, request.member_ids, request.description)

@router.get("/rooms", response_model=List[GroupChatRoom])
async def list_rooms(session: Session = Depends(get_session)):
    service = GroupChatService(session)
    return await service.list_rooms()

@router.get("/rooms/{room_id}/history", response_model=List[GroupChatMessage])
async def get_room_history(room_id: str, limit: int = 50, session: Session = Depends(get_session)):
    service = GroupChatService(session)
    return await service.get_history(room_id, limit)

@router.post("/rooms/{room_id}/messages", response_model=GroupChatMessage)
async def send_message(room_id: str, request: SendMessageRequest, session: Session = Depends(get_session)):
    service = GroupChatService(session)
    # 验证房间是否存在
    if not await service.get_room(room_id):
        raise HTTPException(status_code=404, detail="Room not found")
    
    msg = await service.add_message(room_id, request.sender_id, request.content, request.role, request.mentions)
    
    # 触发全员回复 (如果发送者是用户)
    if request.sender_id == 'user':
        # 使用后台触发以避免阻塞
        await GroupChatService.trigger_group_response(room_id)
        
    return msg

@router.get("/rooms/{room_id}/members")
async def get_room_members(room_id: str, session: Session = Depends(get_session)):
    service = GroupChatService(session)
    members = await service.get_room_members(room_id)
    return [{"agent_id": m.agent_id, "role": m.role} for m in members]
