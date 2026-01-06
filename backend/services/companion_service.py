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
from core.config_manager import get_config_manager

logger = logging.getLogger(__name__)

class CompanionService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CompanionService, cls).__new__(cls)
            cls._instance.is_running = False
            cls._instance.task = None
            cls._instance.vision_task = None
            cls._instance.prompt_manager = PromptManager()
            cls._instance.tts_service = TTSService()
            cls._instance.last_activity_time = datetime.now()
            cls._instance.vision_buffer = [] # Store last 10 screenshots (base64)
            cls._instance.chat_cache = [] # Store logs during session for summary
            cls._instance.cache_file = os.path.join(os.getcwd(), "data", "companion_chat_cache.json")
            
            # Ensure data dir exists
            os.makedirs(os.path.dirname(cls._instance.cache_file), exist_ok=True)
            # Load crash recovery cache if exists
            cls._instance._load_cache()
            
        return cls._instance

    def _load_cache(self):
        """Load chat cache from file for crash recovery"""
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    self.chat_cache = json.load(f)
                logger.info(f"[Companion] Recovered {len(self.chat_cache)} log entries from cache.")
            except Exception as e:
                logger.error(f"[Companion] Failed to load cache: {e}")

    def _save_cache_to_disk(self):
        """Save chat cache to disk for crash recovery"""
        try:
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.chat_cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"[Companion] Failed to save cache: {e}")

    def update_activity(self):
        """Update last activity time to reset the companion timer"""
        self.last_activity_time = datetime.now()
        logger.info("[Companion] Timer reset due to user activity.")

    async def start(self):
        if self.is_running:
            return
        
        # Check Lightweight Mode first
        config = get_config_manager()
        if not config.get("lightweight_mode", False):
            logger.warning("[Companion] Cannot start: Lightweight mode is disabled.")
            return

        self.is_running = True
        self.last_activity_time = datetime.now()
        self.task = asyncio.create_task(self._loop())
        self.vision_task = asyncio.create_task(self._vision_loop())
        logger.info("Companion Service started.")

    async def stop(self):
        self.is_running = False
        
        # 1. Cancel loops
        if self.task:
            self.task.cancel()
        if self.vision_task:
            self.vision_task.cancel()
            
        try:
            if self.task: await self.task
            if self.vision_task: await self.vision_task
        except asyncio.CancelledError:
            pass
        
        # 2. Summarize Memory
        await self._summarize_and_save_memory()
        
        # 3. Clear vision buffer
        self.vision_buffer = []
        
        # 4. Reset UI state
        try:
            from services.voice_manager import voice_manager
            await voice_manager.broadcast({"type": "status", "content": "idle"})
        except:
            pass
            
        logger.info("Companion Service stopped.")

    async def _vision_loop(self):
        """Background task to capture screen every 2 seconds"""
        while self.is_running:
            try:
                img = self._capture_screen()
                if img:
                    self.vision_buffer.append(img)
                    # Keep only last 10
                    if len(self.vision_buffer) > 10:
                        self.vision_buffer.pop(0)
                await asyncio.sleep(2)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Companion] Vision loop error: {e}")
                await asyncio.sleep(5)

    async def _summarize_and_save_memory(self):
        """Summarize chat cache and save to database as a single memory entry"""
        if not self.chat_cache:
            return

        logger.info(f"[Companion] Summarizing {len(self.chat_cache)} messages...")
        
        try:
            # Construct conversation text
            conv_text = ""
            for msg in self.chat_cache:
                role = "Pero" if msg['role'] == 'assistant' else "主人"
                conv_text += f"{role}: {msg['content']}\n"

            # Use LLM to summarize
            async for session in get_session():
                # Get model config (reusing logic from _generate_response)
                config_entry = await session.get(Config, "current_model_id")
                if not config_entry: return
                model_config = await session.get(AIModelConfig, int(config_entry.value))
                if not model_config: return

                global_api_key = (await session.get(Config, "global_llm_api_key"))
                global_api_base = (await session.get(Config, "global_llm_api_base"))
                api_key = model_config.api_key if model_config.provider_type == 'custom' else (global_api_key.value if global_api_key else "")
                api_base = model_config.api_base if model_config.provider_type == 'custom' else (global_api_base.value if global_api_base else "https://api.openai.com")

                llm = LLMService(api_key, api_base, model_config.model_id)
                
                summary_prompt = f"请你作为记忆整理专家，将以下这段陪伴模式下的对话记录总结为一段简洁的记忆（100字以内）。重点记录主人的状态、心情以及你们互动的核心内容。\n\n对话记录：\n{conv_text}"
                
                summary = await llm.chat([{"role": "user", "content": summary_prompt}])
                
                if summary and not summary.startswith("Error:"):
                    # Save to Memory table
                    from services.memory_service import MemoryService
                    await MemoryService.save_memory(
                        session=session,
                        content=f"[陪伴模式总结] {summary}",
                        tags="陪伴模式, 自动总结",
                        importance=2,
                        source="companion"
                    )
                    logger.info("[Companion] Memory summary saved successfully.")
                    
                    # Clear cache and file
                    self.chat_cache = []
                    if os.path.exists(self.cache_file):
                        os.remove(self.cache_file)
        except Exception as e:
            logger.error(f"[Companion] Failed to summarize memory: {e}")

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

                # 4. Use Vision Buffer (Last 2 images)
                if not self.vision_buffer:
                    logger.warning("[Companion] Vision buffer empty. Waiting...")
                    await asyncio.sleep(2)
                    continue
                
                # Take the last 2 images
                current_images = self.vision_buffer[-2:]
                logger.info(f"[Companion] Using {len(current_images)} images from buffer.")

                # 5. Generate Response
                logger.info("[Companion] Analyzing screen with LLM...")
                
                # Notify UI: Thinking (override "陪伴中...")
                await voice_manager.broadcast({"type": "status", "content": "thinking"})
                # Explicitly set bubble text to "思考中..." 
                await voice_manager.broadcast({"type": "text_response", "content": "思考中..."})

                response_text = await self._generate_response(current_images)
                
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
        config_mgr = get_config_manager()
        # Companion mode must be enabled AND Lightweight mode must be enabled
        if not config_mgr.get("lightweight_mode", False):
            return False
            
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

    async def _generate_response(self, base64_imgs: list) -> Optional[str]:
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

            # Construct Prompt (Optimized for short response and low latency)
            system_prompt = (await self.prompt_manager.get_rendered_system_prompt(session)).replace("{current_time}", datetime.now().strftime("%Y-%m-%d %H:%M"))
            
            # Optimized Companion Instruction
            system_prompt += "\n\n[陪伴模式核心指令]\n1. 你正通过屏幕观察主人。请基于看到的【连续多张截图】了解主人的最新动态。\n2. 以你的角色身份，发起一段极简、自然且有趣的对话。不要复读屏幕内容，要像真正的陪伴者一样进行闲聊。\n3. 【严格限制】：一次只能回复 1 句话，严禁超过 2 句话。字数控制在 20 字以内。\n4. 禁止调用任何 NIT 工具，直接输出回复内容。"

            content_list = [{"type": "text", "text": "【管理系统提醒：Pero，这是你观察到的主人最近两秒内的连续屏幕内容（按时间顺序排列，最后一张为最新）。请根据看到的内容，结合你的人格设定，主动开启一段极简对话。】"}]
            for i, img in enumerate(base64_imgs):
                # Calculate approximate time offset (assuming ~2s total for 2 images, or using buffer timing)
                # Since we take latest 2 from buffer, and buffer is populated every 2s
                # Let's label them clearly
                label = "较早前" if i == 0 and len(base64_imgs) > 1 else "当前"
                content_list.append({"type": "text", "text": f"--- 屏幕截图 ({label}) ---"})
                content_list.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}})

            messages = [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user", 
                    "content": content_list
                }
            ]

            try:
                from services.agent_service import AgentService
                agent = AgentService(session)
                
                full_content = ""
                
                async def on_status_update(status_type, status_content):
                    try:
                        from services.voice_manager import voice_manager
                        await voice_manager.broadcast({"type": "status", "content": "thinking"})
                    except: pass

                # Companion mode in refined version inherits lightweight logic (direct output, no NIT)
                # We skip save here because we handle caching and summarization ourselves
                async for chunk in agent.chat(
                    messages=messages,
                    source="desktop",
                    session_id="companion_mode",
                    on_status=on_status_update,
                    skip_save=True,
                    skip_nit_filter=True # Since we told it not to use NIT, we don't need to filter it, but safer to skip if it hallucinates
                ):
                    if chunk:
                        full_content += chunk
            
                if full_content and not full_content.startswith("Error:"):
                    # Add to chat cache
                    self.chat_cache.append({"role": "user", "content": "（观察屏幕）", "time": datetime.now().isoformat()})
                    self.chat_cache.append({"role": "assistant", "content": full_content, "time": datetime.now().isoformat()})
                    # Limit cache size to prevent explosion, though we summarize on exit
                    if len(self.chat_cache) > 100:
                        self.chat_cache = self.chat_cache[-100:]
                    
                    self._save_cache_to_disk()
                    
                    # Manual Log (Simplified for UI display in history if needed, though session is isolated)
                    try:
                        import uuid
                        pair_id = str(uuid.uuid4())
                        await agent.memory_service.save_log_pair(
                            session, "desktop", "companion_mode", "（观察屏幕）", full_content, pair_id
                        )
                    except Exception as e:
                        logger.error(f"[Companion] Log save error: {e}")

                return full_content
            except Exception as e:
                logger.error(f"[Companion] LLM error: {e}")
                await voice_manager.broadcast({"type": "status", "content": "idle"})
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
