import os
import json
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class NITManager:
    """
    NIT 调度管理层 (Level 2 Control)
    负责两层调度控制：
    1. 第一层：分类开关 (core, work, plugins)
    2. 第二层：具体插件开关 (仅针对 plugins 类别)
    """
    _instance = None

    def __init__(self, config_path="nit_settings.json"):
        if not os.path.isabs(config_path):
             base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
             config_path = os.path.join(base_dir, config_path)
             
        self.config_path = config_path
        self.settings = {
            "categories": {
                "core": True,
                "work": True,
                "plugins": True
            },
            "plugins": {
                "social_adapter": True,
                "AnimeFinder": True,
                "BilibiliFetch": True
            }
        }
        self.load_settings()

    def load_settings(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # 深度合并或更新
                    if "categories" in data:
                        self.settings["categories"].update(data["categories"])
                    if "plugins" in data:
                        self.settings["plugins"].update(data["plugins"])
            except Exception as e:
                logger.error(f"从 {self.config_path} 加载 NIT 设置失败: {e}")
        else:
            self.save_settings()

    def save_settings(self):
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=4)
        except Exception as e:
            logger.error(f"保存 NIT 设置到 {self.config_path} 失败: {e}")

    def is_category_enabled(self, category: str) -> bool:
        """检查分类是否启用 (第一层调度)"""
        return self.settings["categories"].get(category, True)

    def is_plugin_enabled(self, plugin_name: str) -> bool:
        """
        检查具体插件是否启用 (第二层调度)。
        注意：外部调用者通常应先检查 is_category_enabled。
        """
        return self.settings["plugins"].get(plugin_name, True)

    def set_category_status(self, category: str, enabled: bool):
        """设置分类状态"""
        if category in self.settings["categories"]:
            self.settings["categories"][category] = enabled
            self.save_settings()

    def set_plugin_status(self, plugin_name: str, enabled: bool):
        """设置具体插件状态"""
        self.settings["plugins"][plugin_name] = enabled
        self.save_settings()

    def get_all_settings(self) -> Dict[str, Any]:
        """获取所有配置"""
        return self.settings

def get_nit_manager() -> NITManager:
    if NITManager._instance is None:
        NITManager._instance = NITManager()
    return NITManager._instance
