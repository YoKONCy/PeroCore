"""
[LEGACY] 基于 Python 的 Parser 实现。
注意: 此模块仅作为 Rust 扩展 (nit_rust_runtime) 不可用时的回退方案。
主要实现位于: rust_binding/src/parser.rs
"""

from typing import List, Optional
from .lexer import Token, TokenType, Lexer
from .ast_nodes import ASTNode, PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ValueNode, ListNode
from .errors import NITParserError

class Parser:
    def __init__(self, tokens: List[Token], source: Optional[str] = None):
        self.tokens = tokens
        self.pos = 0
        self.source = source

    def error(self, msg: str):
        token = self.peek()
        raise NITParserError(msg, token.line, token.column, self.source)

    def peek(self) -> Token:
        if self.pos >= len(self.tokens):
            # 如果越界，回退到最后一个 token (通常是 EOF)
            return self.tokens[-1]
        return self.tokens[self.pos]

    def advance(self) -> Token:
        token = self.peek()
        if self.pos < len(self.tokens):
            self.pos += 1
        return token

    def match(self, type: TokenType) -> Token:
        if self.peek().type == type:
            return self.advance()
        self.error(f"Expected {type}, got {self.peek().type}")

    def parse(self) -> PipelineNode:
        statements = []
        while self.pos < len(self.tokens) and self.peek().type != TokenType.EOF:
            stmt = self.parse_statement()
            if stmt:
                statements.append(stmt)
        return PipelineNode(statements=statements)

    def parse_statement(self) -> ASTNode:
        # 检查是否为赋值语句: $var = ...
        if self.peek().type == TokenType.VARIABLE:
            return self.parse_assignment()
        
        # 或者是直接调用 (异步或同步)
        return self.parse_call()

    def parse_assignment(self) -> AssignmentNode:
        var_token = self.match(TokenType.VARIABLE)
        self.match(TokenType.EQUALS)
        call_node = self.parse_call()
        return AssignmentNode(target_var=var_token.value, expression=call_node)

    def parse_call(self) -> CallNode:
        is_async = False
        if self.peek().type == TokenType.KEYWORD_ASYNC:
            self.advance()
            is_async = True
            
        tool_name = self.match(TokenType.IDENTIFIER).value
        self.match(TokenType.LPAREN)
        
        args = {}
        if self.peek().type != TokenType.RPAREN:
            while True:
                arg_name = self.match(TokenType.IDENTIFIER).value
                self.match(TokenType.EQUALS)
                arg_value = self.parse_value()
                args[arg_name] = arg_value
                
                if self.peek().type == TokenType.COMMA:
                    self.advance()
                    continue
                else:
                    break
        
        self.match(TokenType.RPAREN)
        
        # 检查异步调用中的回调 (约定: callback="func_name")
        # 在我们的语法中，callback 只是一个参数，但我们可能希望将其提升到 AST 属性
        callback = None
        if "callback" in args and isinstance(args["callback"], LiteralNode):
            callback = str(args["callback"].value)
            
        return CallNode(tool_name=tool_name, args=args, is_async=is_async, callback=callback)

    def parse_value(self) -> ValueNode:
        token = self.peek()
        if token.type == TokenType.STRING or token.type == TokenType.NUMBER:
            self.advance()
            return LiteralNode(value=token.value)
        elif token.type == TokenType.VARIABLE:
            self.advance()
            return VariableRefNode(name=token.value)
        elif token.type == TokenType.LBRACKET:
            return self.parse_list()
        else:
            self.error(f"Expected value, got {token.type}")

    def parse_list(self) -> ListNode:
        self.match(TokenType.LBRACKET)
        elements = []
        if self.peek().type != TokenType.RBRACKET:
            while True:
                elements.append(self.parse_value())
                if self.peek().type == TokenType.COMMA:
                    self.advance()
                    continue
                else:
                    break
        self.match(TokenType.RBRACKET)
        return ListNode(elements=elements)
