import os
import json
import importlib
import sys
import logging
import platform
from typing import Dict, Any, List, Optional, Callable
from core.config_manager import get_config_manager
from core.nit_manager import get_nit_manager

# Configure logging
logger = logging.getLogger(__name__)

class PluginManager:
    """
    负责 PeroCore 中插件的发现、加载和注册管理。
    """

    def __init__(self, plugin_dir: str):
        """
        初始化插件管理器。
        
        Args:
            plugin_dir: 包含插件的绝对路径目录。
        """
        self.plugin_dir = plugin_dir
        self.plugins: Dict[str, Dict[str, Any]] = {}  # 插件名 -> 清单(Manifest)
        self.tools_map: Dict[str, Callable] = {}      # 命令ID -> 可执行函数
        self.loaded_modules: Dict[str, Any] = {}      # 插件名 -> 已加载模块对象
        self.config_manager = get_config_manager()
        self.nit_manager = get_nit_manager()

    def load_plugins(self):
        """
        扫描插件目录并加载所有有效插件。
        支持嵌套结构：core (核心), work (工作), plugins (扩展)。
        """
        logger.info(f"正在 {self.plugin_dir} 中扫描插件...")
        
        if not os.path.exists(self.plugin_dir):
            logger.error(f"插件目录 {self.plugin_dir} 不存在。")
            return

        # 定义需要扫描的子分类
        categories = ['core', 'work', '../plugins'] # 相对于 tools 目录
        
        # 扫描根目录 (兼容旧版本)
        self._scan_directory(self.plugin_dir)

        # 扫描分类目录
        for category in categories:
            cat_path = os.path.normpath(os.path.join(self.plugin_dir, category))
            if os.path.exists(cat_path) and os.path.isdir(cat_path):
                logger.info(f"正在扫描类别: {category}")
                self._scan_directory(cat_path, category_prefix=category)

        logger.info(f"插件加载完成。已加载 {len(self.plugins)} 个插件和 {len(self.tools_map)} 个命令。")

    def reload_plugins(self):
        """
        清除现有插件和工具，并从目录重新加载。
        """
        logger.info("正在重新加载所有插件...")
        self.plugins.clear()
        self.tools_map.clear()
        self.loaded_modules.clear()
        self.load_plugins()

    def _scan_directory(self, directory: str, category_prefix: str = None):
        """扫描特定目录下的插件 (Helper)。"""
        for item in os.listdir(directory):
            item_path = os.path.join(directory, item)
            if os.path.isdir(item_path):
                self._load_single_plugin(item_path, item, category_prefix)

    def _load_single_plugin(self, plugin_path: str, plugin_folder_name: str, category_prefix: str = None):
        """
        从目录加载单个插件。
        """
        manifest_path = os.path.join(plugin_path, "description.json")
        if not os.path.exists(manifest_path):
            return

        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception as e:
            logger.error(f"解析 {plugin_folder_name} 的清单失败: {e}")
            return

        # 基础校验
        if "name" not in manifest or "entryPoint" not in manifest:
            logger.error(f" {plugin_folder_name} 的清单无效: 缺少 name 或 entryPoint。")
            return

        plugin_name = manifest["name"]

        # 注入分类信息以便 Dispatcher 过滤
        if category_prefix:
            # 处理 ../plugins 路径 -> plugins
            clean_category = os.path.basename(category_prefix) if '..' in category_prefix else category_prefix
            manifest['_category'] = clean_category

        # 平台兼容性检查
        supported_platforms = manifest.get("platforms")
        if supported_platforms:
            current_platform = platform.system().lower()
            # Server Mode 模拟 Linux 环境 -> 改为 'server' 以区分 Linux Desktop
            if os.environ.get("PERO_ENV") == "server":
                current_platform = "server"
                
            if current_platform not in [p.lower() for p in supported_platforms]:
                logger.info(f"跳过插件 {plugin_name}: 当前平台 ({current_platform}) 不在支持列表 {supported_platforms} 中。")
                return

        plugin_type = manifest.get("pluginType", "python-module")

        if plugin_type == "python-module":
            self._load_python_module_plugin(plugin_path, plugin_folder_name, manifest, category_prefix)
        elif plugin_type == "static":
            logger.warning(f"尚不完全支持 {plugin_name} 的静态插件类型，跳过执行逻辑。")
        else:
            logger.warning(f"{plugin_name} 的插件类型 '{plugin_type}' 未知。")

        self.plugins[plugin_name] = manifest

    def _load_python_module_plugin(self, plugin_path: str, plugin_folder_name: str, manifest: Dict[str, Any], category_prefix: str = None):
        """
        加载 python-module 类型的插件。
        """
        entry_point = manifest["entryPoint"]
        module_file = entry_point
        if module_file.endswith(".py"):
            module_name = module_file[:-3]
        else:
            module_name = module_file

        # 构建导入路径
        # 尝试基于分类的动态路径构建
        import_paths_to_try = []
        
        if category_prefix:
            # 规范化导入路径的分隔符
            # 例如 "core" -> "backend.nit_core.tools.core"
            # 例如 "../plugins" -> "backend.nit_core.plugins"
            
            if "plugins" in category_prefix:
                 import_paths_to_try.append(f"backend.nit_core.plugins.{plugin_folder_name}.{module_name}")
                 import_paths_to_try.append(f"nit_core.plugins.{plugin_folder_name}.{module_name}")
            else:
                 import_paths_to_try.append(f"backend.nit_core.tools.{category_prefix}.{plugin_folder_name}.{module_name}")
                 import_paths_to_try.append(f"nit_core.tools.{category_prefix}.{plugin_folder_name}.{module_name}")
        
        # 旧版兼容路径
        import_paths_to_try.append(f"backend.nit_core.tools.{plugin_folder_name}.{module_name}")
        import_paths_to_try.append(f"nit_core.tools.{plugin_folder_name}.{module_name}")

        module = None
        for path in import_paths_to_try:
            try:
                module = importlib.import_module(path)
                break
            except ImportError:
                continue
        
        if not module:
             # 最后的尝试: sys.path hack (不推荐，但对文件移动具有鲁棒性)
             try:
                 spec = importlib.util.spec_from_file_location(module_name, os.path.join(plugin_path, module_file))
                 if spec and spec.loader:
                     module = importlib.util.module_from_spec(spec)
                     spec.loader.exec_module(module)
             except Exception as e:
                 logger.error(f"从 {plugin_path} 加载模块 {module_name} 失败: {e}")
                 return

        # 注册功能函数
        if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
            for cmd in manifest["capabilities"]["invocationCommands"]:
                cmd_id = cmd["commandIdentifier"]
                # 尝试在模块中查找函数
                # 约定: 函数名与 commandIdentifier 相同
                if hasattr(module, cmd_id):
                    self.tools_map[cmd_id] = getattr(module, cmd_id)
                else:
                    # 回退策略: 也许模块有一个主入口点?
                    # 目前仅记录警告
                    logger.warning(f"在插件 '{manifest['name']}' 的模块 '{module_name}' 中未找到函数 '{cmd_id}'。")

        self.loaded_modules[manifest['name']] = module

    def list_plugins(self) -> List[str]:
        """
        列出所有已发现的插件名称。
        """
        return list(self.plugins.keys())

    def get_tool(self, command_identifier: str) -> Optional[Callable]:
        """
        获取指定命令 ID 对应的可调用函数。
        """
        return self.tools_map.get(command_identifier)

    def get_all_tools_map(self) -> Dict[str, Callable]:
        """
        获取完整的命令 ID 到函数的映射。
        """
        return self.tools_map

    def get_all_definitions(self) -> List[Dict[str, Any]]:
        definitions = []
        for plugin_name, manifest in self.plugins.items():
            # 检查 invocationCommands (NIT 格式标准)
            if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
                definitions.extend(manifest["capabilities"]["invocationCommands"])
            elif "capabilities" in manifest and "toolDefinitions" in manifest["capabilities"]:
                definitions.extend(manifest["capabilities"]["toolDefinitions"])
        return definitions
    
    def get_all_manifests(self) -> List[Dict[str, Any]]:
        """
        获取所有已加载的插件清单。
        """
        return list(self.plugins.values())

_instance = None

def get_plugin_manager() -> PluginManager:
    global _instance
    if _instance is None:
        # backend/core/plugin_manager.py -> backend/
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        # Target: backend/nit_core/tools
        plugin_dir = os.path.join(base_dir, "nit_core", "tools")
        _instance = PluginManager(plugin_dir)
        _instance.load_plugins()
    return _instance

# Global instance for easier access
plugin_manager = get_plugin_manager()

