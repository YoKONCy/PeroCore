"""
[关于为什么不使用标准 Function Calling 的架构决策说明]

1. 异步并发支持的稀缺性：
   "Function Calling 调个 API 就行了，谁不会写？" —— 但问题在于，目前市面上（尤其是国内大模型生态中）
   能够原生且稳定支持异步 Function Calling 的模型屈指可数。
   对于 PeroCore 这样追求高并发、低延迟响应的系统而言，依赖同步阻塞的 API 并不是可行的方案。

2. NIT 协议的工程价值：
   NIT (Non-invasive Integration Tools) 协议并非为了“重复造轮子”，而是在深入权衡了兼容性、安全性与可维护性后的最优工程解之一。
   它天然支持基于事件驱动的异步并发执行，解耦了具体的模型实现与业务逻辑。
   这不仅是一种协议，更是针对具体应用场景（高频交互、复杂意图编排）量身定制的解决方案。
"""

import asyncio
import importlib
import sys
import os
import time
import logging
import json
from datetime import datetime
from typing import Dict, Any, List, Callable
from .interpreter import execute_nit_script
from .security import NITSecurityManager
from core.plugin_manager import get_plugin_manager
from core.nit_manager import get_nit_manager
from core.config_manager import get_config_manager
import re

# 插件注册表：PluginName -> Handler Function
PLUGIN_REGISTRY = {}

logger = logging.getLogger("pero.nit")

def normalize_nit_key(key: str) -> str:
    """归一化插件名/参数名"""
    return key.lower().replace('_', '').replace('-', '')

