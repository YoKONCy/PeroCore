import asyncio
import os
import logging
import re
import json
import base64
from fastapi import WebSocket, WebSocketDisconnect
from typing import Optional
from services.asr_service import get_asr_service
from services.tts_service import get_tts_service
from services.agent_service import AgentService
from database import get_session
from models import ConversationLog, Config, AIModelConfig
from sqlmodel import select

# 配置日志
logger = logging.getLogger(__name__)

class RealtimeVoiceManager:
    """
    实时语音对话管理器 (模拟 N.E.K.O 的实时语音流程)
    - 接收前端音频流
    - VAD 检测 (目前由前端做，这里只接收分片)
    - 语音转文字 (ASR)
    - 文本对话 (Agent)
    - 文字转语音 (TTS)
    - 推送音频流回前端
    """
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.asr_service = get_asr_service()
        self.tts_service = get_tts_service()
        self.current_task: Optional[asyncio.Task] = None

    def _clean_text(self, text: str, for_tts: bool = True) -> str:
        """清洗文本，移除标签、动作描述等不应朗读的内容"""
        # 1. 移除 XML 标签 (包括内容)
        # 注意：这里我们只移除特定的标签，或者所有标签？
        # 目前主要移除 <PEROCUE> 等控制标签
        cleaned = re.sub(r'<[^>]+>.*?</[^>]+>', '', text, flags=re.DOTALL)
        
        # 2. 移除 NIT 调用块
        from nit_core.parser import NITParser
        cleaned = NITParser.remove_nit_blocks(cleaned)
        
        # 3. 移除思考过程 【Thinking: ...】
        # 如果是用于 TTS，必须移除；如果是用于 UI展示，可以保留（由前端折叠）
        if for_tts:
            cleaned = re.sub(r'【Thinking.*?】', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
        
        # 4. 移除动作描述 *...*
        # TTS 通常不读动作，UI 可以选择保留或移除。这里为了保持一致性，TTS 模式下移除。
        # 如果是为了 UI 展示，保留动作描述可能更好，增加表现力。
        if for_tts:
            cleaned = re.sub(r'\*.*?\*', '', cleaned)
        
        # 5. 移除括号内的备注 (可选，视情况而定)
        # cleaned = re.sub(r'\(.*?\)', '', cleaned)
        
        # 6. 移除多余空白
        cleaned = re.sub(r'\n+', '\n', cleaned)
        
        # 7. [Feature] Chatter Removal: Only read the last paragraph if for_tts is True
        # This helps avoid reading "Thinking" chatter or prefix text that is not the main response
        if for_tts:
             segments = [s.strip() for s in cleaned.split('\n') if s.strip()]
             if segments:
                 cleaned = segments[-1]
                 
        return cleaned.strip()

    def _get_voice_params(self, full_response: str):
        """鲁棒地根据回复中的心情标签 (XML 或 NIT) 或内容，动态调整语音参数"""
        # 统一使用晓伊音色，作为全局默认基础值
        voice = "zh-CN-XiaoyiNeural" 
        rate = "+15%"
        pitch = "+5Hz"

        # 尝试提取心情关键词
        mood_text = ""
        
        # 方案 A: 尝试从 NIT 协议块中提取 mood 参数 (新版)
        from nit_core.parser import NITParser
        nit_calls = NITParser.parse_text(full_response)
        for call in nit_calls:
            if call['plugin'] in ['update_character_status', 'update_status', 'set_status']:
                mood_text = call['params'].get('mood', '')
                if mood_text:
                    break
        
        # 方案 B: 尝试正则匹配 <PEROCUE> 标签 (旧版兼容)
        if not mood_text:
            perocue_match = re.search(r'<PEROCUE>(.*?)</PEROCUE>', full_response, re.S)
            if perocue_match:
                raw_content = perocue_match.group(1).strip()
                try:
                    data = json.loads(raw_content)
                    mood_text = str(data.get("mood", ""))
                except:
                    mood_match = re.search(r'["\']mood["\']\s*:\s*["\']([^"\']+)["\']', raw_content)
                    if mood_match:
                        mood_text = mood_match.group(1)

        # 方案 C: 如果标签解析彻底失败，就在整个文本中搜索“心情”相关的词（最后的保底）
        if not mood_text:
            mood_text = full_response

        # 情绪微调逻辑 (在晓伊的基础上进行微调)
        if any(word in mood_text for word in ["兴奋", "开心", "喜悦", "激昂", "嘿嘿", "太棒了"]):
            # 保持巅峰状态
            rate = "+20%"
            pitch = "+7Hz"
        elif any(word in mood_text for word in ["难过", "低落", "委屈", "疲惫", "唔", "呜"]):
            # 稍微沉稳一点，但依然保留晓伊的底色
            rate = "+5%"
            pitch = "+2Hz"
        elif any(word in mood_text for word in ["生气", "愤怒", "哼"]):
            # 语速加快，音调变冲
            rate = "+25%"
            pitch = "+4Hz"
        elif any(word in mood_text for word in ["温馨", "温情", "爱", "主人"]):
            # 稍微慢一点，显得乖巧
            rate = "+10%"
            pitch = "+5Hz"

        return voice, rate, pitch

    def _extract_triggers(self, text: str) -> dict:
        """
        [已弃用] 从 LLM 回复中提取交互类触发器标签。
        现已由 NIT 协议下的 UpdateStatusPlugin 统一处理。
        """
        return {}

    async def broadcast(self, message: dict):
        """向所有连接的客户端广播消息"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Broadcast failed for client: {e}")
                disconnected.append(connection)
        
        for connection in disconnected:
            if connection in self.active_connections:
                self.active_connections.remove(connection)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("Realtime voice client connected")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("Realtime voice client disconnected")

    async def handle_websocket(self, websocket: WebSocket):
        await self.connect(websocket)
        try:
            while True:
                # 接收前端发送的消息
                # 消息格式: {"type": "audio", "data": "base64..."} 或 {"type": "text", "content": "..."}
                message = await websocket.receive_json()
                
                if message.get("type") == "audio_chunk":
                    # 处理音频分片 (暂存或流式识别)
                    # 为了简化，我们假设前端已经做了 VAD，发送的是一段完整的语音 (speech_end)
                    pass
                
                elif message.get("type") == "speech_end":
                    # 语音结束，开始处理
                    audio_data_base64 = message.get("data")
                    if audio_data_base64:
                        # 1. 检查是否有正在进行的任务 (打断机制)
                        if self.current_task and not self.current_task.done():
                            print("[VOICE] Interruption detected! Cancelling current thinking task...")
                            self.current_task.cancel()
                            try:
                                await self.current_task
                            except asyncio.CancelledError:
                                print("[VOICE] Previous task cancelled successfully.")
                            except Exception as e:
                                print(f"[VOICE] Error cancelling previous task: {e}")
                        
                        # 2. 启动新任务
                        self.current_task = asyncio.create_task(self._process_voice_turn(websocket, audio_data_base64))

        except WebSocketDisconnect:
            self.disconnect(websocket)
            if self.current_task and not self.current_task.done():
                self.current_task.cancel()
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            self.disconnect(websocket)
            if self.current_task and not self.current_task.done():
                self.current_task.cancel()

    async def _process_voice_turn(self, websocket: WebSocket, audio_base64: str):
        """处理一轮语音对话"""
        import time
        start_turn_time = time.time()
        
        # 1. 保存临时音频文件
        temp_audio_path = f"temp_voice_{id(websocket)}.wav"
        try:
            print("\n" + "="*60)
            print(f"[VOICE] Start New Turn at {time.strftime('%H:%M:%S')}")
            print("="*60)
            
            with open(temp_audio_path, "wb") as f:
                f.write(base64.b64decode(audio_base64))
            
            # 2. ASR: 语音转文字 (无论是否原生多模态，都需要 ASR 文本用于长记忆搜索和对话历史)
            print("[ASR] Transcribing audio...")
            await websocket.send_json({"type": "status", "content": "listening"})
            
            asr_start = time.time()
            try:
                user_text = await self.asr_service.transcribe(temp_audio_path)
            except Exception as e:
                error_msg = f"语音识别失败: {str(e)}"
                logger.error(error_msg)
                await websocket.send_json({"type": "text_response", "content": f"[{error_msg}]"})
                await websocket.send_json({"type": "status", "content": "idle"})
                return

            asr_duration = time.time() - asr_start
            
            if not user_text or not user_text.strip():
                print(f"[ASR] No speech detected ({asr_duration:.2f}s).")
                await websocket.send_json({"type": "status", "content": "idle"})
                return


            print(f"[ASR] User said: \"{user_text}\" ({asr_duration:.2f}s)")
            await websocket.send_json({"type": "transcription", "content": user_text})

            # 重置陪伴模式定时器
            try:
                from services.companion_service import companion_service
                companion_service.update_activity()
            except Exception as e:
                logger.warning(f"[VoiceManager] Failed to reset companion timer: {e}")

            # 3. Agent: 获取回复
            print("[AGENT] Generating response...")
            
            async def report_status(status_type: str, content: str):
                """内部回调，用于将 Agent 的进度推送到前端"""
                print(f"   ⏳ [Status] {content}")
                try:
                    await websocket.send_json({"type": "status", "content": status_type, "message": content})
                except Exception as e:
                    logger.warning(f"Failed to send status (connection likely closed): {e}")
                    # 如果连接断开，这里抛出异常会中断 Agent 的执行
                    # 为了不让 AgentService 记为 Error，我们可以选择吞掉异常，
                    # 或者让 AgentService 识别这种中断。
                    # 目前选择抛出，以便停止后续无用的生成。
                    raise WebSocketDisconnect()

            try:
                await websocket.send_json({"type": "status", "content": "thinking"})
            except Exception:
                return # 发送失败直接结束
            
            agent_start = time.time()
            # 获取数据库 session
            async for session in get_session():
                # --- Check for Native Audio Input ---
                enable_voice_input = False
                try:
                    # 1. Get current model ID
                    config_obj = (await session.exec(select(Config).where(Config.key == "current_model_id"))).first()
                    if config_obj and config_obj.value:
                        model_id_db = int(config_obj.value)
                        # 2. Get model config
                        model_config = await session.get(AIModelConfig, model_id_db)
                        if model_config and model_config.enable_voice:
                            enable_voice_input = True
                except Exception as e:
                    logger.warning(f"Failed to check voice input config: {e}")

                messages_payload = [{"role": "user", "content": user_text}]
                
                if enable_voice_input:
                    print(f"[VOICE] Native Audio Input Enabled. Path: {temp_audio_path}")
                    try:
                        if os.path.exists(temp_audio_path):
                            with open(temp_audio_path, "rb") as f:
                                audio_bytes = f.read()
                                audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
                            
                            print(f"[VOICE] Audio loaded. Size: {len(audio_bytes)} bytes. Preparing payload...")
                            
                            # --- EXPERIMENT: Multi-modal Compatibility Payload ---
                            # We provide BOTH the new OpenAI 'input_audio' 
                            # AND a 'data_url' style content which many Gemini proxies use.
                            messages_payload = [{
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": f"[主人正在通过语音交流 (ASR 预览: {user_text})]" 
                                    },
                                    {
                                        "type": "input_audio", 
                                        "input_audio": {
                                            "data": audio_b64,
                                            "format": "wav" 
                                        }
                                    },
                                    # Hack: Some Gemini proxies use image_url with audio data
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:audio/wav;base64,{audio_b64}"
                                        }
                                    }
                                ]
                            }]
                            print("[VOICE] Sent Robust Multimodal (Text + Audio + Compatibility) payload to LLM.")
                        else:
                            print(f"[VOICE] Audio file not found: {temp_audio_path}")
                            messages_payload = [{"role": "user", "content": user_text}]
                    except Exception as e:
                        print(f"[VOICE] Failed to prepare audio payload: {e}")
                        import traceback
                        traceback.print_exc()
                        # Fallback to text-only
                        messages_payload = [{"role": "user", "content": user_text}]

                agent = AgentService(session)
                full_response = ""
                
                # 流式获取回复文本
                try:
                    async for chunk in agent.chat(
                        messages_payload, 
                        source="desktop",
                        session_id="voice_session",
                        on_status=report_status,
                        is_voice_mode=True,
                        user_text_override=user_text # Pass text here for memory/logging
                    ):
                        if chunk:
                            full_response += chunk
                except WebSocketDisconnect:
                    print("[VOICE] User disconnected during generation.")
                    return
                except Exception as e:
                    print(f"[VOICE] Error during generation: {e}")
                
                agent_duration = time.time() - agent_start
                print(f"[AGENT] Response generated (Length: {len(full_response)}, {agent_duration:.2f}s)")
                
                # 4. 处理回复：解析标签、保存日志 (AgentService 已处理)、TTS
                print("[PROCESS] Parsing tags and preparing TTS...")
                
                # 4.1 解析并执行元数据 (AgentService.chat 内部已调用 _save_parsed_metadata)
                # 但由于 _save_parsed_metadata 是在 chat 结束时调用的，这里我们可以保留或删除
                # 为了安全，AgentService.chat 已经处理了 _save_parsed_metadata
                
                # 4.2 提取纯文本
                # UI 展示用：保留思考过程和动作描述，由前端处理展示
                ui_response = self._clean_text(full_response, for_tts=False)
                # TTS 合成用：移除思考过程和动作描述，确保语音干净
                tts_response = self._clean_text(full_response, for_tts=True)
                
                if not ui_response:
                    ui_response = "唔...Pero好像走神了..." # Fallback
                if not tts_response:
                    tts_response = "唔...Pero好像走神了..." # Fallback

                # 4.3 发送纯文本给前端展示
                try:
                    await websocket.send_json({"type": "status", "content": "speaking"})
                    
                    await websocket.send_json({"type": "text_response", "content": ui_response})
                except Exception as e:
                    logger.warning(f"Failed to send text response: {e}")
                    return

                # 4.4 动态选择音色和语速
                target_voice, target_rate, target_pitch = self._get_voice_params(full_response)
                
                # 4.6 TTS 合成并播放
                print(f"[TTS] Synthesizing with {target_voice} (Rate: {target_rate})...")
                tts_start = time.time()
                audio_path = await self.tts_service.synthesize(
                    tts_response, 
                    voice=target_voice, 
                    rate=target_rate, 
                    pitch=target_pitch
                )
                tts_duration = time.time() - tts_start
                
                if audio_path:
                    print(f"[TTS] Audio ready ({tts_duration:.2f}s), sending to client.")
                    # 读取音频文件并转为 base64 发送
                    try:
                        ext = os.path.splitext(audio_path)[1].replace('.', '') or "mp3"
                        with open(audio_path, "rb") as f:
                            audio_content = f.read()
                            audio_b64 = base64.b64encode(audio_content).decode('utf-8')
                            await websocket.send_json({
                                "type": "audio_response", 
                                "data": audio_b64,
                                "format": ext
                            })
                    except Exception as e:
                        logger.warning(f"Failed to send audio response: {e}")
                        return
                else:
                    print(f"❌ [4/4] TTS: Failed to synthesize audio ({tts_duration:.2f}s).")
                
                total_duration = time.time() - start_turn_time
                print("="*60)
                print(f"🏁 [Voice Pipeline] Turn Completed in {total_duration:.2f}s")
                print("="*60 + "\n")
                
                try:
                    await websocket.send_json({"type": "status", "content": "idle"})
                except:
                    pass
                break # 只处理一次 session

        except WebSocketDisconnect:
            logger.info("Client disconnected during voice turn")
        except Exception as e:
            logger.error(f"Error processing voice turn: {e}")
            try:
                await websocket.send_json({"type": "error", "content": str(e)})
            except:
                pass # 忽略发送错误信息时的失败
        finally:
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)

# 单例
voice_manager = RealtimeVoiceManager()
