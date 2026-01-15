use pyo3::prelude::*;
use std::collections::HashMap;

// ==========================================
// Python 类定义 (映射 ast_nodes.py)
// ==========================================

/// 字面量节点
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct LiteralNode {
    #[pyo3(get)]
    pub value: PyObject, // 存储 str/int/float/bool
    #[pyo3(get)]
    pub type_name: String, // "string", "number", "bool"
}

#[pymethods]
impl LiteralNode {
    #[new]
    fn new(value: PyObject, type_name: String) -> Self {
        LiteralNode { value, type_name }
    }
    
    fn __repr__(&self) -> String {
        format!("LiteralNode(type={}, value={:?})", self.type_name, self.value)
    }
}

/// 变量引用节点 ($var)
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct VariableRefNode {
    #[pyo3(get)]
    pub name: String,
}

#[pymethods]
impl VariableRefNode {
    #[new]
    fn new(name: String) -> Self {
        VariableRefNode { name }
    }
    
    fn __repr__(&self) -> String {
        format!("VariableRefNode(name='{}')", self.name)
    }
}

/// 列表节点 ([1, "a", $var])
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct ListNode {
    #[pyo3(get)]
    pub elements: Vec<PyObject>, // 列表元素可以是 LiteralNode, VariableRefNode 等
}

#[pymethods]
impl ListNode {
    #[new]
    fn new(elements: Vec<PyObject>) -> Self {
        ListNode { elements }
    }
    
    fn __repr__(&self) -> String {
        format!("ListNode(elements={:?})", self.elements)
    }
}

/// 函数调用节点 (tool_name(arg1=val1))
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct CallNode {
    #[pyo3(get)]
    pub tool_name: String,
    #[pyo3(get)]
    pub args: HashMap<String, PyObject>, // 参数值 (AST Node)
    #[pyo3(get)]
    pub is_async: bool,
    #[pyo3(get)]
    pub callback: Option<String>,
}

#[pymethods]
impl CallNode {
    #[new]
    #[pyo3(signature = (tool_name, args, is_async=false, callback=None))]
    fn new(tool_name: String, args: HashMap<String, PyObject>, is_async: bool, callback: Option<String>) -> Self {
        CallNode { tool_name, args, is_async, callback }
    }
    
    fn __repr__(&self) -> String {
        format!("CallNode(tool='{}', args={:?}, async={})", self.tool_name, self.args.keys(), self.is_async)
    }
}

/// 赋值节点 ($var = call(...))
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct AssignmentNode {
    #[pyo3(get)]
    pub target_var: String,
    #[pyo3(get)]
    pub expression: PyObject, // 通常是 CallNode
}

#[pymethods]
impl AssignmentNode {
    #[new]
    fn new(target_var: String, expression: PyObject) -> Self {
        AssignmentNode { target_var, expression }
    }
    
    fn __repr__(&self) -> String {
        format!("AssignmentNode(target='{}', expr={:?})", self.target_var, self.expression)
    }
}

/// 流水线节点 (整个脚本)
#[pyclass(module = "nit_rust_runtime")]
#[derive(Debug, Clone)]
pub struct PipelineNode {
    #[pyo3(get)]
    pub statements: Vec<PyObject>, // AssignmentNode 或 CallNode 的列表
}

#[pymethods]
impl PipelineNode {
    #[new]
    fn new(statements: Vec<PyObject>) -> Self {
        PipelineNode { statements }
    }
    
    fn __repr__(&self) -> String {
        format!("PipelineNode(statements_count={})", self.statements.len())
    }
}
