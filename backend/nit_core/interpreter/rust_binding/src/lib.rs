use pyo3::prelude::*;

mod ast;
mod lexer;
mod parser;
mod scope;

/// NIT Rust Runtime Extension
/// 提供高性能的 AST 定义、Lexer 和 Parser
#[pymodule]
fn nit_rust_runtime(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // 导出 AST 节点类
    m.add_class::<ast::LiteralNode>()?;
    m.add_class::<ast::VariableRefNode>()?;
    m.add_class::<ast::ListNode>()?;
    m.add_class::<ast::CallNode>()?;
    m.add_class::<ast::AssignmentNode>()?;
    m.add_class::<ast::PipelineNode>()?;

    // 导出 Lexer 类
    m.add_class::<lexer::Token>()?;
    m.add_class::<lexer::Lexer>()?;

    // 导出 Parser 类
    m.add_class::<parser::Parser>()?;
    
    // 导出 Scope 类
    m.add_class::<scope::NITScope>()?;
    
    Ok(())
}
