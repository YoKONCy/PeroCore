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
            cls._instance.vision_buffer = [] # 存储最近 10 张截图 (base64)
            cls._instance.chat_cache = [] # 存储会话期间的日志用于总结
            cls._instance.cache_file = os.path.join(os.getcwd(), "data", "companion_chat_cache.json")
            
            # 确保数据目录存在
            os.makedirs(os.path.dirname(cls._instance.cache_file), exist_ok=True)
            # 加载崩溃恢复缓存（如果存在）
            cls._instance._load_cache()
            
        return cls._instance

    def _load_cache(self):
        """从文件加载聊天缓存以进行崩溃恢复"""
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    self.chat_cache = json.load(f)
                logger.info(f"[Companion] Recovered {len(self.chat_cache)} log entries from cache.")
            except Exception as e:
                logger.error(f"[Companion] Failed to load cache: {e}")

    def _save_cache_to_disk(self):
        """将聊天缓存保存到磁盘以进行崩溃恢复"""
        try:
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.chat_cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"[Companion] Failed to save cache: {e}")

    def update_activity(self):
        """更新最后活动时间以重置陪伴定时器"""
        self.last_activity_time = datetime.now()
        logger.info("[Companion] Timer reset due to user activity.")

    async def start(self):
        if self.is_running:
            return
        
        # 首先检查轻量模式
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
        
        # 1. 取消循环
        if self.task:
            self.task.cancel()
        if self.vision_task:
            self.vision_task.cancel()
            
        try:
            if self.task: await self.task
            if self.vision_task: await self.vision_task
        except asyncio.CancelledError:
            pass
        
        # 2. 总结记忆
        await self._summarize_and_save_memory()
        
        # 3. 清除视觉缓冲区
        self.vision_buffer = []
        
        # 4. 重置 UI 状态
        try:
            from services.voice_manager import voice_manager
            await voice_manager.broadcast({"type": "status", "content": "idle"})
        except:
            pass
            
        logger.info("Companion Service stopped.")

    async def _vision_loop(self):
        """每 2 秒截取屏幕的后台任务"""
        while self.is_running:
            try:
                img = self._capture_screen()
                if img:
                    self.vision_buffer.append(img)
                    # 仅保留最后 10 张
                    if len(self.vision_buffer) > 10:
                        self.vision_buffer.pop(0)
                await asyncio.sleep(2)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Companion] Vision loop error: {e}")
                await asyncio.sleep(5)

    async def _summarize_and_save_memory(self):
        """总结聊天缓存并作为单个记忆条目保存到数据库"""
        if not self.chat_cache:
            return

        logger.info(f"[Companion] Summarizing {len(self.chat_cache)} messages...")
        
        try:
            # 构建对话文本
            conv_text = ""
            for msg in self.chat_cache:
                role = "Pero" if msg['role'] == 'assistant' else "主人"
                conv_text += f"{role}: {msg['content']}\n"

            # 使用 LLM 进行总结
            async for session in get_session():
                # 获取模型配置（重用 _generate_response 中的逻辑）
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
                    # 保存到 Memory 表
                    from services.memory_service import MemoryService
                    await MemoryService.save_memory(
                        session=session,
                        content=f"[陪伴模式总结] {summary}",
                        tags="陪伴模式, 自动总结",
                        importance=2,
                        source="companion"
                    )
                    logger.info("[Companion] Memory summary saved successfully.")
                    
                    # 清除缓存和文件
                    self.chat_cache = []
                    if os.path.exists(self.cache_file):
                        os.remove(self.cache_file)
        except Exception as e:
            logger.error(f"[Companion] Failed to summarize memory: {e}")

    async def _loop(self):
        """陪伴模式的主循环"""
        from services.voice_manager import voice_manager # 在此处导入以避免循环依赖或初始化顺序问题
        
        logger.info("[Companion] Loop started.")
        print("[Companion] Loop started.", flush=True)
        
        # 广播初始陪伴状态
        try:
            # 如果服务刚启动，稍作等待以让 WebSocket 连接
            await asyncio.sleep(2) 
            await voice_manager.broadcast({"type": "status", "content": "idle"})
            await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
            print("[Companion] Initial state broadcasted.", flush=True)
        except Exception as e:
            logger.warning(f"Failed to broadcast companion start state: {e}")

        # 启动时立即强制运行一次
        first_run = True

        while self.is_running:
            try:
                # 计算自上次活动以来的时间
                now = datetime.now()
                elapsed = (now - self.last_activity_time).total_seconds()

                # 0. 定期重新广播 "陪伴中..." 以确保其在前端重新加载时保持显示
                # 仅在当前未处理响应时执行此操作
                # 并且如果用户空闲超过 15 秒（以避免覆盖活动聊天）
                if not first_run and elapsed > 15:
                     try:
                         # 我们在此处不发送 status:idle 以避免中断动画，仅发送文本
                         await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
                     except:
                         pass

                # 1. 检查是否已启用
                enabled = await self._is_enabled()
                if not enabled:
                    await asyncio.sleep(10) # 如果已禁用，每 10 秒检查一次
                    continue

                # 2. 检查间隔（默认 3 分钟）
                check_interval = 180
                
                if not first_run and elapsed < check_interval: 
                    # 休眠剩余时间或至少 5 秒
                    sleep_time = min(check_interval - elapsed, 5)
                    await asyncio.sleep(sleep_time)
                    continue
                
                # Reset first run flag
                first_run = False
                
                logger.info("[Companion] Triggering active dialogue...")
                print("[Companion] Triggering active dialogue...", flush=True)

                # 3. 休眠后再次检查是否仍已启用且无新活动
                if not self.is_running or not await self._is_enabled():
                    continue

                # 4. 使用视觉缓冲区（最后 2 张图像）
                if not self.vision_buffer:
                    logger.warning("[Companion] Vision buffer empty. Waiting...")
                    await asyncio.sleep(2)
                    continue
                
                # 取最后 2 张图像
                current_images = self.vision_buffer[-2:]
                logger.info(f"[Companion] Using {len(current_images)} images from buffer.")

                # 5. 生成响应
                logger.info("[Companion] Analyzing screen with LLM...")
                
                # 通知 UI：思考中（覆盖 "陪伴中..."）
                await voice_manager.broadcast({"type": "status", "content": "thinking"})
                # 显式将气泡文本设置为 "思考中..."
                await voice_manager.broadcast({"type": "text_response", "content": "思考中..."})

                response_text = await self._generate_response(current_images)
                
                # 6. 说话
                if response_text:
                    logger.info(f"[Companion] Pero says: {response_text}")
                    print(f"[Companion] Pero says: {response_text}", flush=True)
                    await self._speak(response_text)
                else:
                    # 如果没有响应，恢复到陪伴状态
                    print("[Companion] No response generated.", flush=True)
                    await voice_manager.broadcast({"type": "status", "content": "idle"})
                    await asyncio.sleep(0.5) # 等待前端清除
                    await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
                
                # 7. 成功运行（或尝试）后重置定时器
                self.update_activity()
                    
            except Exception as e:
                logger.error(f"[Companion] Error in loop: {e}")
                print(f"[Companion] Error in loop: {e}", flush=True)
                await asyncio.sleep(10) # 错误退避

    async def _is_enabled(self) -> bool:
        config_mgr = get_config_manager()
        # 必须启用陪伴模式且必须启用轻量模式
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
            # 截取全屏
            screenshot = ImageGrab.grab()
            # 如果太大则调整大小以节省 token/带宽
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
            # 获取活动模型
            config_entry = await session.get(Config, "current_model_id")
            if not config_entry:
                logger.warning("[Companion] No current model configured.")
                return None
            
            model_id = int(config_entry.value)
            model_config = await session.get(AIModelConfig, model_id)
            if not model_config:
                return None

            # 获取 API 配置
            global_api_key = (await session.get(Config, "global_llm_api_key"))
            global_api_base = (await session.get(Config, "global_llm_api_base"))
            
            api_key = model_config.api_key if model_config.provider_type == 'custom' else (global_api_key.value if global_api_key else "")
            api_base = model_config.api_base if model_config.provider_type == 'custom' else (global_api_base.value if global_api_base else "https://api.openai.com")

            llm = LLMService(api_key, api_base, model_config.model_id)

            # 构建 Prompt（针对短响应和低延迟进行了优化）
            system_prompt = (await self.prompt_manager.get_rendered_system_prompt(session)).replace("{current_time}", datetime.now().strftime("%Y-%m-%d %H:%M"))
            
            # 优化的陪伴指令
            system_prompt += "\n\n[陪伴模式核心指令]\n1. 你正通过屏幕观察主人。请基于看到的【连续多张截图】了解主人的最新动态。\n2. 以你的角色身份，发起一段极简、自然且有趣的对话。不要复读屏幕内容，要像真正的陪伴者一样进行闲聊。\n3. 【严格限制】：一次只能回复 1 句话，严禁超过 2 句话。字数控制在 20 字以内。\n4. 禁止调用任何 NIT 工具，直接输出回复内容。"

            content_list = [{"type": "text", "text": "【管理系统提醒：Pero，这是你观察到的主人最近两秒内的连续屏幕内容（按时间顺序排列，最后一张为最新）。请根据看到的内容，结合你的人格设定，主动开启一段极简对话。】"}]
            for i, img in enumerate(base64_imgs):
                # 计算大致的时间偏移（假设 2 张图像总共约 2 秒，或使用缓冲区计时）
                # 因为我们从缓冲区取最新的 2 张，而缓冲区每 2 秒填充一次
                # 让我们清晰地标记它们
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

                # 精简版陪伴模式继承了轻量级逻辑（直接输出，无 NIT）
                # 我们在此处跳过保存，因为我们自己处理缓存和总结
                async for chunk in agent.chat(
                    messages=messages,
                    source="desktop",
                    session_id="companion_mode",
                    on_status=on_status_update,
                    skip_save=True
                    # skip_nit_filter=True  <-- Removed: AgentService.chat does not support this arg
                ):
                    if chunk:
                        full_content += chunk
            
                if full_content and not full_content.startswith("Error:"):
                    # 添加到聊天缓存
                    self.chat_cache.append({"role": "user", "content": "（观察屏幕）", "time": datetime.now().isoformat()})
                    self.chat_cache.append({"role": "assistant", "content": full_content, "time": datetime.now().isoformat()})
                    # 限制缓存大小以防止爆炸，尽管我们在退出时会进行总结
                    if len(self.chat_cache) > 100:
                        self.chat_cache = self.chat_cache[-100:]
                    
                    self._save_cache_to_disk()
                    
                    # 手动日志（如果需要，简化用于 UI 历史记录显示，尽管会话是隔离的）
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
                try:
                    from services.voice_manager import voice_manager
                    await voice_manager.broadcast({"type": "status", "content": "idle"})
                except:
                    pass
                return None

    async def _speak(self, text: str):
        # 使用 VoiceManager 的清理逻辑以保持一致性
        from services.voice_manager import voice_manager
        
        # 1. 清理用于 UI（保留思考/动作以供显示）
        ui_text = voice_manager._clean_text(text, for_tts=False)
        
        # 2. 清理用于 TTS（针对复杂任务的智能过滤）
        # 策略：如果文本包含思考块，我们假设它是一个复杂任务。
        # 我们只想说出*最终*结果，即最后一个思考块之后的文本。
        tts_text = voice_manager._clean_text(text, for_tts=True)
        
        # 检查原始文本是否有思考块
        if "【Thinking" in text:
            # 找到思考块的最后一个右括号
            # 我们查找标准右括号或解析中使用的等效正则
            last_thinking_end = text.rfind('】')
            if last_thinking_end != -1:
                # 提取最后一个思考块之后的所有内容
                final_segment = text[last_thinking_end + 1:]
                # 清理此段落用于 TTS（移除动作等）
                tts_text = voice_manager._clean_text(final_segment, for_tts=True)
        
        # 附加过滤：只朗读最后一段（以避免唠叨）
        # 用户特别要求在最终响应之前忽略 "唠叨"。
        # 这适用于所有陪伴消息，确保我们只说出最后的 "点睛之笔" 或响应。
        if tts_text:
            # 按换行符分割并取最后一个非空段落
            segments = [s.strip() for s in tts_text.split('\n') if s.strip()]
            if segments:
                tts_text = segments[-1]
                logger.info(f"[Companion] TTS refined to last paragraph: {tts_text[:50]}...")

        if not ui_text and not tts_text:
            return

        # 2. 通知 UI 并发送气泡
        try:
            # 通知正在说话
            await voice_manager.broadcast({"type": "status", "content": "speaking"})
            
            # 发送触发器
            triggers = voice_manager._extract_triggers(text)
            if triggers:
                await voice_manager.broadcast({"type": "triggers", "data": triggers})
                
            # 发送文本气泡（带有供 UI 渲染的思考/动作）
            await voice_manager.broadcast({"type": "text_response", "content": ui_text})
        except Exception as e:
            logger.error(f"[Companion] Failed to broadcast UI events: {e}")

        # 3. 动态语音参数与 TTS
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
                        
                        # 清理
                        try:
                            os.remove(audio_path)
                        except:
                            pass
                    except Exception as e:
                        logger.error(f"[Companion] Audio playback error: {e}")
            except Exception as e:
                logger.error(f"[Companion] TTS error: {e}")
        
        # Finally 块以重置状态
        try:
             # 重置 UI 状态为陪伴模式
             await voice_manager.broadcast({"type": "status", "content": "idle"})
             # 稍作等待以确保如果我们发送得太快，'idle' 不会立即清除文本
             await asyncio.sleep(0.5) 
             await voice_manager.broadcast({"type": "text_response", "content": "陪伴中..."})
        except:
             pass

companion_service = CompanionService()
