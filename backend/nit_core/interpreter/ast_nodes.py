"""
[LEGACY/FALLBACK] Python AST Node Definitions.
NOTE: These definitions are used when the Rust extension is unavailable OR for type hinting in the Python fallback path.
The Rust implementation (rust_binding/src/ast.rs) mirrors this structure.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Union, Optional

@dataclass
class ASTNode:
    pass

@dataclass
class ValueNode(ASTNode):
    pass

@dataclass
class LiteralNode(ValueNode):
    value: Union[str, int, float, bool]

@dataclass
class VariableRefNode(ValueNode):
    name: str

@dataclass
class ListNode(ValueNode):
    elements: List[ValueNode]

@dataclass
class CallNode(ASTNode):
    tool_name: str
    args: Dict[str, ValueNode]
    is_async: bool = False
    callback: Optional[str] = None # For async callback task name

@dataclass
class AssignmentNode(ASTNode):
    target_var: str
    expression: CallNode

@dataclass
class PipelineNode(ASTNode):
    statements: List[Union[AssignmentNode, CallNode]]
