import os
import asyncio
import json
import httpx
from faster_whisper import WhisperModel
from typing import Optional
from sqlmodel import select
from database import get_session
from models import VoiceConfig

class ASRService:
    def __init__(self):
        # 默认使用本地下载好的 whisper-tiny 模型
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.local_model_path = os.path.join(base_dir, "models", "whisper-tiny")
        
        self.device = "cpu"
        self.compute_type = "int8"
        self._model = None
        self._lock = asyncio.Lock()

    async def _get_active_config(self) -> Optional[VoiceConfig]:
        async for session in get_session():
            return (await session.exec(select(VoiceConfig).where(VoiceConfig.type == "stt").where(VoiceConfig.is_active == True))).first()
        return None

    def _load_model(self, model_path: str, device: str, compute_type: str):
        """延迟加载模型"""
        if self._model is None:
            print(f"Loading Whisper model: {model_path} on {device}...")
            self._model = WhisperModel(model_path, device=device, compute_type=compute_type)
            print("Whisper model loaded successfully.")

    async def transcribe(self, audio_path: str) -> Optional[str]:
        """
        识别音频文件
        """
        config = await self._get_active_config()
        if not config:
            # Fallback to local whisper
             return await self._transcribe_local(audio_path, {}, None)

        try:
            config_json = json.loads(config.config_json)
        except:
            config_json = {}

        if config.provider == "local_whisper":
            return await self._transcribe_local(audio_path, config_json, config)
        elif config.provider == "openai_compatible":
            return await self._transcribe_openai(audio_path, config_json, config)
        else:
            return await self._transcribe_local(audio_path, config_json, config)

    async def _transcribe_local(self, audio_path: str, config_json: dict, config: Optional[VoiceConfig]) -> Optional[str]:
        async with self._lock:
            try:
                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(None, self._transcribe_sync, audio_path, config_json)
            except Exception as e:
                print(f"ASR Error: {e}")
                # 重新抛出异常，以便上层捕获并通知前端
                raise e

    def _transcribe_sync(self, audio_path: str, config_json: dict) -> str:
        device = config_json.get("device", "cpu")
        compute_type = config_json.get("compute_type", "int8")
        
        # 允许通过配置指定本地模型路径
        model_path = config_json.get("model_path", self.local_model_path)
        if not os.path.exists(model_path):
             model_path = self.local_model_path
        
        self._load_model(model_path, device, compute_type)
        segments, info = self._model.transcribe(audio_path, beam_size=5, language="zh", task="transcribe")
        
        full_text = ""
        for segment in segments:
            full_text += segment.text
            
        return full_text.strip()

    async def _transcribe_openai(self, audio_path: str, config_json: dict, config: VoiceConfig) -> Optional[str]:
        try:
            url = f"{config.api_base}/audio/transcriptions" if config.api_base else "https://api.openai.com/v1/audio/transcriptions"
            
            headers = {
                "Authorization": f"Bearer {config.api_key}"
            }
            
            # Prepare multipart/form-data
            data = {
                "model": config.model or "whisper-1",
            }
            
            # Read file content
            if not os.path.exists(audio_path):
                return None
                
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(audio_path, "rb") as f:
                    # 使用文件名作为 file 字段的 filename
                    files = {"file": (os.path.basename(audio_path), f, "audio/wav")} 
                    response = await client.post(url, headers=headers, data=data, files=files)
                    
                if response.status_code != 200:
                    print(f"OpenAI ASR API Error: {response.text}")
                    return None
                    
                result = response.json()
                return result.get("text", "")
        except Exception as e:
            print(f"OpenAI ASR Error: {e}")
            return None

_asr_service = None
def get_asr_service() -> ASRService:
    global _asr_service
    if _asr_service is None:
        _asr_service = ASRService()
    return _asr_service
