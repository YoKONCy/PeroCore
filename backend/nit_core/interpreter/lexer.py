import re
from typing import List, Tuple, Any
from enum import Enum, auto
from dataclasses import dataclass
from .errors import NITLexerError

class TokenType(Enum):
    IDENTIFIER = auto()
    VARIABLE = auto() # $var
    STRING = auto()
    NUMBER = auto()
    EQUALS = auto() # =
    LPAREN = auto() # (
    RPAREN = auto() # )
    COMMA = auto()  # ,
    KEYWORD_ASYNC = auto()
    EOF = auto()

@dataclass
class Token:
    type: TokenType
    value: Any
    line: int
    column: int

class Lexer:
    def __init__(self, text: str):
        self.text = text
        self.pos = 0
        self.line = 1
        self.column = 1
        self.tokens = []

    def error(self, msg: str):
        raise NITLexerError(msg, self.line, self.column, self.text)

    def peek(self) -> str:
        if self.pos >= len(self.text):
            return ''
        return self.text[self.pos]

    def advance(self):
        if self.pos < len(self.text):
            if self.text[self.pos] == '\n':
                self.line += 1
                self.column = 1
            else:
                self.column += 1
            self.pos += 1

    def tokenize(self) -> List[Token]:
        while self.pos < len(self.text):
            char = self.peek()

            if char.isspace():
                self.advance()
                continue

            if char == '$':
                self.tokens.append(self.read_variable())
                continue

            if char.isalpha() or char == '_':
                self.tokens.append(self.read_identifier())
                continue

            if char == '"' or char == "'":
                self.tokens.append(self.read_string(char))
                continue

            if char.isdigit():
                self.tokens.append(self.read_number())
                continue

            if char == '=':
                self.tokens.append(Token(TokenType.EQUALS, '=', self.line, self.column))
                self.advance()
                continue
            
            if char == '(':
                self.tokens.append(Token(TokenType.LPAREN, '(', self.line, self.column))
                self.advance()
                continue
                
            if char == ')':
                self.tokens.append(Token(TokenType.RPAREN, ')', self.line, self.column))
                self.advance()
                continue

            if char == ',':
                self.tokens.append(Token(TokenType.COMMA, ',', self.line, self.column))
                self.advance()
                continue
            
            # Skip comments #
            if char == '#':
                while self.peek() != '\n' and self.peek() != '':
                    self.advance()
                continue

            self.error(f"Unexpected character: {char}")
        
        self.tokens.append(Token(TokenType.EOF, None, self.line, self.column))
        return self.tokens

    def read_variable(self) -> Token:
        # $var
        start_line = self.line
        start_col = self.column
        self.advance() # skip $
        
        name = ""
        while self.peek().isalnum() or self.peek() == '_':
            name += self.peek()
            self.advance()
            
        return Token(TokenType.VARIABLE, name, start_line, start_col)

    def read_identifier(self) -> Token:
        start_line = self.line
        start_col = self.column
        name = ""
        while self.peek().isalnum() or self.peek() == '_':
            name += self.peek()
            self.advance()
            
        if name == "async":
            return Token(TokenType.KEYWORD_ASYNC, name, start_line, start_col)
            
        return Token(TokenType.IDENTIFIER, name, start_line, start_col)

    def read_string(self, quote_char: str) -> Token:
        start_line = self.line
        start_col = self.column
        self.advance() # skip quote
        
        val = ""
        while self.peek() != quote_char and self.peek() != '':
            if self.peek() == '\\':
                self.advance()
                # Simple escape handling
                if self.peek() == 'n': val += '\n'
                elif self.peek() == 't': val += '\t'
                else: val += self.peek()
                self.advance()
            else:
                val += self.peek()
                self.advance()
                
        if self.peek() == quote_char:
            self.advance()
        else:
            self.error("Unterminated string")
            
        return Token(TokenType.STRING, val, start_line, start_col)

    def read_number(self) -> Token:
        start_line = self.line
        start_col = self.column
        val_str = ""
        while self.peek().isdigit() or self.peek() == '.':
            val_str += self.peek()
            self.advance()
            
        if '.' in val_str:
            return Token(TokenType.NUMBER, float(val_str), start_line, start_col)
        return Token(TokenType.NUMBER, int(val_str), start_line, start_col)
