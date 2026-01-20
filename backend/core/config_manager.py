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
        # Default configuration
        self.config = {
            "napcat_ws_url": "ws://localhost:3001",
            "napcat_http_url": "http://localhost:3000",
            "lightweight_mode": False,
            "aura_vision_enabled": False,
            "enable_social_mode": False,  # Default to False for safety
            "tts_enabled": True
        }
        
        self.env_loaded_keys = set()
        
        # Load from Environment Variables (Override defaults)
        for key in self.config.keys():
            env_key = key.upper()
            env_val = os.environ.get(env_key)
            if env_val is not None:
                self.config[key] = self._parse_value(env_val)
                self.env_loaded_keys.add(key)
                logger.info(f"Loaded config from ENV: {key}={self.config[key]}")

        # Load from Command Line Arguments (Highest Priority, overrides ENV)
        # Supports format: --key=value (e.g., --enable-social-mode=true)
        # Note: keys in args use dashes instead of underscores (e.g., enable-social-mode)
        for arg in sys.argv:
            if arg.startswith("--"):
                try:
                    # Remove -- and split by =
                    clean_arg = arg[2:]
                    if "=" in clean_arg:
                        k, v = clean_arg.split("=", 1)
                    else:
                        # Handle boolean flags like --enable-social-mode (implies true)
                        k = clean_arg
                        v = "true"
                    
                    # Convert dashes to underscores to match config keys
                    config_key = k.replace("-", "_")
                    
                    if config_key in self.config:
                        self.config[config_key] = self._parse_value(v)
                        self.env_loaded_keys.add(config_key) # Treat CLI args as ENV-level overrides
                        logger.info(f"Loaded config from CLI: {config_key}={self.config[config_key]}")
                        print(f"[ConfigManager] Loaded CLI: {config_key}={self.config[config_key]}")
                except Exception as e:
                    logger.warning(f"Failed to parse CLI argument {arg}: {e}")

        # Note: We do not load from DB in __init__ because it requires async.
        # Call await load_from_db() during app startup.

    async def load_from_db(self):
        """Loads configuration from the database into memory."""
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                statement = select(Config)
                results = await session.exec(statement)
                configs = results.all()
                
                for config in configs:
                    # If config was loaded from ENV, do not overwrite with DB value
                    if config.key in self.env_loaded_keys:
                        logger.info(f"Ignoring DB config for {config.key} (overridden by ENV)")
                        continue
                    
                    self.config[config.key] = self._parse_value(config.value)
                    
            logger.info(f"配置已从数据库加载。当前配置: {self.config}")
        except Exception as e:
            logger.error(f"无法从数据库加载配置: {e}")

    def _parse_value(self, value_str: str) -> Any:
        """Parses string value from DB back to appropriate type."""
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
        """Updates config in memory and database."""
        logger.info(f"正在更新配置: {key} = {value}")
        self.config[key] = value
        
        # Convert to string for DB storage
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
