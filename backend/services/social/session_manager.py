import asyncio
import logging
from typing import Dict, Optional, Callable, Awaitable
from datetime import datetime
from .models import SocialSession, SocialMessage

# DB Imports for persistence
from database import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from services.memory_service import MemoryService

logger = logging.getLogger(__name__)

class SocialSessionManager:
    def __init__(self, flush_callback: Callable[[SocialSession], Awaitable[None]]):
        """
        Args:
            flush_callback: Async function to call when buffer is flushed.
        """
        self.sessions: Dict[str, SocialSession] = {}
        self.flush_callback = flush_callback
        
        # Configuration
        self.BUFFER_TIMEOUT = 20  # seconds
        self.BUFFER_MAX_SIZE = 10 # messages
        self.ACTIVE_DURATION = 120 # seconds (Time to stay 'active' after speaking)

    def get_or_create_session(self, session_id: str, session_type: str, session_name: str = "") -> SocialSession:
        if session_id not in self.sessions:
            self.sessions[session_id] = SocialSession(
                session_id=session_id,
                session_type=session_type,
                session_name=session_name
            )
        return self.sessions[session_id]

    async def _persist_message(self, session: SocialSession, msg: SocialMessage, role: str):
        """
        Persist message to ConversationLog for RAG.
        """
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as db_session:
                source = f"qq_{session.session_type}" # qq_group or qq_private
                
                # Metadata
                meta = {
                    "msg_id": msg.msg_id,
                    "sender_name": msg.sender_name,
                    "session_name": session.session_name,
                    "platform": msg.platform
                }
                
                await MemoryService.save_log(
                    session=db_session,
                    source=source,
                    session_id=session.session_id,
                    role=role,
                    content=msg.content,
                    metadata=meta
                )
                await db_session.commit()
        except Exception as e:
            logger.error(f"Failed to persist social message: {e}")

    async def handle_message(self, event: dict):
        """
        Main entry point for handling incoming message events.
        """
        # 1. Parse Event
        try:
            msg_type = event.get("message_type") # group or private
            if msg_type == "group":
                session_id = str(event.get("group_id"))
                sender_id = str(event.get("user_id"))
                # Ideally get group name / sender name from event or API
                sender_name = event.get("sender", {}).get("nickname", "Unknown")
                # Group name is not always in message event, might need API or cache
                session_name = f"Group {session_id}" 
            elif msg_type == "private":
                session_id = str(event.get("user_id"))
                sender_id = str(event.get("user_id"))
                sender_name = event.get("sender", {}).get("nickname", "Unknown")
                if sender_name == "Unknown":
                    sender_name = f"User{sender_id}"
                session_name = sender_name
            else:
                return # Ignore other types

            content = event.get("raw_message", "")
            msg_id = str(event.get("message_id"))
            
            # Extract Images
            images = []
            message_chain = event.get("message", [])
            for segment in message_chain:
                if segment["type"] == "image":
                    url = segment["data"].get("url")
                    if url:
                        images.append(url)
            
            # Create Message Object
            msg = SocialMessage(
                msg_id=msg_id,
                sender_id=sender_id,
                sender_name=sender_name,
                content=content,
                timestamp=datetime.now(),
                raw_event=event,
                images=images
            )
            
            # Get Session
            session = self.get_or_create_session(session_id, msg_type, session_name)
            
            # [Persistence] Save user message immediately
            await self._persist_message(session, msg, "user")
            
            # 2. Check Triggers (Mention / State)
            is_mentioned = self._check_is_mentioned(content, event)
        
            # [Fix] In Private Chat, always consider as mentioned
            if msg_type == "private":
                is_mentioned = True
            
            # 3. Add to Buffer
            session.add_message(msg)
            
            # 4. Determine Action
            # If already summoned/active, or strictly mentioned -> Immediate Flush?
            # Design says: "Summoned -> Immediate response".
            # "Active" -> "More sensitive", maybe shorter buffer or immediate? 
            # For MVP Phase 1: Mention = Immediate Flush.
            
            if is_mentioned:
                session.state = "summoned"
                logger.info(f"[{session_id}] Summoned by mention!")
                await self._trigger_flush(session, reason="summoned")
            elif len(session.buffer) >= self.BUFFER_MAX_SIZE:
                logger.info(f"[{session_id}] Buffer full!")
                await self._trigger_flush(session, reason="buffer_full")
            else:
                # Reset Timer
                self._reset_flush_timer(session)
                
        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)

    def _check_is_mentioned(self, content: str, event: dict) -> bool:
        # Check OneBot "at" segment
        # raw_message usually contains CQ codes like [CQ:at,qq=123]
        # But simpler is checking 'message' array in OneBot v11
        message_chain = event.get("message", [])
        for segment in message_chain:
            if segment["type"] == "at":
                # Check if it is at ME
                # We need self_id. Usually in event['self_id']
                self_id = str(event.get("self_id"))
                target_id = str(segment["data"].get("qq"))
                if target_id == self_id:
                    return True
        
        # Fallback: Check keywords (nickname)
        if "pero" in content.lower() or "Pero" in content:
            return True
            
        return False

    def _reset_flush_timer(self, session: SocialSession):
        # Cancel existing timer
        if session.flush_timer_task:
            session.flush_timer_task.cancel()
        
        # Create new timer
        session.flush_timer_task = asyncio.create_task(self._timer_callback(session))

    async def _timer_callback(self, session: SocialSession):
        try:
            await asyncio.sleep(self.BUFFER_TIMEOUT)
            # Timer expired
            await self._trigger_flush(session, reason="timeout")
        except asyncio.CancelledError:
            pass # Timer reset or flushed

    async def _trigger_flush(self, session: SocialSession, reason: str):
        # Cancel timer if running
        if session.flush_timer_task:
            session.flush_timer_task.cancel()
            session.flush_timer_task = None
            
        if not session.buffer:
            return

        logger.info(f"[{session.session_id}] Flushing buffer. Reason: {reason}. Messages: {len(session.buffer)}")
        
        # Call the callback (SocialService logic)
        try:
            await self.flush_callback(session)
        except Exception as e:
            logger.error(f"Error in flush callback: {e}", exc_info=True)
        finally:
            # Always clear buffer after flush to avoid duplicates
            session.clear_buffer()

    def get_active_sessions(self, limit: int = 5) -> list[SocialSession]:
        """
        Get list of active sessions (most recently used).
        For now, returns all known sessions since memory start.
        """
        # Sort by last message timestamp (descending) if we had it, 
        # but currently sessions dict is just unordered.
        # We can look at the latest message in buffer if any, 
        # or we might need to track 'last_active_at' in SocialSession.
        
        # Let's assume sessions are relevant enough if they are in memory.
        # Ideally, we should add 'last_active_at' to SocialSession.
        return list(self.sessions.values())[:limit]
            
        # Clear buffer after flush logic (or should callback handle it? usually manager handles buffer)
        # But if callback fails, we might lose messages.
        # Design choice: Clear immediately to prevent double processing.
        session.clear_buffer()
