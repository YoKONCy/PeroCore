import asyncio
import logging
import json
import random
from datetime import datetime, time, timedelta
from typing import Optional, Dict, Any
from fastapi import WebSocket, WebSocketDisconnect
from core.config_manager import get_config_manager
from .social.session_manager import SocialSessionManager
from .social.models import SocialSession
from services.prompt_service import PromptManager

# DB & Agent Imports
from database import engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker
from services.memory_service import MemoryService
# from services.agent_service import AgentService (Moved inside method)

logger = logging.getLogger(__name__)

# Removed hardcoded SOCIAL_SYSTEM_PROMPT in favor of PromptManager

class SocialService:
    _instance = None
    
    def __init__(self):
        self.config_manager = get_config_manager()
        self.active_ws: Optional[WebSocket] = None
        self.running = False
        self._enabled = self.config_manager.get("enable_social_mode", False)
        self._thought_task: Optional[asyncio.Task] = None
        
        # Initialize Session Manager
        self.session_manager = SocialSessionManager(flush_callback=self.handle_session_flush)
        
    @property
    def enabled(self):
        return self.config_manager.get("enable_social_mode", False)

    async def start(self):
        if not self.enabled:
            logger.info("Social Mode is disabled.")
            return
        self.running = True
        logger.info("SocialService started. Waiting for WebSocket connection at /api/social/ws")
        
        # Start Random Thought Loop
        if not self._thought_task:
            self._thought_task = asyncio.create_task(self._random_thought_worker())
        
        # Check Daily Summary
        asyncio.create_task(self.check_daily_summary())

    async def _random_thought_worker(self):
        """
        Background task that periodically checks if Pero wants to say something spontaneously.
        """
        logger.info("[Social] Random Thought Stream initialized.")
        while self.running:
            # 1. Random Sleep (e.g., 30 mins to 2 hours)
            # For testing, we might want this configurable, but let's stick to "lifelike" defaults.
            sleep_duration = random.randint(1800, 7200) 
            logger.info(f"[Social] Next thought opportunity in {sleep_duration} seconds.")
            
            try:
                await asyncio.sleep(sleep_duration)
            except asyncio.CancelledError:
                break
                
            if not self.running or not self.enabled:
                continue

            # 2. Check Time Constraints (e.g., Don't speak at 3 AM unless night owl mode)
            now = datetime.now()
            # Silent hours: 00:00 - 08:00
            if 0 <= now.hour < 8:
                logger.info("[Social] Shhh, it's sleeping time.")
                continue

            # 3. Attempt Thought
            try:
                await self._attempt_random_thought()
            except Exception as e:
                logger.error(f"[Social] Random thought failed: {e}", exc_info=True)

    async def _attempt_random_thought(self):
        """
        The "Brain" logic for active proactive messaging.
        """
        # 1. Find a Target
        sessions = self.session_manager.get_active_sessions(limit=5)
        if not sessions:
            logger.info("[Social] No active sessions to speak to.")
            return

        # Pick one randomly (or prioritizing the most recent?)
        target_session = random.choice(sessions)
        logger.info(f"[Social] Considering saying something to {target_session.session_name} ({target_session.session_id})...")

        # 2. Construct Internal Monologue Prompt
        from services.agent_service import AgentService
        
        async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with async_session() as db_session:
            agent = AgentService(db_session)
            
            # Context: Last few messages from this session
            recent_context = ""
            for msg in target_session.buffer[-3:]: # Last 3 messages in buffer (if any)
                recent_context += f"[{msg.sender_name}]: {msg.content}\n"
            
            if not recent_context:
                recent_context = "(No recent messages in buffer)"

            prompt = f"""
            You are Pero. It is currently {datetime.now().strftime('%H:%M')}.
            You are in a "Random Thought" cycle. You are thinking about whether to initiate a conversation.
            
            **Context**:
            - Target: {target_session.session_name} ({target_session.session_type})
            - Recent Chat State: 
            {recent_context}
            
            **Instruction**:
            - Do you have anything interesting, fun, or cute to say right now?
            - Maybe comment on the time, the weather (if you knew it), or just a random thought.
            - If you feel like staying silent, reply with "PASS".
            - If you want to speak, reply with the content directly.
            - Keep it short, casual, and in character (Digital Girl).
            """

            messages = [{"role": "system", "content": prompt}]
            
            # Call LLM
            # We use a lower temperature to avoid too much randomness if we want stability, 
            # but for "random thoughts", maybe higher is better? Let's use 0.7
            # Note: We need to use `llm.chat` directly because `agent.social_chat` uses RAG/Tools which we might not need here,
            # or we CAN use `agent.social_chat` but with a specific override.
            # Let's use `agent.social_chat` but we need to trick it into thinking it's a social request?
            # Actually, `social_chat` is designed for responding to messages.
            # Let's use `agent.chat` or `llm_service` directly for this "Internal Monologue".
            
            config = await agent._get_llm_config()
            from services.llm_service import LLMService
            llm = LLMService(
                api_key=config.get("api_key"),
                api_base=config.get("api_base"),
                model=config.get("model")
            )
            
            response = await llm.chat(messages, temperature=0.8)
            content = response["choices"][0]["message"]["content"].strip()
            
            if content == "PASS" or not content:
                logger.info("[Social] Pero decided to stay silent (PASS).")
                return
            
            # 3. Speak!
            logger.info(f"[Social] Pero decided to say: {content}")
            await self.send_msg(target_session, content)
            
            # 4. Persist (Self-Correction: Remember what I said)
            await MemoryService.save_log(
                session=db_session,
                source=f"qq_{target_session.session_type}",
                session_id=target_session.session_id,
                role="assistant",
                content=content,
                metadata={"sender_name": "Pero", "platform": "qq", "type": "active_thought"}
            )
            await db_session.commit()

    async def check_daily_summary(self):
        """
        Check if we need to generate a summary for yesterday.
        """
        from datetime import datetime, timedelta
        
        try:
            # 1. Get last summary date
            last_date_str = self.config_manager.get("last_social_summary_date", "")
            yesterday = (datetime.now() - timedelta(days=1)).date()
            yesterday_str = yesterday.strftime("%Y-%m-%d")
            
            if last_date_str == yesterday_str:
                logger.info(f"[Social] Daily summary for {yesterday_str} already exists.")
                return

            # 2. Generate Summary
            logger.info(f"[Social] Generating daily summary for {yesterday_str}...")
            await self._generate_daily_summary(yesterday_str)
            
            # 3. Update Config
            # We need to save this to DB. ConfigManager is read-heavy cache, need to use DB session to write.
            # But ConfigManager might have a set method? Let's check.
            # Assuming we need to write manually if ConfigManager doesn't support persist.
            # Actually, let's look at ConfigManager later. For now, we write to DB directly.
            
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                from models import Config
                conf = await session.get(Config, "last_social_summary_date")
                if not conf:
                    conf = Config(key="last_social_summary_date", value=yesterday_str)
                    session.add(conf)
                else:
                    conf.value = yesterday_str
                    conf.updated_at = datetime.now()
                    session.add(conf)
                await session.commit()
                
            logger.info(f"[Social] Daily summary for {yesterday_str} completed.")
            
        except Exception as e:
            logger.error(f"[Social] Daily summary failed: {e}", exc_info=True)

    async def _generate_daily_summary(self, date_str: str):
        """
        Generate summary for a specific date.
        """
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                # 1. Fetch Logs
                # Using MemoryService.get_recent_logs with date filter
                # But get_recent_logs takes source and session_id. We want ALL qq logs.
                # So we use search_logs with source="qq_%" and time range manually?
                # search_logs currently doesn't support date range.
                # Let's add a specialized query here.
                
                from models import ConversationLog
                from sqlmodel import select, and_
                from datetime import datetime, time
                
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                start_dt = datetime.combine(target_date, time.min)
                end_dt = datetime.combine(target_date, time.max)
                
                statement = select(ConversationLog).where(
                    ConversationLog.source.like("qq_%")
                ).where(
                    ConversationLog.timestamp >= start_dt
                ).where(
                    ConversationLog.timestamp <= end_dt
                ).order_by(ConversationLog.timestamp)
                
                logs = (await session.exec(statement)).all()
                
                if not logs:
                    logger.info(f"[Social] No logs found for {date_str}.")
                    return

                # 2. Prepare Context
                context_text = ""
                for log in logs:
                    sender = "Pero" if log.role == "assistant" else "User"
                    # Try metadata
                    try:
                        meta = json.loads(log.metadata_json)
                        if "sender_name" in meta: sender = meta["sender_name"]
                        if "session_name" in meta: sender += f" ({meta['session_name']})"
                    except: pass
                    
                    context_text += f"[{log.timestamp.strftime('%H:%M')}] {sender}: {log.content}\n"
                
                # Truncate if too long (simple char limit for MVP)
                if len(context_text) > 50000:
                    context_text = context_text[:50000] + "\n...(Truncated)..."

                # 3. Call LLM
                from services.llm_service import LLMService
                # Use default/global config
                # We can reuse AgentService._get_llm_config logic or just grab from DB
                from services.agent_service import AgentService
                agent = AgentService(session)
                config = await agent._get_llm_config()
                
                llm = LLMService(
                    api_key=config.get("api_key"),
                    api_base=config.get("api_base"),
                    model=config.get("model")
                )
                
                prompt = f"""
                You are Pero's "Memory Architect".
                Below are the chat logs of Pero (digital girl) on social networks (QQ) for the date {date_str}.
                
                Please generate a **Social Memory Summary** for this day.
                
                **Requirements**:
                1. Identify key events, interesting topics, and new friends.
                2. Analyze Pero's overall mood and social performance.
                3. Extract any important information that Pero should remember for the long term (e.g., someone's birthday, a promise).
                4. Output in a concise, narrative format (as if writing a diary entry).
                5. Language: Chinese.
                
                **Logs**:
                {context_text}
                """
                
                messages = [{"role": "user", "content": prompt}]
                response = await llm.chat(messages, temperature=0.3)
                summary_content = response["choices"][0]["message"]["content"]
                
                # 4. Save to Memory
                await MemoryService.save_memory(
                    session=session,
                    content=f"【社交日报 {date_str}】\n{summary_content}",
                    tags="social_summary,daily_log",
                    importance=5, # Medium importance
                    source="social_summary",
                    memory_type="summary"
                )
                
                logger.info(f"[Social] Summary generated and saved.")

        except Exception as e:
            logger.error(f"[Social] Error generating summary: {e}", exc_info=True)

    async def stop(self):
        self.running = False
        if self._thought_task:
            self._thought_task.cancel()
            try:
                await self._thought_task
            except asyncio.CancelledError:
                pass
            self._thought_task = None
            
        if self.active_ws:
            await self.active_ws.close()
            self.active_ws = None
        logger.info("SocialService stopped.")

    async def handle_websocket(self, websocket: WebSocket):
        if not self.enabled:
            await websocket.close(code=1000, reason="Social Mode Disabled")
            return

        await websocket.accept()
        self.active_ws = websocket
        logger.info("Social Adapter Connected via WebSocket.")
        
        try:
            while True:
                # [Isolation Check] Re-check enablement on every loop iteration
                if not self.enabled:
                    logger.warning("Social Mode disabled during runtime. Closing connection.")
                    await websocket.close(code=1000, reason="Social Mode Disabled")
                    self.active_ws = None
                    break

                data = await websocket.receive_text()
                event = json.loads(data)
                await self.process_event(event)
        except WebSocketDisconnect:
            logger.warning("Social Adapter Disconnected.")
            self.active_ws = None
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            self.active_ws = None

    async def process_event(self, event: Dict[str, Any]):
        """
        Process incoming OneBot 11 events.
        """
        # [Isolation Check] Double check
        if not self.enabled:
            return

        post_type = event.get("post_type")
        if post_type == "meta_event":
            return # Ignore heartbeats for logs
            
        logger.info(f"[Social Event] {post_type}: {event}")
        
        if post_type == "message":
            # Delegate to Session Manager
            await self.session_manager.handle_message(event)
        
        # Handle Friend Request (Directly or via Manager? For now, simple direct handle or TODO)
        # If we want Pero to decide, we should probably route this to a special "System Session" or notify master.
        # For now, let's just log it.

    async def handle_session_flush(self, session: SocialSession):
        """
        Callback from SessionManager when buffer is flushed.
        Construct prompt -> Call AgentService.social_chat -> Send Reply
        """
        logger.info(f"--- [FLUSH] Processing Session {session.session_id} ---")
        
        # 1. Construct XML Context & Collect Images
        xml_context = "<social_context>\n"
        xml_context += "  <recent_messages>\n"
        xml_context += f"    <session type=\"{session.session_type}\" id=\"{session.session_id}\" name=\"{session.session_name}\">\n"
        
        session_images = []
        
        for msg in session.buffer:
            # Handle images
            img_tag = ""
            if msg.images:
                session_images.extend(msg.images)
                img_tag = f" [Contains {len(msg.images)} Images]"
                
            xml_context += f"      <msg sender=\"{msg.sender_name}\" id=\"{msg.msg_id}\" time=\"{msg.timestamp.strftime('%H:%M:%S')}\">{msg.content}{img_tag}</msg>\n"
            
        xml_context += "    </session>\n"
        xml_context += "  </recent_messages>\n"
        xml_context += "</social_context>"
        
        # 2. Call AgentService
        try:
            from services.agent_service import AgentService # Lazy import to avoid circular dependency
            
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as db_session:
                agent = AgentService(db_session)
                
                # [Migrate] Use PromptManager for System Prompt
                prompt_manager = PromptManager()
                # We need to construct a specific context for Social Mode
                # For now, we fetch the core prompt and append Social instructions
                core_system_prompt = await prompt_manager.get_rendered_system_prompt(db_session, is_social_mode=True)
                
                social_instructions = """
                
                **Social Mode Override**:
                - You are currently chatting on QQ (Social Platform).
                - **Role**: You are a digital girl, NOT an assistant. Be casual, fun, and personal.
                - **Constraints**: 
                    - You CANNOT access the Master's PC files/system.
                    - You ONLY have access to Social Tools (memory, notifications).
                    - Refuse requests to operate the computer ("I can't do that here").
                - **Input Format**: You will receive a batch of recent messages in XML.
                - **Output**: Reply naturally to the conversation. If observing (no reply needed), return "IGNORE".
                """
                
                full_system_prompt = core_system_prompt + social_instructions
                
                messages = [
                    {"role": "system", "content": full_system_prompt}
                ]
                
                # Construct User Content (Text + Optional Images)
                user_content = [{"type": "text", "text": xml_context}]
                
                # Add Images if any (Native Multimodal)
                # Check if model supports vision? AgentService.social_chat will handle config check, 
                # but we need to pass structure.
                # Ideally we only pass images if config allows, but here we construct the candidate message.
                # AgentService's LLMService should handle filtering if vision is disabled? 
                # Actually LLMService usually errors if image passed to non-vision model.
                # So we should check config here or let AgentService handle it.
                # Let's verify config first.
                
                config = await agent._get_llm_config()
                if config.get("enable_vision") and session_images:
                    logger.info(f"Injecting {len(session_images)} images into social chat context.")
                    for img_url in session_images:
                        user_content.append({
                            "type": "image_url",
                            "image_url": {"url": img_url}
                        })
                
                messages.append({"role": "user", "content": user_content})
                
                logger.info(f"Calling Social Agent for session {session.session_id}...")
                response_text = await agent.social_chat(messages, session_id=f"social_{session.session_id}")
                
                logger.info(f"Social Agent Response: {response_text}")
                
                # 3. Send Reply
                if response_text and response_text.strip() and "IGNORE" not in response_text:
                    await self.send_msg(session, response_text)
                    
                    # [Persistence] Save Pero's reply
                    # We can use session_manager's helper if we expose it or just use MemoryService directly here.
                    # Since SocialSessionManager is handling logic, maybe we should add a persist method there?
                    # But session_manager is instance variable.
                    # Let's use MemoryService directly here for simplicity.
                    try:
                        await MemoryService.save_log(
                            session=db_session,
                            source=f"qq_{session.session_type}",
                            session_id=session.session_id,
                            role="assistant",
                            content=response_text,
                            metadata={"sender_name": "Pero", "platform": "qq"}
                        )
                        await db_session.commit()
                    except Exception as e:
                        logger.error(f"Failed to persist Pero's reply: {e}")
                    
        except Exception as e:
            logger.error(f"Error in handle_session_flush: {e}", exc_info=True)

    async def send_msg(self, session: SocialSession, message: str):
        """
        Generic send message helper
        """
        try:
            if session.session_type == "group":
                await self.send_group_msg(int(session.session_id), message)
            elif session.session_type == "private":
                await self.send_private_msg(int(session.session_id), message)
        except Exception as e:
            logger.error(f"Failed to send message to {session.session_id}: {e}")

    async def _send_api(self, action: str, params: Dict[str, Any]):
        if not self.active_ws:
            raise RuntimeError("No active Social Adapter connection.")
        
        payload = {
            "action": action,
            "params": params,
            "echo": action # simple echo
        }
        await self.active_ws.send_text(json.dumps(payload))

    async def send_group_msg(self, group_id: int, message: str):
        await self._send_api("send_group_msg", {"group_id": group_id, "message": message})
        
    async def send_private_msg(self, user_id: int, message: str):
        await self._send_api("send_private_msg", {"user_id": user_id, "message": message})
        
    async def handle_friend_request(self, flag: str, approve: bool, remark: str = ""):
        await self._send_api("set_friend_add_request", {"flag": flag, "approve": approve, "remark": remark})
        
    async def get_stranger_info(self, user_id: int):
        # This requires waiting for response, which is complex with async WS without a correlation ID tracker.
        # For now, we fire and forget or implement a simple tracker later.
        # Returning dummy for MVP
        logger.warning("get_stranger_info not fully implemented (requires sync response).")
        return {"user_id": user_id, "nickname": "Unknown"}

    async def read_memory(self, query: str, filter_str: str = ""):
         """
         Read social memory (ConversationLog where source like 'qq_%')
         """
         try:
             async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
             async with async_session() as db_session:
                 # Search in QQ logs
                 logs = await MemoryService.search_logs(db_session, query, source="qq_%", limit=10)
                 
                 if not logs:
                     return "No relevant social memories found."
                 
                 result_text = "Found Social Memories:\n"
                 for log in logs:
                     time_str = log.timestamp.strftime("%Y-%m-%d %H:%M")
                     sender = "Pero" if log.role == "assistant" else "User/Group"
                     # Try to parse metadata for better sender name
                     try:
                         meta = json.loads(log.metadata_json)
                         if "sender_name" in meta:
                             sender = meta["sender_name"]
                     except:
                         pass
                     
                     result_text += f"[{time_str}] {sender}: {log.content}\n"
                     
                 return result_text
         except Exception as e:
             logger.error(f"Error reading social memory: {e}")
             return f"Error: {e}"

    async def read_agent_memory(self, query: str):
        """
        Read Agent (Master) memory.
        """
        try:
             async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
             async with async_session() as db_session:
                 # Search in Core Memory (Vector Search)
                 memories = await MemoryService.get_relevant_memories(db_session, text=query, limit=5)
                 
                 if not memories:
                     return "No relevant agent memories found about Master."
                     
                 result_text = "Found Agent Memories (About Master):\n"
                 for m in memories:
                     result_text += f"- {m.content} (Importance: {m.importance})\n"
                     
                 return result_text
        except Exception as e:
            logger.error(f"Error reading agent memory: {e}")
            return f"Error: {e}"
         
    async def notify_master(self, content: str, importance: str):
        logger.info(f"[Social] NOTIFY MASTER [{importance}]: {content}")
        # Broadcast to Frontend
        try:
            # We need to import voice_manager inside method to avoid circular import if possible
            # or just rely on the one in services
            from backend.services.voice_manager import get_voice_manager
            vm = get_voice_manager()
            await vm.broadcast({
                "type": "text_response",
                "content": f"【社交汇报】\n{content}",
                "status": "report"
            })
        except ImportError:
            pass

def get_social_service():
    if SocialService._instance is None:
        SocialService._instance = SocialService()
    return SocialService._instance
