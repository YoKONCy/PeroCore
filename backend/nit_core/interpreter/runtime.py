import asyncio
from typing import Dict, Any, Callable, Awaitable
from .ast_nodes import PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ValueNode

class NITRuntime:
    def __init__(self, tool_executor: Callable[[str, Dict[str, Any]], Awaitable[str]]):
        self.scope: Dict[str, Any] = {}
        self.tool_executor = tool_executor

    async def execute(self, pipeline: PipelineNode):
        results = []
        for stmt in pipeline.statements:
            if isinstance(stmt, AssignmentNode):
                val = await self.evaluate_call(stmt.expression)
                self.scope[stmt.target_var] = val
                results.append(f"Assignment: ${stmt.target_var} = {str(val)[:50]}...")
            elif isinstance(stmt, CallNode):
                val = await self.evaluate_call(stmt)
                results.append(f"Call: {stmt.tool_name} -> {str(val)[:50]}...")
        return "\n".join(results)

    async def evaluate_call(self, node: CallNode) -> Any:
        # Resolve arguments
        resolved_args = {}
        for k, v_node in node.args.items():
            resolved_args[k] = self.evaluate_value(v_node)

        if node.is_async:
            # Spawn async task
            # We can't await it here, just schedule it
            asyncio.create_task(self._run_async_tool(node.tool_name, resolved_args, node.callback))
            return "Async task scheduled"
        else:
            # Sync execution
            try:
                result = await self.tool_executor(node.tool_name, resolved_args)
                return result
            except Exception as e:
                return f"Error: {e}"

    async def _run_async_tool(self, tool_name: str, args: Dict[str, Any], callback_tool: str = None):
        try:
            result = await self.tool_executor(tool_name, args)
            if callback_tool:
                # Execute callback with result
                # Convention: callback tool receives 'result' arg
                await self.tool_executor(callback_tool, {"result": result})
        except Exception as e:
            logger.error(f"Async task failed: {e}", exc_info=True)

    def evaluate_value(self, node: ValueNode) -> Any:
        if isinstance(node, LiteralNode):
            return node.value
        elif isinstance(node, VariableRefNode):
            if node.name in self.scope:
                return self.scope[node.name]
            else:
                return f"$undefined({node.name})"
        return None
