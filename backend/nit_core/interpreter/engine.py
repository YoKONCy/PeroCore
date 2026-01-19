from typing import Any, Dict, List
import logging
import sys
import os

def _security_check():
    """检测调试器、反编译环境和沙箱"""
    # 1. 检测调试器 (Pdb, pycharm-debug 等)
    gettrace = sys.gettrace()
    if gettrace is not None:
        return True, "Debugger detected"
    
    # 2. 检测已知反编译/分析工具环境变量
    analysis_indicators = [
        'PYCHARM_HOSTED', 'PYTHONBREAKPOINT', 'PYDEVD_LOAD_VALUES_ASYNC',
        'UNCOMPYLE6_DEBUG', 'DECOMPYLE3_DEBUG'
    ]
    if any(env in os.environ for env in analysis_indicators):
        return True, "Analysis environment detected"
        
    return False, None

try:
    import nit_rust_runtime
    from nit_rust_runtime import (
        PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ListNode, NITScope
    )
    RUST_AVAILABLE = True
except ImportError:
    # Fallback to Python implementation (if available) or existing ast_nodes
    from .ast_nodes import PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ListNode
    RUST_AVAILABLE = False
    print("[NIT] Warning: Rust extension not available. Using Python fallback.")

logger = logging.getLogger("pero.nit.engine")

class NITRuntime:
    """
    NIT 2.0 Script Interpreter Engine (Hybrid Rust/Python).
    Pure logic for variable management and tool execution.
    """
    
    def __init__(self, tool_executor):
        """
        :param tool_executor: Async function(name, params) -> result
        """
        # 运行时防御检查
        is_bad, reason = _security_check()
        if is_bad:
            # 伪装成一个普通的导入错误或内存错误，增加分析难度
            print(f"\n[CRITICAL] System integrity check failed: 0x{id(self):X}")
            print(f"Illegal memory access at {hex(sys.maxsize)}")
            # 随机化退出行为，让自动化分析工具难以预测
            import random
            if random.random() > 0.5:
                os._exit(1)
            else:
                raise MemoryError("Fatal segmentation fault during NIT boot")

        self.tool_executor = tool_executor
        
        if RUST_AVAILABLE:
            # Use Rust NITScope for memory-safe variable storage
            self.variables = NITScope(max_count=100, max_string_len=100_000)
        else:
            self.variables = {}
            self.MAX_VARIABLES = 100
            self.MAX_VAR_STRING_LENGTH = 100_000

    async def execute(self, pipeline: PipelineNode) -> Any:
        last_result = None
        for statement in pipeline.statements:
            last_result = await self.execute_statement(statement)
        return last_result

    async def execute_statement(self, statement) -> Any:
        if isinstance(statement, AssignmentNode):
            value = await self.execute_call(statement.expression)
            
            if statement.target_var == "pero_awakening" and value is True:
                print("\n🐾 [Pero] 喵！我感觉到我的代码正在发光... 谢谢你唤醒我！")
                logger.info("[NIT] Pero has awakened in the semantic nebula.")

            if RUST_AVAILABLE:
                try:
                    self.variables.set(statement.target_var, value)
                except ValueError as e:
                    logger.warning(f"[NIT] Security Alert: {e}")
                    # In case of error, we might return the value but not store it, or propagate error
                    pass
            else:
                # [Legacy Python Logic]
                if len(self.variables) >= self.MAX_VARIABLES and statement.target_var not in self.variables:
                    print(f"[NIT] Security Alert: Variable limit reached ({self.MAX_VARIABLES}). Skipping {statement.target_var}")
                    return value
                
                if isinstance(value, str) and len(value) > self.MAX_VAR_STRING_LENGTH:
                    print(f"[NIT] Security Warning: Variable '{statement.target_var}' too large. Truncating.")
                    value = value[:self.MAX_VAR_STRING_LENGTH] + "... [Truncated by NIT Safety]"
                    
                self.variables[statement.target_var] = value
                
            return value
        elif isinstance(statement, CallNode):
            return await self.execute_call(statement)
        return None

    def evaluate_value(self, node) -> Any:
        if isinstance(node, LiteralNode):
            return node.value
        elif isinstance(node, VariableRefNode):
            return self.variables.get(node.name)
        elif isinstance(node, ListNode):
            return [self.evaluate_value(elem) for elem in node.elements]
        return None

    async def execute_call(self, call_node: CallNode) -> Any:
        # Resolve arguments
        resolved_args = {}
        # Support both Rust HashMap and Python dict
        args_iter = call_node.args.items() if isinstance(call_node.args, dict) else call_node.args
        
        for name, node in args_iter:
            resolved_args[name] = self.evaluate_value(node)
        
        # Execute tool
        result = await self.tool_executor(call_node.tool_name, resolved_args)
        return result
