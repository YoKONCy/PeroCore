import asyncio
import base64
import io
import logging
import os
import json
from datetime import datetime
from typing import Optional

try:
    from PIL import ImageGrab, Image
except ImportError:
    ImageGrab = None
    Image = None

try:
    import pygame
except ImportError:
    pygame = None

from sqlmodel import select
from database import get_session
from models import Config, AIModelConfig, ConversationLog, PetState
from services.llm_service import LLMService
from services.tts_service import TTSService
from services.prompt_service import PromptManager

logger = logging.getLogger(__name__)

class CompanionService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CompanionService, cls).__new__(cls)
            cls._instance.is_running = False
            cls._instance.task = None
            cls._instance.prompt_manager = PromptManager()
            cls._instance.tts_service = TTSService()
            cls._instance.last_activity_time = datetime.now()
        return cls._instance

    def update_activity(self):
        """Update last activity time to reset the companion timer"""
        self.last_activity_time = datetime.now()
        logger.info("[Companion] Timer reset due to user activity.")

    async def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.last_activity_time = datetime.now()
        self.task = asyncio.create_task(self._loop())
        logger.info("Companion Service started.")

    async def stop(self):
        self.is_running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        
        # Reset UI state
        try:
            await voice_manager.broadcast({"type": "status", "content": "idle"})
        except:
            pass
            
        logger.info("Companion Service stopped.")

    async def _loop(self):
        """Main loop for companion mode"""
        from services.voice_manager import voice_manager # Import here to avoid circular dependency or initialization order issues
        
        logger.info("[Companion] Loop started.")
        print("[Companion] Loop started.", flush=True)
        
        # Broadcast initial companion state
        try:
            # Wait a bit for websocket to connect if service just started
            await asyncio.sleep(2) 
            await voice_manager.broadcast({"type": "status", "content": "idle"})
            await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
            print("[Companion] Initial state broadcasted.", flush=True)
        except Exception as e:
            logger.warning(f"Failed to broadcast companion start state: {e}")

        # Force run once immediately on startup
        first_run = True

        while self.is_running:
            try:
                # Calculate time since last activity
                now = datetime.now()
                elapsed = (now - self.last_activity_time).total_seconds()

                # 0. Re-broadcast "陪伴中..." periodically to ensure it persists on frontend reload
                # Only do this if we are not currently processing a response
                # AND if user has been idle for > 15s (to avoid overwriting active chat)
                if not first_run and elapsed > 15:
                     try:
                         # We don't send status:idle here to avoid interrupting animations, just text
                         await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
                     except:
                         pass

                # 1. Check if enabled
                enabled = await self._is_enabled()
                if not enabled:
                    await asyncio.sleep(10) # Check every 10s if disabled
                    continue

                # 2. Check interval (default 3 minutes)
                check_interval = 180
                
                if not first_run and elapsed < check_interval: 
                    # Sleep for the remaining time or at least 5s
                    sleep_time = min(check_interval - elapsed, 5)
                    await asyncio.sleep(sleep_time)
                    continue
                
                # Reset first run flag
                first_run = False
                
                logger.info("[Companion] Triggering active dialogue...")
                print("[Companion] Triggering active dialogue...", flush=True)

                # 3. Double check if still enabled and no new activity after sleep
                if not self.is_running or not await self._is_enabled():
                    continue

                # 4. Capture Screen
                logger.info("[Companion] Capturing screen...")
                base64_img = self._capture_screen()
                if not base64_img:
                    logger.warning("[Companion] Failed to capture screen.")
                    # Reset timer even on failure to avoid spamming errors every loop
                    self.update_activity()
                    continue

                # 5. Generate Response
                logger.info("[Companion] Analyzing screen with LLM...")
                
                # Notify UI: Thinking (override "陪伴中...")
                await voice_manager.broadcast({"type": "status", "content": "thinking"})
                # Explicitly set bubble text to "思考中..." 
                await voice_manager.broadcast({"type": "text_response", "content": "思考中..."})

                response_text = await self._generate_response(base64_img)
                
                # 6. Speak
                if response_text:
                    logger.info(f"[Companion] Pero says: {response_text}")
                    print(f"[Companion] Pero says: {response_text}", flush=True)
                    await self._speak(response_text)
                else:
                    # If no response, revert to companion state
                    print("[Companion] No response generated.", flush=True)
                    await voice_manager.broadcast({"type": "status", "content": "idle"})
                    await asyncio.sleep(0.5) # Wait for frontend to clear
                    await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
                
                # 7. Reset timer after successful run (or attempt)
                self.update_activity()
                    
            except Exception as e:
                logger.error(f"[Companion] Error in loop: {e}")
                print(f"[Companion] Error in loop: {e}", flush=True)
                await asyncio.sleep(10) # Error backoff

    async def _is_enabled(self) -> bool:
        async for session in get_session():
            config = await session.get(Config, "companion_mode_enabled")
            return config.value == "true" if config else False
        return False

    def _capture_screen(self) -> Optional[str]:
        if not ImageGrab:
            return None
        try:
            # Capture full screen
            screenshot = ImageGrab.grab()
            # Resize if too big to save tokens/bandwidth
            screenshot.thumbnail((1024, 1024))
            
            buffered = io.BytesIO()
            screenshot.save(buffered, format="JPEG", quality=80)
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return img_str
        except Exception as e:
            logger.error(f"[Companion] Screen capture error: {e}")
            return None

    async def _generate_response(self, base64_img: str) -> Optional[str]:
        async for session in get_session():
            # Get active model
            config_entry = await session.get(Config, "current_model_id")
            if not config_entry:
                logger.warning("[Companion] No current model configured.")
                return None
            
            model_id = int(config_entry.value)
            model_config = await session.get(AIModelConfig, model_id)
            if not model_config:
                return None

            # Get API config
            global_api_key = (await session.get(Config, "global_llm_api_key"))
            global_api_base = (await session.get(Config, "global_llm_api_base"))
            
            api_key = model_config.api_key if model_config.provider_type == 'custom' else (global_api_key.value if global_api_key else "")
            api_base = model_config.api_base if model_config.provider_type == 'custom' else (global_api_base.value if global_api_base else "https://api.openai.com")

            llm = LLMService(api_key, api_base, model_config.model_id)

            # Construct Prompt
            # We use a simplified system prompt for companion mode
            system_prompt = (await self.prompt_manager.get_rendered_system_prompt(session)).replace("{current_time}", datetime.now().strftime("%Y-%m-%d %H:%M"))
            
            # Append specific instruction for companion mode (Chinese & Task Format)
            system_prompt += "\n\n[陪伴模式已激活]\n你现在正定期观察主人的屏幕。请根据你看到的内容，以你的角色身份主动发起一段简短、自然且有趣的对话。不要复读屏幕内容，要像真正的陪伴者一样进行闲聊。如果屏幕内容没有明显特征，可以聊聊别的或者简单问候。字数控制在2句以内。"

            messages = [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user", 
                    "content": [
                        {"type": "text", "text": "【管理系统提醒：Pero，这是你观察到的主人当前的屏幕内容。请根据看到的内容，结合你的人格设定，主动开启一段对话。】"},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}}
                    ]
                }
            ]

            try:
                # Use AgentService logic to ensure consistency (logging, parsing, state update)
                from services.agent_service import AgentService
                agent = AgentService(session)
                
                print("[Companion] Starting AgentService chat...", flush=True)
                # We need to simulate the chat flow but collect the full response first
                full_content = ""
                
                # Define a status callback to update UI
                async def on_status_update(status_type, status_content):
                    try:
                        from services.voice_manager import voice_manager
                        await voice_manager.broadcast({"type": "status", "content": "thinking"})
                        # Optional: Update bubble with detailed status if needed, but "思考中..." is usually enough
                    except:
                        pass

                async for chunk in agent.chat(
                    messages=messages, # AgentService handles history injection internally
                    source="desktop",
                    session_id="companion_mode",
                    on_status=on_status_update,
                    skip_save=True # 手动保存以控制 User Log 内容
                ):
                    if chunk:
                        print(f"[Companion] Received chunk: {chunk[:20]}...", flush=True)
                        full_content += chunk
            
                print(f"[Companion] Chat finished. Total length: {len(full_content)}", flush=True)

                # Manual Save & Trigger Memory (Fix for missing logs)
                if full_content and not full_content.startswith("Error:"):
                    try:
                        import uuid
                        pair_id = str(uuid.uuid4())
                        user_text_log = "（观察屏幕中...）" # 使用简短的占位符
                        
                        await agent.memory_service.save_log_pair(
                            session, 
                            "desktop", 
                            "companion_mode", 
                            user_text_log, 
                            full_content, 
                            pair_id
                        )
                        print(f"[Companion] Manually saved log pair: {pair_id}")
                        
                        # Trigger Scorer
                        if len(full_content) > 5:
                            asyncio.create_task(agent._run_scorer_background(user_text_log, full_content, "desktop", pair_id=pair_id))
                            print(f"[Companion] Manually triggered Scorer")
                    except Exception as e:
                        print(f"[Companion] Failed to save log/memory: {e}")

                return full_content
            except Exception as e:
                logger.error(f"[Companion] LLM error: {e}")
                # Revert status on error
                await voice_manager.broadcast({"type": "status", "content": "idle"})
                await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
                return None

    async def _speak(self, text: str):
        # Use VoiceManager's cleaning logic for consistency
        from services.voice_manager import voice_manager
        
        # 1. Clean for UI (Keep Thinking/Actions for display)
        ui_text = voice_manager._clean_text(text, for_tts=False)
        
        # 2. Clean for TTS (Smart filtering for complex tasks)
        # Strategy: If the text contains thinking blocks, we assume it's a complex task.
        # We only want to speak the *final* result, i.e., the text AFTER the last thinking block.
        tts_text = voice_manager._clean_text(text, for_tts=True)
        
        # Check if original text had thinking blocks
        if "【Thinking" in text:
            # Find the last closing bracket of a thinking block
            # We look for the standard closing bracket or the regex equivalent used in parsing
            last_thinking_end = text.rfind('】')
            if last_thinking_end != -1:
                # Extract everything after the last thinking block
                final_segment = text[last_thinking_end + 1:]
                # Clean this segment for TTS (remove actions, etc.)
                tts_text = voice_manager._clean_text(final_segment, for_tts=True)
        
        # Additional Filter: Only read the last paragraph (to avoid chatter)
        # The user specifically requested to ignore "chatter" before the final response.
        # This applies to ALL companion messages, ensuring we only speak the final "punchline" or response.
        if tts_text:
            # Split by newline and take the last non-empty segment
            segments = [s.strip() for s in tts_text.split('\n') if s.strip()]
            if segments:
                tts_text = segments[-1]
                logger.info(f"[Companion] TTS refined to last paragraph: {tts_text[:50]}...")

        if not ui_text and not tts_text:
            return

        # 2. Notify UI & Send Bubble
        try:
            # Notify Speaking
            await voice_manager.broadcast({"type": "status", "content": "speaking"})
            
            # Send Triggers
            triggers = voice_manager._extract_triggers(text)
            if triggers:
                await voice_manager.broadcast({"type": "triggers", "data": triggers})
                
            # Send Text Bubble (with Thinking/Actions for UI to render)
            await voice_manager.broadcast({"type": "text_response", "content": ui_text})
        except Exception as e:
            logger.error(f"[Companion] Failed to broadcast UI events: {e}")

        # 3. Dynamic Voice Params & TTS
        if tts_text and tts_text.strip():
            try:
                audio_path = await self.tts_service.synthesize(tts_text)
                if audio_path and os.path.exists(audio_path):
                    if not pygame:
                            logger.error("Pygame not installed, cannot play audio.")
                            return

                    try:
                        pygame.mixer.init()
                        pygame.mixer.music.load(audio_path)
                        pygame.mixer.music.play()
                        while pygame.mixer.music.get_busy():
                            await asyncio.sleep(0.1)
                        pygame.mixer.quit()
                        
                        # Cleanup
                        try:
                            os.remove(audio_path)
                        except:
                            pass
                    except Exception as e:
                        logger.error(f"[Companion] Audio playback error: {e}")
            except Exception as e:
                logger.error(f"[Companion] TTS error: {e}")
        
        # Finally block to reset status
        try:
             # Reset UI status to companion mode
             await voice_manager.broadcast({"type": "status", "content": "idle"})
             # Wait a bit to ensure 'idle' doesn't clear the text immediately if we send it too fast
             await asyncio.sleep(0.5) 
             await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
        except:
             pass

companion_service = CompanionService()
