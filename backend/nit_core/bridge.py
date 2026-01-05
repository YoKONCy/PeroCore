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
        实现了"强力自愈"逻辑：尽可能将不规范的输入修正为符合 Schema 的类型。
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
            
            # 类型转换 (强力自愈模式)
            try:
                # 1. 整数 Integer
                if target_type == "integer":
                    try:
                        # 优先尝试直接转换 "5" -> 5
                        converted[target_key] = int(v)
                    except ValueError:
                        try:
                            # 尝试浮点截断 "5.0" -> 5
                            converted[target_key] = int(float(v))
                        except ValueError:
                            # 无法挽救，保留原值
                            converted[target_key] = v

                # 2. 浮点数 Number
                elif target_type == "number":
                    try:
                        converted[target_key] = float(v)
                    except ValueError:
                        converted[target_key] = v

                # 3. 布尔值 Boolean
                elif target_type == "boolean":
                    if isinstance(v, str):
                        lower_v = v.lower().strip()
                        if lower_v in ("true", "1", "yes", "on", "y"):
                            converted[target_key] = True
                        elif lower_v in ("false", "0", "no", "off", "n"):
                            converted[target_key] = False
                        else:
                            # 无法识别的布尔意图，保留原值
                            converted[target_key] = v
                    else:
                        converted[target_key] = bool(v)

                # 4. 数组 Array
                elif target_type == "array":
                    import json
                    if isinstance(v, str):
                        v = v.strip()
                        try:
                            # 尝试标准 JSON 解析
                            parsed = json.loads(v)
                            if isinstance(parsed, list):
                                converted[target_key] = parsed
                            else:
                                # 解析出来不是列表（比如是数字或对象），强制包装
                                converted[target_key] = [parsed]
                        except json.JSONDecodeError:
                            # JSON 解析失败，尝试其他策略
                            if v.startswith('[') and v.endswith(']'):
                                # 看起来像数组但格式不对（可能是单引号），尝试修复引号
                                try:
                                    fixed_json = v.replace("'", '"')
                                    parsed = json.loads(fixed_json)
                                    if isinstance(parsed, list):
                                        converted[target_key] = parsed
                                    else:
                                        converted[target_key] = [v] # 放弃治疗
                                except:
                                    converted[target_key] = [v] # 放弃治疗
                            elif "," in v:
                                # 尝试逗号分隔 "item1, item2" -> ["item1", "item2"]
                                converted[target_key] = [item.strip() for item in v.split(",") if item.strip()]
                            else:
                                # 既不是JSON也不是逗号分隔，视为单元素数组 "item1" -> ["item1"]
                                converted[target_key] = [v]
                    else:
                        # 已经是其他类型（非字符串），如果不是列表则包装
                        if not isinstance(v, list):
                            converted[target_key] = [v]
                        else:
                            converted[target_key] = v

                # 5. 对象 Object
                elif target_type == "object":
                    import json
                    if isinstance(v, str):
                        v = v.strip()
                        try:
                            converted[target_key] = json.loads(v)
                        except json.JSONDecodeError:
                            # 尝试修复单引号问题 "{'a': 1}" -> '{"a": 1}'
                            try:
                                fixed_json = v.replace("'", '"')
                                converted[target_key] = json.loads(fixed_json)
                            except:
                                # 实在修不好，保留原值
                                converted[target_key] = v
                    else:
                        converted[target_key] = v

                # 6. 字符串 String
                else:
                    # 即使是字符串，也可能需要简单的清洗（比如去除多余引号）
                    if isinstance(v, str):
                         # 如果 LLM 传入了带引号的字符串 '"hello"'，去掉外层引号
                         if len(v) >= 2 and ((v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'"))):
                             converted[target_key] = v[1:-1]
                         else:
                             converted[target_key] = v
                    else:
                        converted[target_key] = str(v)

            except Exception as e:
                # 万一发生未捕获异常，为防止崩溃，保留原值
                logger.warning(f"[NIT-Bridge] Param conversion error for key {k}: {e}")
                converted[target_key] = v
                
        return converted
