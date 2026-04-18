# type: ignore
import json
import logging
import os
import sys
from typing import Any, Dict, Optional, Set

from sqlalchemy.orm import sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

# 直接导入引擎以创建会话
try:
    from database import engine, get_session
    from models import Config
except ImportError:
    from backend.database import engine, get_session
    from backend.models import Config

logger = logging.getLogger(__name__)


class ConfigManager:
    _instance: Optional["ConfigManager"] = None

    # 易失性配置列表：这些配置仅在内存中维护，不会从数据库加载或保存
    # 通常由环境变量或命令行参数控制
    VOLATILE_CONFIGS = {
        "napcat_ws_url",
        "napcat_http_url",
    }

    def __init__(self, config_path: Optional[str] = None):
        # 默认配置
        self.config: Dict[str, Any] = {
            "napcat_ws_url": "ws://localhost:3001",
            "napcat_http_url": "http://localhost:3000",
            "lightweight_mode": False,
            "aura_vision_enabled": False,
            "enable_social_mode": False,  # 默认关闭以确保安全
            "tts_enabled": True,
            "content_moderation_enabled": False,  # 默认关闭内容审核
            "eula_accepted": False,  # 最终用户许可协议接受状态
            # [Memory] 默认记忆配置 (JSON 结构)
            "memory_config": json.dumps(
                {
                    "summary_batch_size": 10,  # 默认 10 轮对话总结一次
                    "modes": {
                        "desktop": {"context_limit": 20, "rag_limit": 10},
                        "work": {"context_limit": 50, "rag_limit": 15},
                        "social": {
                            "context_limit": 100,
                            "rag_limit": 10,
                            "advanced": {
                                "image_limit": 2,
                                "cross_context_users": 3,
                                "cross_context_history": 10,
                            },
                        },
                    },
                }
            ),
        }

        self.env_loaded_keys: Set[str] = set()

        # 从环境变量加载 (覆盖默认值)
        for key in self.config:
            env_key = key.upper()
            env_val = os.environ.get(env_key)
            if env_val is not None:
                self.config[key] = self._parse_value(env_val)
                self.env_loaded_keys.add(key)
                logger.debug(f"已从环境变量加载配置: {key}={self.config[key]}")

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
                        self.env_loaded_keys.add(
                            config_key
                        )  # 将 CLI 参数视为环境变量级别的覆盖
                        logger.debug(
                            f"已从 CLI 加载配置: {config_key}={self.config[config_key]}"
                        )
                except Exception as e:
                    logger.warning(f"无法解析 CLI 参数 {arg}: {e}")

        # 注意: 我们不在 __init__ 中从数据库加载，因为它需要 async。
        # 请在应用启动期间调用 await load_from_db()。

    async def load_from_db(self):
        """将配置从数据库加载到内存中。"""
        try:
            async_session = sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )  # type: ignore
            async with async_session() as session:  # type: ignore
                statement = select(Config)
                results = await session.exec(statement)
                configs = results.all()

                for config in configs:
                    # 如果配置是易失性的，则跳过
                    if config.key in self.VOLATILE_CONFIGS:
                        continue

                    # 如果配置已从 ENV 加载，则不要用数据库值覆盖
                    if config.key in self.env_loaded_keys:
                        logger.debug(f"忽略 {config.key} 的数据库配置 (已被 ENV 覆盖)")
                        continue

                    self.config[config.key] = self._parse_value(config.value)

            # [Moderation] 同步审核服务开关
            from services.core.moderation_service import moderation_service

            mod_enabled = self.config.get("content_moderation_enabled", False)
            moderation_service.set_enabled(mod_enabled)

            # logger.info(f"配置已从数据库加载。当前配置: {self.config}")
            pass
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

    def get(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)

    def get_json(self, key: str) -> Dict[str, Any]:
        """获取并解析 JSON 配置项"""
        val = self.get(key)
        if isinstance(val, str):
            try:
                return json.loads(val)
            except json.JSONDecodeError:
                logger.warning(f"配置项 {key} 不是有效的 JSON: {val}")
                return {}
        if isinstance(val, dict):
            return val
        return {}

    async def set(self, key: str, value: Any):
        """更新内存和数据库中的配置。"""
        logger.info(f"正在更新配置: {key} = {value}")
        self.config[key] = value

        # 如果是易失性配置，则不保存到数据库
        if key in self.VOLATILE_CONFIGS:
            logger.debug(f"跳过保存易失性配置: {key}")
            return

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
