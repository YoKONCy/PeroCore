import os
import sys

# Try to import PluginManager from backend.core (if running from PeroCore root)
# or from core (if running from backend root)
try:
    from backend.core.plugin_manager import get_plugin_manager
except ImportError:
    try:
        from core.plugin_manager import get_plugin_manager
    except ImportError:
        # Fallback: maybe we are in tools dir? Try adding parent to path?
        # Ideally this shouldn't happen if env is set up right.
        sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
        from core.plugin_manager import get_plugin_manager

# Create and load plugins using the singleton
plugin_manager = get_plugin_manager()
# plugin_manager.load_plugins() # get_plugin_manager already loads them

# Export TOOLS_MAPPING
TOOLS_MAPPING = plugin_manager.get_all_tools_map()
TOOLS_DEFINITIONS = plugin_manager.get_all_definitions()

# Legacy aliases for backward compatibility
if "save_screenshot" in TOOLS_MAPPING and "take_screenshot" not in TOOLS_MAPPING:
    TOOLS_MAPPING["take_screenshot"] = TOOLS_MAPPING["save_screenshot"]

if "get_screenshot_base64" in TOOLS_MAPPING and "see_screen" not in TOOLS_MAPPING:
    TOOLS_MAPPING["see_screen"] = TOOLS_MAPPING["get_screenshot_base64"]

if "browser_type" in TOOLS_MAPPING and "browser_input" not in TOOLS_MAPPING:
    TOOLS_MAPPING["browser_input"] = TOOLS_MAPPING["browser_type"]
