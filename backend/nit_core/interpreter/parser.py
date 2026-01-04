from typing import List, Optional
from .lexer import Token, TokenType, Lexer
from .ast_nodes import ASTNode, PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ValueNode

class Parser:
    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.pos = 0

    def error(self, msg: str):
        token = self.peek()
        raise ValueError(f"Parser error at line {token.line}, col {token.column}: {msg}")

    def peek(self) -> Token:
        if self.pos >= len(self.tokens):
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
        while self.peek().type != TokenType.EOF:
            stmt = self.parse_statement()
            if stmt:
                statements.append(stmt)
        return PipelineNode(statements=statements)

    def parse_statement(self) -> ASTNode:
        # Check if it is an assignment: $var = ...
        if self.peek().type == TokenType.VARIABLE:
            return self.parse_assignment()
        
        # Or a direct call (async or sync)
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
        
        # Check for callback in async calls (convention: callback="func_name")
        # In our syntax, callback is just an arg, but we might want to lift it to AST property
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
        else:
            self.error(f"Expected value, got {token.type}")
