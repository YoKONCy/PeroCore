import logging
import asyncio
import os
import sys
from typing import Any
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker

# Import engine directly to create sessions
try:
    from database import engine, get_session
    from models import Config
except ImportError:
    from backend.database import engine, get_session
    from backend.models import Config

logger = logging.getLogger(__name__)

class ConfigManager:
    _instance = None
    
    def __init__(self, config_path=None):
        # 默认配置
        self.config = {
            "napcat_ws_url": "ws://localhost:3001",
            "napcat_http_url": "http://localhost:3000",
            "lightweight_mode": False,
            "aura_vision_enabled": False,
            "enable_social_mode": False,  # 默认关闭以确保安全
            "tts_enabled": True
        }
        
        self.env_loaded_keys = set()
        
        # 从环境变量加载 (覆盖默认值)
        for key in self.config.keys():
            env_key = key.upper()
            env_val = os.environ.get(env_key)
            if env_val is not None:
                self.config[key] = self._parse_value(env_val)
                self.env_loaded_keys.add(key)
                logger.info(f"Loaded config from ENV: {key}={self.config[key]}")

        # 从命令行参数加载 (最高优先级，覆盖环境变量)
        # 支持格式: --key=value (例如 --enable-social-mode=true)
        # 注意: 参数中的键使用连字符而不是下划线 (例如 enable-social-mode)
        for arg in sys.argv:
            if arg.startswith("--"):
                try:
                    # 移除 -- 并按 = 分割
                    clean_arg = arg[2:]
                    if "=" in clean_arg:
                        k, v = clean_arg.split("=", 1)
                    else:
                        # 处理布尔标记，如 --enable-social-mode (隐含 true)
                        k = clean_arg
                        v = "true"
                    
                    # 将连字符转换为下划线以匹配配置键
                    config_key = k.replace("-", "_")
                    
                    if config_key in self.config:
                        self.config[config_key] = self._parse_value(v)
                        self.env_loaded_keys.add(config_key) # 将 CLI 参数视为环境变量级别的覆盖
                        logger.info(f"Loaded config from CLI: {config_key}={self.config[config_key]}")
                        print(f"[ConfigManager] Loaded CLI: {config_key}={self.config[config_key]}")
                except Exception as e:
                    logger.warning(f"Failed to parse CLI argument {arg}: {e}")

        # 注意: 我们不在 __init__ 中从数据库加载，因为它需要 async。
        # 请在应用启动期间调用 await load_from_db()。

    async def load_from_db(self):
        """将配置从数据库加载到内存中。"""
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                statement = select(Config)
                results = await session.exec(statement)
                configs = results.all()
                
                for config in configs:
                    # 如果配置已从 ENV 加载，则不要用数据库值覆盖
                    if config.key in self.env_loaded_keys:
                        logger.info(f"忽略 {config.key} 的数据库配置 (已被 ENV 覆盖)")
                        continue
                    
                    self.config[config.key] = self._parse_value(config.value)
                    
            logger.info(f"配置已从数据库加载。当前配置: {self.config}")
        except Exception as e:
            logger.error(f"无法从数据库加载配置: {e}")

    def _parse_value(self, value_str: str) -> Any:
        """将数据库中的字符串值解析回适当的类型。"""
        if value_str.lower() == "true":
            return True
        if value_str.lower() == "false":
            return False
        try:
            return int(value_str)
        except ValueError:
            pass
        try:
            return float(value_str)
        except ValueError:
            pass
        return value_str

    def get(self, key, default=None):
        return self.config.get(key, default)

    async def set(self, key, value):
        """更新内存和数据库中的配置。"""
        logger.info(f"正在更新配置: {key} = {value}")
        self.config[key] = value
        
        # 转换为字符串以便数据库存储
        str_value = str(value)
        if isinstance(value, bool):
            str_value = str(value).lower()
            
        try:
            async for session in get_session():
                try:
                    statement = select(Config).where(Config.key == key)
                    results = await session.exec(statement)
                    config_entry = results.first()
                    
                    if config_entry:
                        config_entry.value = str_value
                        session.add(config_entry)
                        logger.info(f"更新现有数据库配置项: {key}")
                    else:
                        config_entry = Config(key=key, value=str_value)
                        session.add(config_entry)
                        logger.info(f"创建新数据库配置项: {key}")
                    
                    await session.commit()
                    logger.info(f"配置 {key} 已成功保存到数据库。")
                finally:
                    await session.close()
                break
        except Exception as e:
            logger.error(f"无法保存配置到数据库: {e}")

def get_config_manager():
    if ConfigManager._instance is None:
        ConfigManager._instance = ConfigManager()
    return ConfigManager._instance
