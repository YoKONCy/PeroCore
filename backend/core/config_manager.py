import json
import os
import logging

logger = logging.getLogger(__name__)

class ConfigManager:
    _instance = None
    
    def __init__(self, config_path=None):
        # 优先级：环境变量 > 传入参数 > 默认路径
        if not config_path:
            config_path = os.environ.get("PERO_CONFIG_PATH", "config.json")

        # If path is relative, make it relative to backend root
        if not os.path.isabs(config_path):
             base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
             config_path = os.path.join(base_dir, config_path)
             
        self.config_path = config_path
        self.config = {
            "napcat_ws_url": "ws://localhost:3001",
            "napcat_http_url": "http://localhost:3000",
            "lightweight_mode": False,
            "aura_vision_enabled": False
        }
        self.load_config()

    def load_config(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.config.update(data)
            except Exception as e:
                logger.error(f"Failed to load config from {self.config_path}: {e}")
        else:
            self.save_config()

    def save_config(self):
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4)
        except Exception as e:
            logger.error(f"Failed to save config to {self.config_path}: {e}")

    def get(self, key, default=None):
        return self.config.get(key, default)

    def set(self, key, value):
        self.config[key] = value
        self.save_config()

def get_config_manager():
    if ConfigManager._instance is None:
        ConfigManager._instance = ConfigManager()
    return ConfigManager._instance
