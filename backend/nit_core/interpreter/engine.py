from typing import Any, Dict, List
from .ast_nodes import PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ListNode

class NITRuntime:
    """
    NIT 2.0 Script Interpreter Engine.
    Pure logic for variable management and tool execution.
    """
    # [Security Quotas] 防止变量污染和 OOM 风险
    MAX_VARIABLES = 100               # 单个任务最大变量数
    MAX_VAR_STRING_LENGTH = 100_000   # 单个变量最大字符串长度 (约 100KB)

    def __init__(self, tool_executor):
        """
        :param tool_executor: Async function(name, params) -> result
        """
        self.tool_executor = tool_executor
        self.variables = {}

    async def execute(self, pipeline: PipelineNode) -> Any:
        last_result = None
        for statement in pipeline.statements:
            last_result = await self.execute_statement(statement)
        return last_result

    async def execute_statement(self, statement) -> Any:
        if isinstance(statement, AssignmentNode):
            value = await self.execute_call(statement.expression)
            
            # [Security] 检查变量数量限制
            if len(self.variables) >= self.MAX_VARIABLES and statement.target_var not in self.variables:
                print(f"[NIT] Security Alert: Variable limit reached ({self.MAX_VARIABLES}). Skipping {statement.target_var}")
                return value
            
            # [Security] 检查变量大小限制 (针对字符串)
            if isinstance(value, str) and len(value) > self.MAX_VAR_STRING_LENGTH:
                print(f"[NIT] Security Warning: Variable '{statement.target_var}' too large. Truncating from {len(value)} to {self.MAX_VAR_STRING_LENGTH}")
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
        for name, node in call_node.args.items():
            resolved_args[name] = self.evaluate_value(node)
        
        # Execute tool
        result = await self.tool_executor(call_node.tool_name, resolved_args)
        return result
