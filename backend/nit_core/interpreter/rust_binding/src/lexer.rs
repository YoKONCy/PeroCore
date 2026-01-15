use pyo3::prelude::*;

#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    Identifier,
    Variable, // $var
    String,
    Number,
    Equals,   // =
    LParen,   // (
    RParen,   // )
    LBracket, // [
    RBracket, // ]
    Comma,    // ,
    KeywordAsync,
    EOF,
}

impl TokenType {
    fn to_str(&self) -> &'static str {
        match self {
            TokenType::Identifier => "IDENTIFIER",
            TokenType::Variable => "VARIABLE",
            TokenType::String => "STRING",
            TokenType::Number => "NUMBER",
            TokenType::Equals => "EQUALS",
            TokenType::LParen => "LPAREN",
            TokenType::RParen => "RPAREN",
            TokenType::LBracket => "LBRACKET",
            TokenType::RBracket => "RBRACKET",
            TokenType::Comma => "COMMA",
            TokenType::KeywordAsync => "KEYWORD_ASYNC",
            TokenType::EOF => "EOF",
        }
    }
}

/// Token 结构体 (暴露给 Python)
#[pyclass(module = "nit_rust_runtime")]
#[derive(Clone, Debug)]
pub struct Token {
    #[pyo3(get)]
    pub type_: String, // 为了兼容 Python 枚举，这里直接存字符串
    #[pyo3(get)]
    pub value: PyObject,
    #[pyo3(get)]
    pub line: usize,
    #[pyo3(get)]
    pub column: usize,
}

#[pymethods]
impl Token {
    fn __repr__(&self) -> String {
        format!("Token(type={}, value={:?}, line={}, col={})", self.type_, self.value, self.line, self.column)
    }
}

/// 高性能 Lexer 实现
#[pyclass(module = "nit_rust_runtime")]
pub struct Lexer {
    input: Vec<char>, // 使用 char 向量处理 unicode
    pos: usize,
    line: usize,
    column: usize,
}

#[pymethods]
impl Lexer {
    #[new]
    fn new(text: String) -> Self {
        Lexer {
            input: text.chars().collect(),
            pos: 0,
            line: 1,
            column: 1,
        }
    }

    /// 执行分词并返回 Token 列表
    fn tokenize(&mut self, py: Python) -> PyResult<Vec<Token>> {
        let mut tokens = Vec::new();

        while self.pos < self.input.len() {
            let ch = self.current_char();

            // 1. 跳过空白
            if ch.is_whitespace() {
                self.advance();
                continue;
            }

            // 2. 变量 ($var)
            if ch == '$' {
                tokens.push(self.read_variable(py)?);
                continue;
            }

            // 3. 标识符或关键字
            if ch.is_alphabetic() || ch == '_' {
                tokens.push(self.read_identifier(py)?);
                continue;
            }

            // 4. 字符串 ("..." 或 '...')
            if ch == '"' || ch == '\'' {
                tokens.push(self.read_string(py, ch)?);
                continue;
            }

            // 5. 数字
            if ch.is_ascii_digit() {
                tokens.push(self.read_number(py)?);
                continue;
            }

            // 6. 符号
            let token_type = match ch {
                '=' => Some(TokenType::Equals),
                '(' => Some(TokenType::LParen),
                ')' => Some(TokenType::RParen),
                '[' => Some(TokenType::LBracket),
                ']' => Some(TokenType::RBracket),
                ',' => Some(TokenType::Comma),
                '#' => {
                    // 注释: 跳过直到行尾
                    while self.pos < self.input.len() && self.current_char() != '\n' {
                        self.advance();
                    }
                    continue;
                }
                _ => None,
            };

            if let Some(tt) = token_type {
                tokens.push(Token {
                    type_: tt.to_str().to_string(),
                    value: ch.to_string().into_py(py),
                    line: self.line,
                    column: self.column,
                });
                self.advance();
                continue;
            }

            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "Unexpected character: {} at line {}, col {}",
                ch, self.line, self.column
            )));
        }

        // EOF Token
        tokens.push(Token {
            type_: TokenType::EOF.to_str().to_string(),
            value: py.None(),
            line: self.line,
            column: self.column,
        });

        Ok(tokens)
    }
}

// 内部辅助方法
impl Lexer {
    fn current_char(&self) -> char {
        if self.pos >= self.input.len() {
            '\0'
        } else {
            self.input[self.pos]
        }
    }

    fn advance(&mut self) {
        if self.pos < self.input.len() {
            if self.input[self.pos] == '\n' {
                self.line += 1;
                self.column = 1;
            } else {
                self.column += 1;
            }
            self.pos += 1;
        }
    }

    fn read_variable(&mut self, py: Python) -> PyResult<Token> {
        let start_line = self.line;
        let start_col = self.column;
        self.advance(); // skip $

        let mut name = String::new();
        while self.pos < self.input.len() {
            let ch = self.current_char();
            if ch.is_alphanumeric() || ch == '_' {
                name.push(ch);
                self.advance();
            } else {
                break;
            }
        }

        Ok(Token {
            type_: TokenType::Variable.to_str().to_string(),
            value: name.into_py(py),
            line: start_line,
            column: start_col,
        })
    }

    fn read_identifier(&mut self, py: Python) -> PyResult<Token> {
        let start_line = self.line;
        let start_col = self.column;
        
        let mut name = String::new();
        while self.pos < self.input.len() {
            let ch = self.current_char();
            if ch.is_alphanumeric() || ch == '_' {
                name.push(ch);
                self.advance();
            } else {
                break;
            }
        }

        let type_ = if name == "async" {
            TokenType::KeywordAsync
        } else {
            TokenType::Identifier
        };

        Ok(Token {
            type_: type_.to_str().to_string(),
            value: name.into_py(py),
            line: start_line,
            column: start_col,
        })
    }

    fn read_string(&mut self, py: Python, quote: char) -> PyResult<Token> {
        let start_line = self.line;
        let start_col = self.column;
        self.advance(); // skip quote

        let mut val = String::new();
        while self.pos < self.input.len() {
            let ch = self.current_char();
            if ch == quote {
                self.advance();
                return Ok(Token {
                    type_: TokenType::String.to_str().to_string(),
                    value: val.into_py(py),
                    line: start_line,
                    column: start_col,
                });
            }
            
            if ch == '\\' {
                self.advance();
                let escaped = self.current_char();
                match escaped {
                    'n' => val.push('\n'),
                    't' => val.push('\t'),
                    _ => val.push(escaped),
                }
                self.advance();
            } else {
                val.push(ch);
                self.advance();
            }
        }

        Err(pyo3::exceptions::PyValueError::new_err("Unterminated string"))
    }

    fn read_number(&mut self, py: Python) -> PyResult<Token> {
        let start_line = self.line;
        let start_col = self.column;
        
        let mut val_str = String::new();
        let mut is_float = false;

        while self.pos < self.input.len() {
            let ch = self.current_char();
            if ch.is_ascii_digit() {
                val_str.push(ch);
                self.advance();
            } else if ch == '.' && !is_float {
                is_float = true;
                val_str.push(ch);
                self.advance();
            } else {
                break;
            }
        }

        let value = if is_float {
            val_str.parse::<f64>().unwrap().into_py(py)
        } else {
            val_str.parse::<i64>().unwrap().into_py(py)
        };

        Ok(Token {
            type_: TokenType::Number.to_str().to_string(),
            value,
            line: start_line,
            column: start_col,
        })
    }
}
