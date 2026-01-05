import hashlib
import hmac
import time
import secrets
from typing import Optional, Tuple
import logging

logger = logging.getLogger("pero.nit.security")

class NITSecurityManager:
    """
    NIT 协议安全管理器
    负责生成和验证会话级动态握手 ID (NIT-ID)
    """
    
    # 系统级盐值，用于增加破解难度
    _SYSTEM_SALT = "PERO_CORE_NIT_PROTOCOL_V2_SALT_2026"
    
    @classmethod
    def generate_random_id(cls) -> str:
        """生成一个随机的 4 位十六进制 ID (用于当前请求上下文)"""
        return secrets.token_hex(2).upper()

    @classmethod
    def _derive_session_secret(cls, session_id: str) -> bytes:
        """从 Session ID 派生会话密钥"""
        return hmac.new(
            cls._SYSTEM_SALT.encode(),
            session_id.encode(),
            hashlib.sha256
        ).digest()

    @classmethod
    def generate_id(cls, session_id: str, turn_index: int) -> str:
        """
        生成指定轮次的 NIT-ID (HMAC 模式)
        格式: 4位十六进制 (e.g. "A9B2")
        """
        secret = cls._derive_session_secret(session_id)
        # 将轮次作为消息
        msg = str(turn_index).encode()
        
        # 计算 HMAC
        h = hmac.new(secret, msg, hashlib.sha256)
        
        # 取前 4 位 Hex
        return h.hexdigest()[:4].upper()

    @classmethod
    def validate_id(cls, input_id: str, expected_id: str) -> Tuple[bool, str]:
        """
        验证 NIT-ID 是否有效
        
        Returns:
            (is_valid, status_msg)
            status_msg: "valid", "invalid", "missing"
        """
        if not input_id:
            return False, "missing"
            
        input_id = input_id.upper().strip()
        expected_id = expected_id.upper().strip()
        
        if input_id == expected_id:
            return True, "valid"
            
        return False, "invalid"

    @classmethod
    def get_injection_prompt(cls, nit_id: str) -> str:
        """生成注入到 System Prompt 的安全提示"""
        return f"""
[NIT SECURITY PROTOCOL]
Current Session ID: {nit_id}
IMPORTANT: For this turn, you MUST wrap all NIT scripts in <nit-{nit_id}>...</nit-{nit_id}> tags.
Legacy NIT 1.0 format ([[[NIT_CALL]]]) and standard <nit> tags are currently DISABLED.
"""
