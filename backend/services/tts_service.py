import edge_tts
import os
import uuid
import json
import httpx
import logging
from typing import Optional
from sqlmodel import select
from database import get_session
from models import VoiceConfig
from .audio_processor import audio_processor
from core.config_manager import get_config_manager

logger = logging.getLogger(__name__)

class TTSService:
    def __init__(self):
        # 临时音频文件存储目录
        # [重构] 统一将临时文件移至 backend/data 目录
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # services -> backend
        default_data_dir = os.path.join(backend_dir, "data")
        data_dir = os.environ.get("PERO_DATA_DIR", default_data_dir)
        
        self.output_dir = os.path.join(data_dir, "temp_audio")
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir, exist_ok=True)

    async def _get_active_config(self) -> Optional[VoiceConfig]:
        async for session in get_session():
            return (await session.exec(select(VoiceConfig).where(VoiceConfig.type == "tts").where(VoiceConfig.is_active == True))).first()
        return None

    async def synthesize(self, text: str, voice: str = None, rate: str = None, pitch: str = None, cute: bool = False) -> Optional[str]:
        """
        将文字合成语音并保存为 mp3
        """
        if not get_config_manager().get("tts_enabled", True):
            return None

        if not text.strip():
            return None
            
        config = await self._get_active_config()
        overrides = {}
        if voice: overrides["voice"] = voice
        if rate: overrides["rate"] = rate
        if pitch: overrides["pitch"] = pitch

        filepath = None
        if not config:
             # 如果未找到配置，回退到默认的 edge-tts
             filepath = await self._synthesize_edge(text, {}, None, overrides)
        else:
            try:
                config_json = json.loads(config.config_json)
            except:
                config_json = {}

            if config.provider == "edge_tts":
                filepath = await self._synthesize_edge(text, config_json, config, overrides)
            elif config.provider == "openai_compatible":
                filepath = await self._synthesize_openai(text, config_json, config, overrides)
            else:
                # 未知提供商，回退到 edge
                filepath = await self._synthesize_edge(text, config_json, config, overrides)

        # 如果开启了可爱化后处理
        if filepath and cute:
            processed_filepath = filepath.replace(".mp3", "_cute.wav") # Parselmouth 保存为 wav
            success = await audio_processor.process_voice_cute(filepath, processed_filepath)
            if success:
                # 删除原文件，使用处理后的文件
                # 注意：前端需要处理 wav 格式，或者我们再转回 mp3
                # 为了简单起见，我们先尝试直接返回 wav
                if os.path.exists(filepath):
                    os.remove(filepath)
                return processed_filepath
        
        return filepath

    async def _synthesize_edge(self, text: str, config_json: dict, config: Optional[VoiceConfig], overrides: dict = None) -> Optional[str]:
        filename = f"{uuid.uuid4()}.mp3"
        filepath = os.path.join(self.output_dir, filename)
        
        overrides = overrides or {}
        voice = overrides.get("voice") or config_json.get("voice", "zh-CN-XiaoyiNeural")
        rate = overrides.get("rate") or config_json.get("rate", "+25%")
        pitch = overrides.get("pitch") or config_json.get("pitch", "+5Hz")
        
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
            await communicate.save(filepath)
            return filepath
        except Exception as e:
            print(f"Edge TTS Error: {e}")
            return None

    async def _synthesize_openai(self, text: str, config_json: dict, config: VoiceConfig, overrides: dict = None) -> Optional[str]:
        filename = f"{uuid.uuid4()}.mp3"
        filepath = os.path.join(self.output_dir, filename)
        
        overrides = overrides or {}
        # OpenAI API 标准通常不支持直接调整音调，但支持调整语速
        voice = overrides.get("voice") or config_json.get("voice", "alloy")
        
        # 语速处理：Edge 使用 "+15%"，OpenAI 使用 1.15。
        # VoiceManager 传递 "+15%"。如果需要，我们需要进行转换，或者为了安全起见，暂时忽略 OpenAI 的语速覆盖
        # 或者简单的转换：
        speed = 1.0
        try:
            rate_str = overrides.get("rate") or config_json.get("speed", "1.0")
            if isinstance(rate_str, str) and "%" in rate_str:
                # 将 +15% 转换为 1.15
                val = int(rate_str.replace('%', '').replace('+', ''))
                speed = 1.0 + (val / 100.0)
            else:
                speed = float(rate_str)
        except:
            speed = 1.0
        
        try:
            url = f"{config.api_base}/audio/speech" if config.api_base else "https://api.openai.com/v1/audio/speech"
            # 粗略处理可能的双重 /v1 或缺失 /v1 问题，或者直接信任用户输入
            # 通常 openai 兼容的 api_base 是 "https://api.siliconflow.cn/v1"
            # 所以追加 /audio/speech 是标准的。
            
            headers = {
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": config.model or "tts-1",
                "input": text,
                "voice": voice,
                "speed": speed
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    print(f"OpenAI TTS API Error: {response.text}")
                    return None
                
                with open(filepath, "wb") as f:
                    f.write(response.content)
                    
            return filepath
        except Exception as e:
             print(f"OpenAI TTS Error: {e}")
             return None

    def cleanup_old_files(self, max_age_seconds: int = 3600):
        """清理超过一定时间的旧音频文件，默认 1 小时"""
        try:
            import time
            now = time.time()
            if not os.path.exists(self.output_dir):
                return
                
            count = 0
            for filename in os.listdir(self.output_dir):
                filepath = os.path.join(self.output_dir, filename)
                if os.path.isfile(filepath):
                    file_age = now - os.path.getmtime(filepath)
                    if file_age > max_age_seconds:
                        os.remove(filepath)
                        count += 1
            if count > 0:
                print(f"[TTS] Cleaned up {count} old audio files.")
        except Exception as e:
            print(f"[TTS] Periodic Cleanup Error: {e}")

    def cleanup(self, filepath: str):
        """清理特定的音频文件"""
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception as e:
            print(f"Cleanup Error: {e}")

# 单例模式
_tts_service = None

def get_tts_service() -> TTSService:
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
