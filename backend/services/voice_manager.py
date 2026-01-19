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
        if not text:
            return ""

        # 1. 移除 XML 标签 (包括内容)
        cleaned = re.sub(r'<[^>]+>.*?</[^>]+>', '', text, flags=re.DOTALL)
        
        # 2. 移除 NIT 调用块
        from nit_core.dispatcher import remove_nit_tags
        cleaned = remove_nit_tags(cleaned)
        
        if for_tts:
            # [特性] 智能 ReAct 过滤器
            # 目标：只朗读最终回复，忽略 思考/计划/行动/观察 (Thinking/Plan/Action/Observation) 的历史记录。
            
            # 0. 全局移除思考 (Thinking) 和 碎碎念 (Monologue)
            # 无论是否检测到 Final Answer，这些内容都绝对不应该朗读
            cleaned = re.sub(r'【(?:Thinking|Monologue).*?】', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
            cleaned = re.sub(r'\[(?:Thinking|Monologue).*?\]', '', cleaned, flags=re.DOTALL | re.IGNORECASE)

            # 策略 1：如果存在 "Final Answer" (最终回答) 标记，则提取其后的所有内容。
            final_marker = re.search(r'(?:Final Answer|最终回答|回复)[:：]?\s*(.*)', cleaned, flags=re.DOTALL | re.IGNORECASE)
            if final_marker:
                cleaned = final_marker.group(1)
            else:
                # 策略 2：通过已知的 ReAct 块标题进行分割，并提取最后一块。
                # 这假设回复总是在最后。
                
                # 标准化换行符
                cleaned = cleaned.replace('\r\n', '\n')
                
                # 识别最后一个 "技术标题" 并提取其后的内容
                # 标题包括：Plan:, Action:, Observation:, Result:, Thought:
                # 我们查找这些标题在行首的最后一次出现
                headers_pattern = r'(?m)^(?:Plan|计划|Action|Action Input|Observation|Result|Thought|Prompt)[:：]'
                
                matches = list(re.finditer(headers_pattern, cleaned))
                if matches:
                    last_match = matches[-1]
                    # 从最后一个标题之后的行开始
                    # 等等，如果最后一个标题是 "Plan:"，我们也想跳过计划内容。
                    # 计划内容通常在下一个标题或双换行符处结束。
                    # 既然我们找到了最后一个标题，那么它之后的内容要么是该标题的内容，要么是最终回复。
                    
                    remaining = cleaned[last_match.start():]
                    
                    # 启发式规则：如果是 Observation/Result/Action，我们要么不读它。
                    # 但如果它是剩下的唯一内容，也许我们什么都不应该读？
                    # 然而，通常在技术块之后会有文本。
                    
                    # 让我们尝试移除与最后一个块关联的 *行*，如果它们看起来像技术内容。
                    # 但更简单的方法：最终回复通常不以关键字开头。
                    # 所以如果我们有 `Observation: ... \n Hello`，我们要的是 `Hello`。
                    
                    # 让我们使用一个 "块剥离器" (Block Stripper) 来移除所有已知的技术块。
                    # 正则表达式匹配技术块：标题 -> 内容 -> 下一个标题/结尾
                    
                    block_pattern = r'(?m)^(?:Plan|计划|Action|Action Input|Observation|Result|Thought|Prompt)[:：][\s\S]*?(?=(?:^(?:Plan|计划|Action|Action Input|Observation|Result|Thought|Prompt|Final Answer|最终回答|回复)[:：])|\Z)'
                    cleaned = re.sub(block_pattern, '', cleaned)

        # 4. 移除动作描述 *...* 或 (动作)
        if for_tts:
            cleaned = re.sub(r'\*.*?\*', '', cleaned)
            cleaned = re.sub(r'\(.*?\)', '', cleaned) # 移除括号内的动作或备注
        
        # 5. 移除 Markdown 标记
        if for_tts:
            cleaned = re.sub(r'#+\s+', '', cleaned) # 移除标题符号
            cleaned = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', cleaned) # 移除链接，只保留文字
            cleaned = re.sub(r'[*_`]', '', cleaned) # 移除粗体、斜体、代码块标记
        
        # 6. 移除 Emoji 和特殊符号 (仅针对 TTS)
        if for_tts:
            cleaned = re.sub(r'[\U00010000-\U0010ffff]', '', cleaned)
            cleaned = re.sub(r'[^\w\s\u4e00-\u9fa5，。！？；：“”（）\n\.,!\?\-]', '', cleaned)
        
        # 7. 移除多余空白
        cleaned = re.sub(r'\n+', '\n', cleaned).strip()
        
        return cleaned

    def _get_voice_params(self, full_response: str):
        """鲁棒地根据回复中的心情标签 (XML 或 NIT) 或内容，动态调整语音参数"""
        # 统一使用晓伊音色，作为全局默认基础值
        voice = "zh-CN-XiaoyiNeural" 
        rate = "+15%"
        pitch = "+5Hz"

        # 尝试提取心情关键词
        mood_text = ""
        
        # 方案 A: 从回复内容中寻找心情暗示 (简单的关键词匹配)
        mood_keywords = {
            "happy": ["开心", "高兴", "兴奋", "乐"],
            "sad": ["伤心", "难过", "哭", "委屈"],
            "angry": ["生气", "愤怒", "火大", "恼"],
            "neutral": ["好吧", "知道", "哦", "嗯"]
        }
        
        for mood, keywords in mood_keywords.items():
            if any(k in full_response for k in keywords):
                mood_text = mood
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
                logger.warning(f"向客户端广播失败: {e}")
                disconnected.append(connection)
        
        for connection in disconnected:
            if connection in self.active_connections:
                self.active_connections.remove(connection)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("实时语音客户端已连接")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("实时语音客户端已断开")

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
                            print("[语音] 检测到打断！正在取消当前思考任务...")
                            self.current_task.cancel()
                            try:
                                await self.current_task
                            except asyncio.CancelledError:
                                print("[语音] 上一个任务已成功取消。")
                            except Exception as e:
                                print(f"[语音] 取消上一个任务时出错: {e}")
                        
                        # 2. 启动新任务
                        self.current_task = asyncio.create_task(self._process_voice_turn(websocket, audio_data_base64))

        except WebSocketDisconnect:
            self.disconnect(websocket)
            if self.current_task and not self.current_task.done():
                self.current_task.cancel()
        except Exception as e:
            logger.error(f"WebSocket 错误: {e}")
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
            print(f"[语音] 开始新一轮对话 {time.strftime('%H:%M:%S')}")
            print("="*60)
            
            with open(temp_audio_path, "wb") as f:
                f.write(base64.b64decode(audio_base64))
            
            # 2. ASR: 语音转文字 (无论是否原生多模态，都需要 ASR 文本用于长记忆搜索和对话历史)
            print("[ASR] 正在转录音频...")
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
                print(f"[ASR] 未检测到语音 ({asr_duration:.2f}s)。")
                await websocket.send_json({"type": "status", "content": "idle"})
                return


            print(f"[ASR] 用户说: \"{user_text}\" ({asr_duration:.2f}s)")
            await websocket.send_json({"type": "transcription", "content": user_text})

            # 重置陪伴模式定时器
            try:
                from services.companion_service import companion_service
                companion_service.update_activity()
            except Exception as e:
                logger.warning(f"[VoiceManager] 重置陪伴定时器失败: {e}")

            # 3. Agent: 获取回复
            print("[Agent] 正在生成响应...")
            
            async def report_status(status_type: str, content: str):
                """内部回调，用于将 Agent 的进度推送到前端"""
                print(f"   ⏳ [Status] {content}")
                try:
                    await websocket.send_json({"type": "status", "content": status_type, "message": content})
                except Exception as e:
                    logger.warning(f"发送状态失败 (连接可能已关闭): {e}")
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
                # --- 检查原生音频输入 ---
                enable_voice_input = False
                try:
                    # 1. 获取当前模型 ID
                    config_obj = (await session.exec(select(Config).where(Config.key == "current_model_id"))).first()
                    if config_obj and config_obj.value:
                        model_id_db = int(config_obj.value)
                        # 2. 获取模型配置
                        model_config = await session.get(AIModelConfig, model_id_db)
                        if model_config and model_config.enable_voice:
                            enable_voice_input = True
                except Exception as e:
                    logger.warning(f"检查语音输入配置失败: {e}")

                messages_payload = [{"role": "user", "content": user_text}]
                
                if enable_voice_input:
                    print(f"[语音] 原生音频输入已启用。路径: {temp_audio_path}")
                    try:
                        if os.path.exists(temp_audio_path):
                            with open(temp_audio_path, "rb") as f:
                                audio_bytes = f.read()
                                audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
                            
                            print(f"[语音] 音频已加载。大小: {len(audio_bytes)} 字节。正在准备负载...")
                            
                            # --- 实验性功能：多模态兼容性 Payload ---
                            # 我们同时提供新的 OpenAI 'input_audio'
                            # 以及许多 Gemini 代理使用的 'data_url' 风格的内容。
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
                                    # Hack: 一些 Gemini 代理使用 image_url 来传输音频数据
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:audio/wav;base64,{audio_b64}"
                                        }
                                    }
                                ]
                            }]
                            print("[语音] 已发送鲁棒的多模态 (文本 + 音频 + 兼容性) 负载给 LLM。")
                        else:
                            print(f"[语音] 未找到音频文件: {temp_audio_path}")
                            messages_payload = [{"role": "user", "content": user_text}]
                    except Exception as e:
                        print(f"[语音] 准备音频负载失败: {e}")
                        import traceback
                        traceback.print_exc()
                        # 回退到纯文本模式
                        messages_payload = [{"role": "user", "content": user_text}]

                agent = AgentService(session)
                full_response = ""
                # tts_text_parts = ["", ""] # [first_turn_text, last_turn_text] (已弃用)
                
                def report_status_wrapped(status, msg):
                    return report_status(status, msg)
                
                # 流式获取回复文本
                generation_error = None
                try:
                    async for chunk in agent.chat(
                        messages_payload, 
                        source="desktop",
                        session_id="voice_session",
                        on_status=report_status_wrapped,
                        is_voice_mode=True,
                        user_text_override=user_text # 在此处传递文本用于记忆/日志记录
                    ):
                        if chunk:
                            full_response += chunk
                except WebSocketDisconnect:
                    print("[语音] 用户在生成过程中断开连接。")
                    return
                except Exception as e:
                    print(f"[语音] 生成过程中出错: {e}")
                    generation_error = str(e)
                
                agent_duration = time.time() - agent_start
                print(f"[Agent] 响应已生成 (长度: {len(full_response)}, {agent_duration:.2f}s)")
                
                # 4. 处理回复：解析标签、保存日志 (AgentService 已处理)、TTS
                print("[Process] 正在解析标签并准备 TTS...")
                
                # 4.1 解析并执行元数据 (AgentService.chat 内部已调用 _save_parsed_metadata)
                # 但由于 _save_parsed_metadata 是在 chat 结束时调用的，这里我们可以保留或删除
                # 为了安全，AgentService.chat 已经处理了 _save_parsed_metadata
                
                # 4.2 提取纯文本
                # UI 展示用：保留完整思考过程和动作描述
                ui_response = self._clean_text(full_response, for_tts=False)
                
                # TTS 合成用：仅合成首轮和末轮的内容，并移除思考过程和动作描述
                # [优化] 直接使用 full_response 进行清洗，依赖 _clean_text 的 Smart Filter 策略
                # 这样可以更准确地提取“最终回答”，而不是机械地拼接首尾轮次
                tts_response = self._clean_text(full_response, for_tts=True)
                
                if not ui_response:
                    # 如果原始内容不为空（说明执行了动作但没有说话），则显示操作提示
                    if generation_error:
                        ui_response = f"(发生错误: {generation_error})"
                        tts_response = "哎呀，我好像出错了。"
                    elif full_response and full_response.strip():
                        ui_response = "（Pero默默执行了操作...）"
                    else:
                        ui_response = "唔...Pero好像走神了..." # 针对完全空回复的回退
                if not tts_response:
                    tts_response = "唔...Pero好像走神了..." # 回退

                # 4.3 发送纯文本给前端展示
                try:
                    await websocket.send_json({"type": "status", "content": "speaking"})
                    
                    await websocket.send_json({"type": "text_response", "content": ui_response})
                except Exception as e:
                    logger.warning(f"发送文本响应失败: {e}")
                    return

                # 4.4 动态选择音色和语速
                target_voice, target_rate, target_pitch = self._get_voice_params(full_response)
                
                # 4.6 TTS 合成并播放
                print(f"[TTS] 正在合成 {target_voice} (语速: {target_rate})...")
                tts_start = time.time()
                audio_path = await self.tts_service.synthesize(
                    tts_response, 
                    voice=target_voice, 
                    rate=target_rate, 
                    pitch=target_pitch
                )
                tts_duration = time.time() - tts_start
                
                if audio_path:
                    print(f"[TTS] 音频就绪 ({tts_duration:.2f}s)，正在发送给客户端。")
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
                        logger.warning(f"发送音频响应失败: {e}")
                        return
                else:
                    print(f"❌ [4/4] TTS: 合成音频失败 ({tts_duration:.2f}s)。")
                
                total_duration = time.time() - start_turn_time
                print("="*60)
                print(f"🏁 [语音流程] 本轮结束，耗时 {total_duration:.2f}s")
                print("="*60 + "\n")
                
                try:
                    await websocket.send_json({"type": "status", "content": "idle"})
                except:
                    pass
                break # 只处理一次 session

        except WebSocketDisconnect:
            logger.info("客户端在语音对话期间断开连接")
        except Exception as e:
            logger.error(f"处理语音对话出错: {e}")
            try:
                await websocket.send_json({"type": "error", "content": str(e)})
            except:
                pass # 忽略发送错误信息时的失败
        finally:
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)

# 单例
voice_manager = RealtimeVoiceManager()