def remove_nit_tags(text: str) -> str:
    """移除文本中所有的 NIT 调用块 (1.0 和 2.0)"""
    # 移除 NIT 1.0: [[[NIT_CALL]]] ... [[[NIT_END]]]
    text = re.sub(r'\[\[\[NIT_CALL\]\]\].*?\[\[\[NIT_END\]\]\]', '', text, flags=re.DOTALL)
    # 移除 NIT 2.0: <nit-XXXX> ... </nit-XXXX> 或 <nit> ... </nit>
    text = re.sub(r'<(nit(?:-[0-9a-fA-F]{4})?)>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    return text.strip()

class NITStreamFilter:
    """
    NIT 流式过滤器
    用于在流式输出过程中拦截并隐藏 NIT 调用块 (1.0 和 2.0)
    """
    def __init__(self):
        self.buffer = ""
        self.in_nit_block = False
        
        # NIT 1.0 Markers
        self.m1_start = "[[[NIT_CALL]]]"
        self.m1_end = "[[[NIT_END]]]"
        
        # NIT 2.0 Regex (used for state detection)
        # Since streaming is chunk-by-chunk, we use a simple state machine for the tags
        self.tag_pattern = re.compile(r'<(nit(?:-[0-9a-fA-F]{4})?)>', re.IGNORECASE)
        self.end_tag_pattern = re.compile(r'</(nit(?:-[0-9a-fA-F]{4})?)>', re.IGNORECASE)

    def filter(self, chunk: str) -> str:
        self.buffer += chunk
        output = ""

        while self.buffer:
            if not self.in_nit_block:
                # Look for NIT 1.0 or NIT 2.0 start
                idx1 = self.buffer.find(self.m1_start)
                
                # Check for NIT 2.0 start tag
                match2 = self.tag_pattern.search(self.buffer)
                idx2 = match2.start() if match2 else -1
                
                # Find the earliest start
                starts = [i for i in [idx1, idx2] if i != -1]
                if not starts:
                    # No start marker found, but we might have a partial marker at the end
                    # We keep a small buffer to avoid splitting markers
                    safe_len = len(self.buffer) - len(self.m1_start) - 10 
                    if safe_len > 0:
                        output += self.buffer[:safe_len]
                        self.buffer = self.buffer[safe_len:]
                    return output
                
                first_start = min(starts)
                # Output everything before the marker
                output += self.buffer[:first_start]
                self.buffer = self.buffer[first_start:]
                self.in_nit_block = True
            else:
                # Look for NIT 1.0 or NIT 2.0 end
                idx1_end = self.buffer.find(self.m1_end)
                
                # Check for NIT 2.0 end tag
                match2_end = self.end_tag_pattern.search(self.buffer)
                idx2_end = match2_end.end() if match2_end else -1
                
                if idx1_end != -1 and (idx2_end == -1 or idx1_end < idx2_end):
                    # NIT 1.0 end found
                    self.buffer = self.buffer[idx1_end + len(self.m1_end):]
                    self.in_nit_block = False
                elif idx2_end != -1:
                    # NIT 2.0 end found
                    self.buffer = self.buffer[idx2_end:]
                    self.in_nit_block = False
                else:
                    # No end marker found yet
                    return output
        
        return output

    def flush(self) -> str:
        """Clear buffer at the end"""
        res = ""
        if not self.in_nit_block:
            res = self.buffer
        self.buffer = ""
        return res

class XMLStreamFilter:
    """
    通用 XML 标签流式过滤器
    用于隐藏特定的 XML 标签及其内容 (如 <PEROCUE>)
    """
    def __init__(self, tag_names: List[str] = None):
        if tag_names is None:
            tag_names = ["PEROCUE", "CHARACTER_STATUS"]
        self.tag_names = [t.upper() for t in tag_names]
        self.buffer = ""
        self.in_block = False
        self.current_end_tag = ""

    def filter(self, chunk: str) -> str:
        self.buffer += chunk
        output = ""

        while self.buffer:
            if not self.in_block:
                # Look for any start tag
                found_tag = None
                found_idx = -1
                for tag in self.tag_names:
                    idx = self.buffer.upper().find(f"<{tag}>")
                    if idx != -1 and (found_idx == -1 or idx < found_idx):
                        found_idx = idx
                        found_tag = tag
                
                if found_idx == -1:
                    # No start tag, safe to output most of it
                    safe_len = max(0, len(self.buffer) - 20)
                    output += self.buffer[:safe_len]
                    self.buffer = self.buffer[safe_len:]
                    return output
                
                output += self.buffer[:found_idx]
                self.buffer = self.buffer[found_idx:]
                self.in_block = True
                self.current_end_tag = f"</{found_tag}>".upper()
            else:
                idx = self.buffer.upper().find(self.current_end_tag)
                if idx != -1:
                    self.buffer = self.buffer[idx + len(self.current_end_tag):]
                    self.in_block = False
                    self.current_end_tag = ""
                else:
                    return output
        return output

    def flush(self) -> str:
        res = ""
        if not self.in_block:
            res = self.buffer
        self.buffer = ""
        return res

class ThinkingBlockStreamFilter:
    """
    思考块流式过滤器
    用于在流式输出过程中拦截并隐藏 Thinking/Monologue 块
    支持 【Thinking...】, [Thinking...], (Thinking...) 等格式
    """
    def __init__(self, tag_names: List[str] = None):
        if tag_names is None:
            # 这些是我们要过滤的标签关键词
            self.tag_names = ["Thinking", "Monologue"]
        
        # 预编译正则，用于快速检测起始标记
        # 匹配 【Thinking, [Thinking, (Thinking
        # 使用 re.IGNORECASE
        pattern_str = r'(?:【|\[|\()(?:' + '|'.join(self.tag_names) + r')'
        self.start_pattern = re.compile(pattern_str, re.IGNORECASE)
        
        self.buffer = ""
        self.in_block = False
        self.current_closer = "" # 当前块对应的结束符号

    def filter(self, chunk: str) -> str:
        self.buffer += chunk
        output = ""

        while self.buffer:
            if not self.in_block:
                # 查找起始标记
                match = self.start_pattern.search(self.buffer)
                if not match:
                    # 没有找到起始标记，输出缓冲区的大部分（保留末尾一小段以防标记被截断）
                    # 最长可能的标记是 【Thinking (9 chars)
                    safe_len = max(0, len(self.buffer) - 15)
                    output += self.buffer[:safe_len]
                    self.buffer = self.buffer[safe_len:]
                    return output
                
                # 找到起始标记
                start_idx = match.start()
                
                # 确定结束符号
                opener = match.group(0)[0] # '【', '[', '('
                if opener == '【':
                    self.current_closer = '】'
                elif opener == '[':
                    self.current_closer = ']'
                elif opener == '(':
                    self.current_closer = ')'
                else:
                    self.current_closer = '】' # Default fallback
                
                # 输出起始标记之前的内容
                output += self.buffer[:start_idx]
                self.buffer = self.buffer[start_idx:]
                self.in_block = True
            
            else:
                # 正在块内，寻找结束符号
                closer_idx = self.buffer.find(self.current_closer)
                if closer_idx != -1:
                    # 找到结束符号，丢弃块内容
                    self.buffer = self.buffer[closer_idx + len(self.current_closer):]
                    self.in_block = False
                    self.current_closer = ""
                else:
                    # 还没结束，保留缓冲区继续等待
                    return output
        
        return output

    def flush(self) -> str:
        res = ""
        if not self.in_block:
            res = self.buffer
        self.buffer = ""
        return res

class NITDispatcher:
    """
    NIT 核心调度器
    负责接收文本流，解析指令，分发任务
    """
    
    def __init__(self):
        self.pm = get_plugin_manager()
        self.nm = get_nit_manager()
        self.category_map = {} # Map[norm_plugin_name] -> List[tool_names]
        self.tool_to_manifest = {} # Map[norm_tool_name] -> Manifest
        # 初始化时加载工具
        self._load_tools()
        self._register_browser_bridge()
    
    def _load_tools(self):
        """从 PluginManager 加载所有工具"""
        try:
            # 1. Register standard tool names
            tools = self.pm.get_all_tools_map()
            
            # 2. Register PluginName.ToolName aliases for namespaced calls
            manifests = self.pm.get_all_manifests()
            for manifest in manifests:
                plugin_name = manifest.get("name")
                if not plugin_name:
                    continue
                
                # Register to category map
                norm_plugin_name = normalize_nit_key(plugin_name)
                if norm_plugin_name not in self.category_map:
                    self.category_map[norm_plugin_name] = []
                
                commands = []
                if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
                    commands = manifest["capabilities"]["invocationCommands"]
                elif "capabilities" in manifest and "toolDefinitions" in manifest["capabilities"]:
                    commands = manifest["capabilities"]["toolDefinitions"]
                
                for cmd in commands:
                    cmd_id = cmd.get("commandIdentifier")
                    if cmd_id and cmd_id in tools:
                        # Map tool to manifest
                        norm_tool_name = normalize_nit_key(cmd_id)
                        self.tool_to_manifest[norm_tool_name] = manifest
                        
                        # Add to category map
                        self.category_map[norm_plugin_name].append(cmd_id)
                        
                        # Register standard name
                        self._register_tool(cmd_id, tools[cmd_id])
                        
                        # Register "PluginName.ToolName"
                        namespaced_name = f"{plugin_name}.{cmd_id}"
                        self._register_tool(namespaced_name, tools[cmd_id])
                        # Also map namespaced name to manifest
                        self.tool_to_manifest[normalize_nit_key(namespaced_name)] = manifest
                        
            logger.info(f"已加载工具。总数: {len(PLUGIN_REGISTRY)}")
                
        except Exception as e:
            logger.error(f"加载工具出错: {e}", exc_info=True)

    def reload_tools(self):
        """重新加载所有工具"""
        logger.info("正在 Dispatcher 中重新加载工具...")
        # Clear existing registry and map
        global PLUGIN_REGISTRY
        PLUGIN_REGISTRY.clear()
        self.category_map.clear()
        self.tool_to_manifest.clear()
        
        # Reload from PM
        self.pm.reload_plugins()
        self._load_tools()

    def _register_tool(self, name: str, func: Callable):
        """Helper to register a tool with normalization"""
        norm_name = normalize_nit_key(name)
        
        # 创建适配器
        def make_adapter(f=func):
            async def adapter(**kwargs):
                if asyncio.iscoroutinefunction(f):
                    return await f(**kwargs)
                else:
                    return f(**kwargs)
            return adapter
        
        adapter = make_adapter()
        PLUGIN_REGISTRY[norm_name] = adapter
        
        # 如果 norm_name 和 name 不同，且 name 没被占用，也注册原始名称
        if norm_name != name and name not in PLUGIN_REGISTRY:
            PLUGIN_REGISTRY[name] = adapter

    def _register_browser_bridge(self):
        """注册浏览器桥接服务 (BrowserBridge)"""
        # BrowserBridge 也是一种特殊形式的工具
        try:
            from services.browser_bridge_service import BrowserBridgeService
            bridge = BrowserBridgeService()
            
            async def browser_bridge_adapter(**kwargs):
                if bridge.latest_page_info:
                    return str(bridge.latest_page_info)
                return "当前没有可用的浏览器页面信息。"

            PLUGIN_REGISTRY['get_browser_page_info'] = browser_bridge_adapter
            
        except ImportError:
            logger.warning("无法导入 BrowserBridgeService。")
        except Exception as e:
             logger.warning(f"BrowserBridgeService 初始化失败: {e}")

    def list_plugins(self) -> List[str]:
        """获取所有已注册的插件名称"""
        return sorted(list(PLUGIN_REGISTRY.keys()))

    def get_tools_description(self, category_filter: str = 'core') -> str:
        """
        生成可用工具的描述信息，用于注入到 System Prompt 中。
        支持按类别过滤：'core', 'work', 'plugins' (or 'all')
        实时检查 NITManager 状态以决定是否显示。
        """
        descriptions = []
        
        # 检查轻量模式
        config = get_config_manager()
        is_lightweight = config.get("lightweight_mode", False)

        manifests = self.pm.get_all_manifests()
        
        # Filter manifests based on category and status
        filtered_manifests = []
        for m in manifests:
            plugin_name = m.get("name")
            cat = m.get('_category', 'core')
            
            # Lightweight Mode Filter: Only ScreenVision, CharacterOps and MemoryOps are allowed
            if is_lightweight:
                if plugin_name not in ["ScreenVision", "CharacterOps", "MemoryOps"]:
                    continue
            
            # Category Level Filter
            if category_filter != 'all' and cat != category_filter:
                continue
            
            # NITManager Status Filter (Level 1 & 2)
            if not self.nm.is_category_enabled(cat):
                continue
            if not self.nm.is_plugin_enabled(plugin_name):
                continue
                
            filtered_manifests.append(m)

        # 按名称排序
        for manifest in sorted(filtered_manifests, key=lambda x: x.get("name", "")):
             name = manifest.get("displayName", manifest.get("name", "Unknown"))
             desc_text = manifest.get("description", "")
             
             desc = f"### {name}\n"
             desc += f"- **简介**: {desc_text}\n"
             
             commands = manifest.get("capabilities", {}).get("invocationCommands", [])
             if commands:
                 desc += "- **能力列表**:\n"
                 for cmd in commands:
                     cmd_id = cmd['commandIdentifier']
                     cmd_desc = cmd['description']
                     
                     # Introspect function signature for better LLM guidance
                     sig_hint = ""
                     try:
                        import inspect
                        # Try to find the function in the registry
                        # Note: Registry keys are normalized, so we need to be careful
                        norm_key = normalize_nit_key(cmd_id)
                        handler = PLUGIN_REGISTRY.get(norm_key)
                        
                        # If handler is an adapter (wrapper), we might need to unwrap or just accept generic signature
                        # But our adapters call f(**params), so inspection might be tricky on the wrapper.
                        # However, PluginManager registers the RAW function into self.tools_map, 
                        # and Dispatcher registers that raw function wrapped in an adapter.
                        
                        # Let's try to get the raw function from PluginManager directly if possible
                        # But Dispatcher doesn't have direct access to PluginManager's internal map easily
                        # except via PM.get_tool() if we added that method.
                        
                        # Actually, PM has get_tool(cmd_id).
                        raw_func = self.pm.get_tool(cmd_id)
                        if raw_func:
                            sig = inspect.signature(raw_func)
                            params = []
                            for param in sig.parameters.values():
                                if param.name in ['self', 'args', 'kwargs']: continue
                                params.append(param.name)
                            if params:
                                sig_hint = f" (Args: {', '.join(params)})"
                     except Exception:
                        pass

                     desc += f"  - `{cmd_id}`: {cmd_desc}{sig_hint}\n"
             
             descriptions.append(desc)
             
        return "\n".join(descriptions)

    async def _echo_plugin(self, params: Dict[str, Any]) -> str:
        """测试用插件"""
        msg = params.get('message', '') or params.get('msg', '')
        return f"[Echo Plugin] Received: {msg}"

    async def dispatch(self, text: str, extra_plugins: Dict[str, Any] = None, expected_nit_id: str = None) -> List[Dict[str, Any]]:
        """
        处理 AI 输出的文本块
        返回执行结果列表
        
        :param text: 包含 NIT 指令的文本
        :param extra_plugins: 临时的额外插件注册表 (例如 MCP 动态加载的工具)
        :param expected_nit_id: 本轮期望的 NIT-ID (用于安全握手)
        """
        results = []

        # 1. 优先处理 NIT 2.0 脚本 (<nit>...</nit>)
        # Regex to capture <nit> or <nit-XXXX>
        # group(1): full tag name (e.g. "nit" or "nit-A9B2")
        # group(2): ID part only (e.g. "A9B2") if present
        # group(3): content
        nit_pattern = r'<(nit(?:-([0-9a-fA-F]{4}))?)>(.*?)</\1>'
        nit_matches = list(re.finditer(nit_pattern, text, re.DOTALL | re.IGNORECASE))

        if nit_matches:
            logger.info(f"检测到 {len(nit_matches)} 个 NIT 脚本块。")
            
            # 用于在闭包中捕获当前 block 执行过的工具
            current_block_tools = []

            # 定义 Runtime 的执行器回调
            async def runtime_tool_executor(name: str, params: Dict[str, Any]):
                current_block_tools.append(name)
                return await self._execute_plugin(name, params, extra_plugins)

            for match in nit_matches:
                full_tag = match.group(0)
                # tag_name = match.group(1)
                extracted_id = match.group(2)
                script = match.group(3)
                
                # 重置当前 block 的工具列表
                current_block_tools = []
                
                # --- Security Validation ---
                if expected_nit_id:
                    if extracted_id:
                        # ID 存在，必须匹配
                        is_valid, status = NITSecurityManager.validate_id(extracted_id, expected_nit_id)
                        if not is_valid:
                            msg = f"安全拦截: NIT ID 不匹配 (预期 {expected_nit_id}, 实际 {extracted_id})"
                            logger.warning(msg)
                            results.append({
                                "plugin": "NIT_Script",
                                "status": "blocked",
                                "output": msg,
                                "raw_block": full_tag
                            })
                            continue
                    else:
                        # ID 不存在 (<nit>) -> Fallback Mode
                        logger.warning(f"NIT 回退: 使用了标准 <nit> 标签而非 <nit-{expected_nit_id}>。允许执行。")
                # ---------------------------

                try:
                    # 去除 script 中的 HTML 实体转义 (如 &gt; -> >) 如果有的话
                    # 但通常 LLM 输出是纯文本。
                    output = await execute_nit_script(script, runtime_tool_executor)
                    results.append({
                        "plugin": "NIT_Script",
                        "status": "success",
                        "output": output,
                        "raw_block": full_tag,
                        "executed_tools": list(current_block_tools) # Copy list
                    })
                except Exception as e:
                    logger.error(f"NIT 脚本错误: {e}", exc_info=True)
                    results.append({
                        "plugin": "NIT_Script",
                        "status": "error",
                        "output": f"Script Error: {str(e)}",
                        "raw_block": full_tag,
                        "executed_tools": list(current_block_tools) # Copy partial list
                    })

        return results

    async def _execute_plugin(self, plugin_name: str, params: Dict[str, Any], extra_plugins: Dict[str, Any] = None) -> str:
        """执行单个插件"""
        start_time = time.perf_counter()
        
        # [Fix for Path Hallucination]
        # If plugin_name looks like a file path (e.g. "PeroCore\backend\...\ToolName"), strip it to just the name.
        if '\\' in plugin_name or '/' in plugin_name:
            original_path = plugin_name
            plugin_name = os.path.basename(plugin_name.replace('\\', '/').rstrip('/'))
            logger.warning(f"已从工具名中移除路径: '{original_path}' -> '{plugin_name}'")

        # Log Start
        # Truncate params for display
        params_str = json.dumps(params, ensure_ascii=False)
        if len(params_str) > 200:
            params_str = params_str[:200] + "..."
        logger.info(f"▶ 工具调用: {plugin_name} | 参数: {params_str}")

        # 归一化插件名以匹配注册表
        norm_name = normalize_nit_key(plugin_name)
        
        # 检查 NITManager 状态
        manifest = self.tool_to_manifest.get(norm_name)
        if manifest:
            plugin_id = manifest.get("name")
            category = manifest.get("_category", "core")
            
            # Lightweight Mode Execution Check
            config = get_config_manager()
            if config.get("lightweight_mode", False):
                if plugin_id not in ["ScreenVision", "CharacterOps", "MemoryOps"]:
                    logger.warning(f"执行被拦截: 轻量模式已激活。工具 '{plugin_name}' (插件: {plugin_id}) 受限。")
                    return f"错误: 工具 '{plugin_name}' 在轻量聊天模式下受限。仅 ScreenVision, CharacterOps 和 MemoryOps 可用。"

            if not self.nm.is_category_enabled(category):
                logger.warning(f"执行被拦截: 类别 '{category}' 已禁用。")
                return f"错误: 工具 '{plugin_name}' 属于类别 '{category}'，该类别当前已禁用。"
            if not self.nm.is_plugin_enabled(plugin_id):
                logger.warning(f"执行被拦截: 插件 '{plugin_id}' 已禁用。")
                return f"错误: 工具 '{plugin_name}' (插件: {plugin_id}) 当前已禁用。"

        # 优先检查 extra_plugins
        handler = None
        if extra_plugins:
            # 尝试直接匹配
            handler = extra_plugins.get(norm_name)
            # 如果没找到，尝试在 extra_plugins 中查找归一化后的 key
            if not handler:
                for k, v in extra_plugins.items():
                    if normalize_nit_key(k) == norm_name:
                        handler = v
                        break
        
        # 如果 extra_plugins 中没有，查全局注册表
        if not handler:
            handler = PLUGIN_REGISTRY.get(norm_name)

        # [NIT 2.1 Auto-Routing] 如果找不到 handler，尝试检测是否是 "PluginName" + "command" 参数模式
        if not handler:
            # 检查是否有潜在的 command 参数
            routing_keys = ['command', 'commandidentifier', 'action', 'tool']
            potential_cmds = [(k, params.get(k)) for k in routing_keys if params.get(k)]
            
            for key, cmd in potential_cmds:
                # 尝试构造 PluginName.CommandName
                namespaced_key = normalize_nit_key(f"{plugin_name}.{cmd}")
                handler = PLUGIN_REGISTRY.get(namespaced_key)
                if handler:
                    logger.info(f"自动路由 '{plugin_name}' + cmd='{cmd}' -> {namespaced_key}")
                    # Remove the routing key from params to avoid TypeError
                    params.pop(key, None)
                    break
                
                # 尝试直接查找 CommandName (如果 PluginName 只是误写)
                cmd_key = normalize_nit_key(cmd)
                handler = PLUGIN_REGISTRY.get(cmd_key)
                if handler:
                    logger.info(f"自动路由 '{plugin_name}' + cmd='{cmd}' -> {cmd_key}")
                    # Remove the routing key from params to avoid TypeError
                    params.pop(key, None)
                    break

        if not handler:
            # Check if it's a category and provide helpful hint
            if norm_name in self.category_map:
                tools = self.category_map[norm_name]
                return f"错误: '{plugin_name}' 是一个插件类别，不是工具。你是想使用这些工具之一吗? {', '.join(tools)}"
            
            logger.error(f"未找到插件 '{plugin_name}'。")
            return f"错误: 未找到插件 '{plugin_name}' (归一化名: {norm_name})。"
            
        try:
            result = None
            if asyncio.iscoroutinefunction(handler):
                 result = await handler(**params)
            else:
                # [Optimization] Run blocking sync functions in a thread pool to avoid blocking the event loop
                loop = asyncio.get_running_loop()
                from functools import partial
                result = await loop.run_in_executor(None, partial(handler, **params))
            
            # Log Success
            duration = (time.perf_counter() - start_time) * 1000
            result_str = str(result)
            if len(result_str) > 100:
                result_preview = result_str[:100] + "..."
            else:
                result_preview = result_str
                
            logger.info(f"✔ 工具完成: {plugin_name} | 耗时: {duration:.2f}ms | 结果: {result_preview}")
            return result
            
        except Exception as e:
            # Log Failure
            duration = (time.perf_counter() - start_time) * 1000
            logger.error(f"✘ 工具失败: {plugin_name} | 耗时: {duration:.2f}ms | 错误: {e}", exc_info=True)
            raise e

# 全局单例
_dispatcher_instance = None

def get_dispatcher():
    global _dispatcher_instance
    if _dispatcher_instance is None:
        _dispatcher_instance = NITDispatcher()
    return _dispatcher_instance
