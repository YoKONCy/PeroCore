import os
import json
import importlib
import sys
import logging
from typing import Dict, Any, List, Optional, Callable
from core.config_manager import get_config_manager

# Configure logging
logger = logging.getLogger(__name__)

class PluginManager:
    """
    Manages the discovery, loading, and registration of plugins in PeroCore.
    """

    def __init__(self, plugin_dir: str):
        """
        Initialize the PluginManager.
        
        Args:
            plugin_dir: Absolute path to the directory containing plugins.
        """
        self.plugin_dir = plugin_dir
        self.plugins: Dict[str, Dict[str, Any]] = {}  # Map plugin name to manifest
        self.tools_map: Dict[str, Callable] = {}      # Map command identifier to function
        self.loaded_modules: Dict[str, Any] = {}      # Map plugin name to loaded module
        self.config_manager = get_config_manager()

    def load_plugins(self):
        """
        Scans the plugin directory and loads all valid plugins.
        Supports nested structure: core, work, plugins (extensions).
        """
        logger.info(f"Scanning for plugins in {self.plugin_dir}...")
        
        if not os.path.exists(self.plugin_dir):
            logger.error(f"Plugin directory {self.plugin_dir} does not exist.")
            return

        # Define sub-categories to scan
        categories = ['core', 'work', '../plugins'] # relative to tools dir
        
        # Scan root (legacy compatibility)
        self._scan_directory(self.plugin_dir)

        # Scan categories
        for category in categories:
            cat_path = os.path.normpath(os.path.join(self.plugin_dir, category))
            if os.path.exists(cat_path) and os.path.isdir(cat_path):
                logger.info(f"Scanning category: {category}")
                self._scan_directory(cat_path, category_prefix=category)

        logger.info(f"Plugin loading complete. Loaded {len(self.plugins)} plugins and {len(self.tools_map)} commands.")

    def reload_plugins(self):
        """
        Clears existing plugins and tools, then reloads from directory.
        """
        logger.info("Reloading all plugins...")
        self.plugins.clear()
        self.tools_map.clear()
        self.loaded_modules.clear()
        self.load_plugins()

    def _scan_directory(self, directory: str, category_prefix: str = None):
        """Helper to scan a specific directory for plugins."""
        for item in os.listdir(directory):
            item_path = os.path.join(directory, item)
            if os.path.isdir(item_path):
                self._load_single_plugin(item_path, item, category_prefix)

    def _load_single_plugin(self, plugin_path: str, plugin_folder_name: str, category_prefix: str = None):
        """
        Loads a single plugin from a directory.
        """
        manifest_path = os.path.join(plugin_path, "description.json")
        if not os.path.exists(manifest_path):
            return

        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception as e:
            logger.error(f"Failed to parse manifest for {plugin_folder_name}: {e}")
            return

        # Basic Validation
        if "name" not in manifest or "entryPoint" not in manifest:
            logger.error(f"Invalid manifest for {plugin_folder_name}: Missing name or entryPoint.")
            return

        plugin_name = manifest["name"]

        # [Security] Check Social Mode Toggle
        if plugin_name == "social_adapter":
            if not self.config_manager.get("enable_social_mode", False):
                logger.info(f"Skipping plugin '{plugin_name}' because enable_social_mode is False.")
                return

        # Inject category info into manifest for Dispatcher filtering
        if category_prefix:
            # Handle ../plugins case -> plugins
            clean_category = os.path.basename(category_prefix) if '..' in category_prefix else category_prefix
            manifest['_category'] = clean_category

        plugin_type = manifest.get("pluginType", "python-module")

        if plugin_type == "python-module":
            self._load_python_module_plugin(plugin_path, plugin_folder_name, manifest, category_prefix)
        elif plugin_type == "static":
            logger.warning(f"Static plugin type not yet fully supported for {plugin_name}, skipping execution logic.")
        else:
            logger.warning(f"Unknown plugin type '{plugin_type}' for {plugin_name}.")

        self.plugins[plugin_name] = manifest

    def _load_python_module_plugin(self, plugin_path: str, plugin_folder_name: str, manifest: Dict[str, Any], category_prefix: str = None):
        """
        Loads a python-module type plugin.
        """
        entry_point = manifest["entryPoint"]
        module_file = entry_point
        if module_file.endswith(".py"):
            module_name = module_file[:-3]
        else:
            module_name = module_file

        # Construct import path
        # Try dynamic path construction based on category
        import_paths_to_try = []
        
        if category_prefix:
            # Normalize path separators for import
            # e.g. "core" -> "backend.nit_core.tools.core"
            # e.g. "../plugins" -> "backend.nit_core.plugins"
            
            if "plugins" in category_prefix:
                 import_paths_to_try.append(f"backend.nit_core.plugins.{plugin_folder_name}.{module_name}")
                 import_paths_to_try.append(f"nit_core.plugins.{plugin_folder_name}.{module_name}")
            else:
                 import_paths_to_try.append(f"backend.nit_core.tools.{category_prefix}.{plugin_folder_name}.{module_name}")
                 import_paths_to_try.append(f"nit_core.tools.{category_prefix}.{plugin_folder_name}.{module_name}")
        
        # Legacy fallbacks
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
             # Last ditch effort: sys.path hack (not recommended but robust for moving files)
             try:
                 spec = importlib.util.spec_from_file_location(module_name, os.path.join(plugin_path, module_file))
                 if spec and spec.loader:
                     module = importlib.util.module_from_spec(spec)
                     spec.loader.exec_module(module)
             except Exception as e:
                 logger.error(f"Failed to load module {module_name} from {plugin_path}: {e}")
                 return

        # Register functions
        if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
            for cmd in manifest["capabilities"]["invocationCommands"]:
                cmd_id = cmd["commandIdentifier"]
                # Try to find function in module
                # Convention: function name same as commandIdentifier
                if hasattr(module, cmd_id):
                    self.tools_map[cmd_id] = getattr(module, cmd_id)
                else:
                    # Fallback: maybe the module has a main entry point?
                    # For now, just warn
                    logger.warning(f"Function '{cmd_id}' not found in module '{module_name}' for plugin '{manifest['name']}'.")

        self.loaded_modules[manifest['name']] = module

    def list_plugins(self) -> List[str]:
        """
        List all discovered plugin names.
        """
        return list(self.plugins.keys())

    def get_tool(self, command_identifier: str) -> Optional[Callable]:
        """
        Get the callable function for a given command identifier.
        """
        return self.tools_map.get(command_identifier)

    def get_all_tools_map(self) -> Dict[str, Callable]:
        """
        Get the full map of command identifiers to functions.
        """
        return self.tools_map

    def get_all_definitions(self) -> List[Dict[str, Any]]:
        definitions = []
        for plugin_name, manifest in self.plugins.items():
            # Check for invocationCommands (standard in our NIT format)
            if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
                definitions.extend(manifest["capabilities"]["invocationCommands"])
            elif "capabilities" in manifest and "toolDefinitions" in manifest["capabilities"]:
                definitions.extend(manifest["capabilities"]["toolDefinitions"])
        return definitions
    
    def get_all_manifests(self) -> List[Dict[str, Any]]:
        """
        Get all loaded plugin manifests.
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

