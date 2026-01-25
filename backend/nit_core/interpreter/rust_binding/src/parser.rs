use pyo3::prelude::*;
use std::collections::HashMap;
use crate::ast::*;
use crate::lexer::Token;

/// NIT Parser 错误
#[derive(Debug)]
pub enum ParserError {
    UnexpectedToken { expected: String, got: String, line: usize, col: usize },
    UnexpectedEOF,
    PythonError(PyErr),
}

impl From<PyErr> for ParserError {
    fn from(err: PyErr) -> Self {
        ParserError::PythonError(err)
    }
}

impl From<ParserError> for PyErr {
    fn from(err: ParserError) -> PyErr {
        match err {
            ParserError::UnexpectedToken { expected, got, line, col } => {
                pyo3::exceptions::PyValueError::new_err(format!(
                    "语法错误: 预期 {}, 实际得到 {} (行 {}, 列 {})",
                    expected, got, line, col
                ))
            }
            ParserError::UnexpectedEOF => {
                pyo3::exceptions::PyValueError::new_err("意外的文件结束")
            }
            ParserError::PythonError(e) => e,
        }
    }
}

/// 高性能递归下降 Parser
#[pyclass(module = "nit_rust_runtime")]
pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

#[pymethods]
impl Parser {
    #[new]
    fn new(tokens: Vec<Token>) -> Self {
        Parser { tokens, pos: 0 }
    }

    fn parse(&mut self, py: Python) -> PyResult<PyObject> {
        let mut statements = Vec::new();
        
        while self.pos < self.tokens.len() {
            let token = self.peek();
            if token.type_ == "EOF" {
                break;
            }
            
            match self.parse_statement(py) {
                Ok(stmt) => statements.push(stmt),
                Err(e) => return Err(e.into()),
            }
        }
        
        let pipeline = PipelineNode { statements };
        Ok(pipeline.into_py(py))
    }
}

// 内部实现
impl Parser {
    fn peek(&self) -> Token {
        if self.pos >= self.tokens.len() {
            self.tokens[self.tokens.len() - 1].clone()
        } else {
            self.tokens[self.pos].clone()
        }
    }
    
    fn advance(&mut self) -> Token {
        let token = self.peek();
        if self.pos < self.tokens.len() {
            self.pos += 1;
        }
        token
    }
    
    fn match_token(&mut self, type_: &str) -> Result<Token, ParserError> {
        let token = self.peek();
        if token.type_ == type_ {
            Ok(self.advance())
        } else {
            Err(ParserError::UnexpectedToken {
                expected: type_.to_string(),
                got: token.type_.clone(),
                line: token.line,
                col: token.column,
            })
        }
    }

    fn parse_statement(&mut self, py: Python) -> Result<PyObject, ParserError> {
        let token = self.peek();
        
        // 情况 1: 赋值 ($var = ...)
        if token.type_ == "VARIABLE" {
            return self.parse_assignment(py);
        }
        
        // 情况 2: 调用 (tool(...))
        // 可能是 IDENTIFIER 或 KEYWORD_ASYNC
        if token.type_ == "IDENTIFIER" || token.type_ == "KEYWORD_ASYNC" {
            return self.parse_call(py).map(|n| n.into_py(py)); // CallNode -> PyObject
        }
        
        Err(ParserError::UnexpectedToken {
            expected: "语句 (变量或调用)".to_string(),
            got: token.type_.clone(),
            line: token.line,
            col: token.column,
        })
    }
    
    fn parse_assignment(&mut self, py: Python) -> Result<PyObject, ParserError> {
        let var_token = self.match_token("VARIABLE")?;
        let target_var = var_token.value.extract::<String>(py)?;
        
        self.match_token("EQUALS")?;
        
        let expr = self.parse_call(py)?;
        
        let node = AssignmentNode {
            target_var,
            expression: expr.into_py(py),
        };
        Ok(node.into_py(py))
    }
    
    fn parse_call(&mut self, py: Python) -> Result<CallNode, ParserError> {
        let mut is_async = false;
        
        if self.peek().type_ == "KEYWORD_ASYNC" {
            self.advance();
            is_async = true;
        }
        
        let tool_token = self.match_token("IDENTIFIER")?;
        let tool_name = tool_token.value.extract::<String>(py)?;
        
        self.match_token("LPAREN")?;
        
        let mut args = HashMap::new();
        let mut callback: Option<String> = None;
        
        if self.peek().type_ != "RPAREN" {
            loop {
                let arg_name_token = self.match_token("IDENTIFIER")?;
                let arg_name = arg_name_token.value.extract::<String>(py)?;
                
                self.match_token("EQUALS")?;
                
                let value_node = self.parse_value(py)?;
                
                // 特殊处理: callback 参数
                if arg_name == "callback" {
                    // 尝试提取字符串值
                    // 这是一个简化处理，实际应该检查 value_node 类型
                    // 但由于我们返回的是 PyObject，这里先存入 args，最后单独提取有点麻烦
                    // 暂时先按照 Python Parser 的逻辑，把 callback 也作为参数存入
                    // 并尝试解析出字符串给 struct 字段
                    
                    // 为了简化，我们假设 callback 必须是 LiteralNode 且是 string
                    if let Ok(lit) = value_node.extract::<LiteralNode>(py) {
                        if let Ok(s) = lit.value.extract::<String>(py) {
                            callback = Some(s);
                        }
                    }
                }
                
                args.insert(arg_name, value_node);
                
                if self.peek().type_ == "COMMA" {
                    self.advance();
                    continue;
                } else {
                    break;
                }
            }
        }
        
        self.match_token("RPAREN")?;
        
        Ok(CallNode {
            tool_name,
            args,
            is_async,
            callback,
        })
    }
    
    fn parse_value(&mut self, py: Python) -> Result<PyObject, ParserError> {
        let token = self.peek();
        
        if token.type_ == "STRING" || token.type_ == "NUMBER" {
            self.advance();
            let type_name = if token.type_ == "STRING" { "string" } else { "number" };
            let node = LiteralNode {
                value: token.value.clone_ref(py),
                type_name: type_name.to_string(),
            };
            return Ok(node.into_py(py));
        }
        
        if token.type_ == "VARIABLE" {
            self.advance();
            let name = token.value.extract::<String>(py)?;
            let node = VariableRefNode { name };
            return Ok(node.into_py(py));
        }
        
        if token.type_ == "LBRACKET" {
            return self.parse_list(py);
        }
        
        Err(ParserError::UnexpectedToken {
            expected: "值 (Value)".to_string(),
            got: token.type_.clone(),
            line: token.line,
            col: token.column,
        })
    }
    
    fn parse_list(&mut self, py: Python) -> Result<PyObject, ParserError> {
        self.match_token("LBRACKET")?;
        
        let mut elements = Vec::new();
        
        if self.peek().type_ != "RBRACKET" {
            loop {
                elements.push(self.parse_value(py)?);
                
                if self.peek().type_ == "COMMA" {
                    self.advance();
                    continue;
                } else {
                    break;
                }
            }
        }
        
        self.match_token("RBRACKET")?;
        
        let node = ListNode { elements };
        Ok(node.into_py(py))
    }
}
