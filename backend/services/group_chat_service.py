import uuid
from typing import List, Optional
from sqlmodel import select, desc
from sqlmodel.ext.asyncio.session import AsyncSession
from models import GroupChatRoom, GroupChatMember, GroupChatMessage
from datetime import datetime
import json

class GroupChatService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_room(self, name: str, creator_id: str, member_ids: List[str], description: str = None) -> GroupChatRoom:
        room_id = str(uuid.uuid4())
        room = GroupChatRoom(id=room_id, name=name, creator_id=creator_id, description=description)
        self.session.add(room)
        
        # Add creator (if not in member_ids)
        if creator_id not in member_ids:
             self.session.add(GroupChatMember(room_id=room_id, agent_id=creator_id, role="admin"))
        
        # Add members
        for member_id in member_ids:
            role = "admin" if member_id == creator_id else "member"
            # Check if already added
            existing = (await self.session.exec(select(GroupChatMember).where(GroupChatMember.room_id == room_id, GroupChatMember.agent_id == member_id))).first()
            if not existing:
                self.session.add(GroupChatMember(room_id=room_id, agent_id=member_id, role=role))
        
        await self.session.commit()
        await self.session.refresh(room)
        return room

    async def list_rooms(self) -> List[GroupChatRoom]:
        statement = select(GroupChatRoom).order_by(desc(GroupChatRoom.created_at))
        return (await self.session.exec(statement)).all()

    async def get_room(self, room_id: str) -> Optional[GroupChatRoom]:
        return await self.session.get(GroupChatRoom, room_id)

    async def get_room_members(self, room_id: str) -> List[GroupChatMember]:
        statement = select(GroupChatMember).where(GroupChatMember.room_id == room_id)
        return (await self.session.exec(statement)).all()

    async def add_message(self, room_id: str, sender_id: str, content: str, role: str = "user", mentions: List[str] = []) -> GroupChatMessage:
        msg = GroupChatMessage(
            room_id=room_id,
            sender_id=sender_id,
            content=content,
            role=role,
            mentions_json=json.dumps(mentions)
        )
        self.session.add(msg)
        await self.session.commit()
        await self.session.refresh(msg)
        
        # Inject Memory (Independent Memory for each Agent)
        if content.strip():
            members = await self.get_room_members(room_id)
            from services.memory_service import MemoryService
            
            for member in members:
                # Do not inject for user, only for agents
                if member.agent_id == 'user':
                    continue

                # Contextualize
                # If sender is self, mark as "I said"
                prefix = "I said" if member.agent_id == sender_id else f"{sender_id} said"
                context_content = f"[{prefix} in Group]: {content}"
                
                try:
                    await MemoryService.save_memory(
                        session=self.session,
                        content=context_content,
                        tags=f"group_chat,room:{room_id},sender:{sender_id}",
                        memory_type="group_chat",
                        source="group_chat",
                        agent_id=member.agent_id
                    )
                except Exception as e:
                    print(f"[GroupChat] Memory injection failed for {member.agent_id}: {e}")

        return msg

    async def get_history(self, room_id: str, limit: int = 50) -> List[GroupChatMessage]:
        stmt = select(GroupChatMessage).where(GroupChatMessage.room_id == room_id).order_by(desc(GroupChatMessage.timestamp)).limit(limit)
        msgs = (await self.session.exec(stmt)).all()
        return sorted(msgs, key=lambda x: x.timestamp)

    @staticmethod
    async def trigger_group_response(room_id: str):
        """Static method to trigger group response in background with fresh session"""
        import asyncio
        asyncio.create_task(GroupChatService._run_group_response_task(room_id))

    @staticmethod
    async def _run_group_response_task(room_id: str):
        from database import engine
        from sqlmodel.ext.asyncio.session import AsyncSession
        from sqlalchemy.orm import sessionmaker
        
        try:
            # Create a new session for the background task
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                service = GroupChatService(session)
                await service.process_group_response_logic(room_id)
        except Exception as e:
            print(f"[GroupChat] Background task failed: {e}")

    async def process_group_response_logic(self, room_id: str):
        """Trigger responses from all agents in the group."""
        import asyncio
        from services.agent_service import AgentService
        from services.agent_manager import get_agent_manager
        
        members = await self.get_room_members(room_id)
        # Filter out user and get agent IDs
        agent_ids = [m.agent_id for m in members if m.agent_id != 'user']
        
        if not agent_ids:
            return

        # Fetch recent history for context
        history_msgs = await self.get_history(room_id, limit=20)
        
        async def respond_for_agent(agent_id: str):
            try:
                # 1. Format messages for this agent
                # Perspective Shifting: 
                # - If msg.sender_id == agent_id, it is 'assistant'
                # - If msg.sender_id == 'user', it is 'user'
                # - If msg.sender_id == other_agent, it is 'user' (external) but prefixed
                
                formatted_msgs = []
                for m in history_msgs:
                    role = 'user'
                    content = m.content
                    
                    if m.sender_id == agent_id:
                        role = 'assistant'
                    elif m.sender_id == 'user':
                        role = 'user'
                    else:
                        # Other agent speaking
                        role = 'user'
                        content = f"[{m.sender_id}]: {content}"
                    
                    formatted_msgs.append({"role": role, "content": content})
                
                # 2. Call AgentService
                # We need a NEW session to avoid conflicts if running in parallel?
                # Actually, self.session is async session, sharing it might be okay for reads, 
                # but AgentService writes to DB. Sharing one session across concurrent tasks is risky.
                # Ideally we should spawn new session.
                # But for MVP let's try sequential execution if session sharing is hard, 
                # OR use the same session but be careful.
                # Let's run sequentially for safety first.
                
                agent_service = AgentService(self.session)
                response_content = ""
                
                # Use a specific source 'group_chat'
                async for chunk in agent_service.chat(
                    messages=formatted_msgs,
                    source="group_chat",
                    session_id=f"group_{room_id}", # Isolate history (though we pass explicit messages)
                    agent_id_override=agent_id
                ):
                    response_content += chunk
                
                # 3. Add response to group chat
                if response_content:
                    await self.add_message(room_id, agent_id, response_content, role="assistant")
                    
            except Exception as e:
                print(f"[GroupChat] Response failed for {agent_id}: {e}")

        # Run sequentially to avoid DB session conflicts
        for aid in agent_ids:
            await respond_for_agent(aid)

