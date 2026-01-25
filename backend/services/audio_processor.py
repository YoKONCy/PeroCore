import os
import parselmouth
from parselmouth.praat import call
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class AudioProcessor:
    """
    音频后处理服务，用于调整音高、共振峰等，使声音更可爱。
    """
    
    @staticmethod
    async def process_voice_cute(input_path: str, output_path: str, 
                                pitch_factor: float = 1.2, 
                                formant_factor: float = 1.1) -> bool:
        """
        通过调整音高和共振峰使声音变可爱。
        
        Args:
            input_path: 输入文件路径 (mp3/wav)
            output_path: 输出文件路径 (wav/mp3)
            pitch_factor: 音高乘数，建议 1.1 - 1.3
            formant_factor: 共振峰乘数，建议 1.05 - 1.2 (使喉管听起来更小)
        """
        try:
            if not os.path.exists(input_path):
                logger.error(f"未找到输入文件: {input_path}")
                return False
                
            # 加载声音
            sound = parselmouth.Sound(input_path)
            
            # 使用 Praat "Change gender" 算法调整音高和共振峰。
            # 参数说明：75.0-600.0 为共振峰范围，后序参数依次为：共振峰偏移、音高偏移、音高范围比(1.0)、时长比(1.0)。
            
            new_sound = call(sound, "Change gender", 75.0, 600.0, 
                            formant_factor, pitch_factor, 1.0, 1.0)
            
            # 保存结果
            # 如果输出是 mp3，parselmouth 不直接支持，先存为 wav
            if output_path.lower().endswith(".mp3"):
                temp_wav = output_path.replace(".mp3", "_temp.wav")
                new_sound.save(temp_wav, "WAV")
                
                # 使用 ffmpeg 转换 (如果安装了 pydub，可以间接使用)
                try:
                    from pydub import AudioSegment
                    audio = AudioSegment.from_wav(temp_wav)
                    audio.export(output_path, format="mp3")
                    if os.path.exists(temp_wav):
                        os.remove(temp_wav)
                except ImportError:
                    logger.warning("未安装 pydub，保留 wav 格式作为后备")
                    # 如果没有 pydub，只能改名存为 wav 或报错
                    new_sound.save(output_path, "WAV")
            else:
                new_sound.save(output_path, "WAV")
                
            return True
            
        except Exception as e:
            logger.error(f"处理音频出错: {e}")
            return False

# 单例实例
audio_processor = AudioProcessor()
