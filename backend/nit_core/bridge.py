import asyncio
import logging
from typing import List, Dict, Any, Callable
from services.mcp_service import McpClient
from .dispatcher import get_dispatcher, NITDispatcher

logger = logging.getLogger(__name__)

class NITBridge:
    """
    NIT <-> MCP 协议桥接器
    负责将 MCP 工具动态注册为 NIT 插件，使其可以通过 NIT 协议调用。
    """
    
    def __init__(self, dispatcher: NITDispatcher = None):
        self.dispatcher = dispatcher or get_dispatcher()
        self.registered_tools = set()

    async def get_mcp_plugins(self, clients: List[McpClient]) -> Dict[str, Callable]:
        """
        获取一组 MCP 客户端的工具，并封装为 NIT 插件字典
        (不修改全局注册表，返回临时字典供 Dispatcher 使用)
        """
        plugins = {}
        
        for client in clients:
            try:
                tools = await client.list_tools()
                for tool in tools:
                    # 获取单个工具的插件映射（可能包含别名）
                    tool_plugins = self._create_tool_adapters(client, tool)
                    plugins.update(tool_plugins)
            except Exception as e:
                logger.error(f"[NIT-Bridge] Failed to fetch tools for client {client.name}: {e}")
                
        return plugins

    def _create_tool_adapters(self, client: McpClient, tool_def: Dict[str, Any]) -> Dict[str, Callable]:
        """
        为单个 MCP 工具创建 NIT 适配器
        返回: {normalized_name: handler_func}
        """
        tool_name = tool_def["name"]
        adapters = {}
        
        # 闭包捕获 client 和 tool_name
        async def mcp_adapter(params: Dict[str, Any]) -> str:
            logger.info(f"[NIT-Bridge] Invoking MCP tool: {tool_name} via {client.name}")
            try:
                # 类型转换
                converted_params = self._convert_params(params, tool_def.get("inputSchema"))
                
                result = await client.call_tool(tool_name, converted_params)
                
                # 格式化结果
                if isinstance(result, (dict, list)):
                    import json
                    return json.dumps(result, ensure_ascii=False)
                return str(result)
                
            except Exception as e:
                return f"Error invoking MCP tool {tool_name}: {e}"

        # 1. 带 mcp_ 前缀
        prefixed_name = f"mcp_{tool_name}"
        norm_prefixed = self.dispatcher.parser.normalize_key(prefixed_name)
        adapters[norm_prefixed] = mcp_adapter
        
        # 2. 原名 (作为别名)
        norm_name = self.dispatcher.parser.normalize_key(tool_name)
        if norm_name not in adapters:
             adapters[norm_name] = mcp_adapter
        
        # logger.debug(f"[NIT-Bridge] Created adapters for: {tool_name} -> {list(adapters.keys())}")
        return adapters

    async def register_clients(self, clients: List[McpClient]):
        """
        [Legacy] 将一组 MCP 客户端的工具注册到 NIT 全局分发器中
        建议改用 get_mcp_plugins + dispatcher.dispatch(extra_plugins=...)
        """
        plugins = await self.get_mcp_plugins(clients)
        from .dispatcher import PLUGIN_REGISTRY
        
        for name, func in plugins.items():
             if name not in PLUGIN_REGISTRY:
                 PLUGIN_REGISTRY[name] = func
                 self.registered_tools.add(name)
                 
    def _register_func(self, name: str, func: Callable):
        pass # Deprecated helper


    def _convert_params(self, params: Dict[str, str], schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        根据 inputSchema 将参数转换为正确的类型
        (当前 NIT Parser 提取的所有参数值都是字符串)
        """
        if not schema or "properties" not in schema:
            return params
            
        converted = {}
        properties = schema["properties"]
        
        for k, v in params.items():
            # 尝试找到对应的 schema 定义
            # NIT key 是归一化的，schema key 可能是原始的
            # 这里简单匹配
            target_key = k # 默认
            target_type = "string"
            
            # 查找匹配的 key (忽略大小写/下划线)
            for schema_key in properties.keys():
                if self.dispatcher.parser.normalize_key(schema_key) == self.dispatcher.parser.normalize_key(k):
                    target_key = schema_key
                    target_type = properties[schema_key].get("type", "string")
                    break
            
            # 类型转换
            try:
                if target_type == "integer":
                    converted[target_key] = int(v)
                elif target_type == "number":
                    converted[target_key] = float(v)
                elif target_type == "boolean":
                    converted[target_key] = v.lower() in ("true", "1", "yes")
                elif target_type == "array" or target_type == "object":
                    import json
                    converted[target_key] = json.loads(v)
                else:
                    converted[target_key] = v
            except:
                # 转换失败则保留原值，让 MCP Server 处理报错
                converted[target_key] = v
                
        return converted
