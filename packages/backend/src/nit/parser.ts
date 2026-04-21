/**
 * NIT Parser — 语法分析器
 *
 * 将 Token 流转换为 AST。
 * 递归下降解析器，支持 NIT 的全部语法。
 *
 * @module packages/backend/src/nit/parser
 */

import { TokenType, type Token, type AstNode } from './types'
import type {
  ProgramNode,
  AssignmentNode,
  FunctionCallNode,
  FunctionArg,
  IfNode,
  ForNode,
  ParallelNode,
  TryCatchNode,
  ReturnNode,
  BinaryOpNode,
  UnaryOpNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayLiteralNode,
  StringLiteralNode,
  NumberLiteralNode,
  BooleanLiteralNode,
  IdentifierNode,
} from './types'

export class NitParser {
  private pos = 0
  private tokens: Token[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  /** 解析为 AST */
  parse(): ProgramNode {
    const body = this.parseBlock(TokenType.EOF)
    return { type: 'Program', body }
  }

  // ── 语句解析 ──

  private parseBlock(endToken: TokenType): AstNode[] {
    const statements: AstNode[] = []

    while (!this.isAtEnd() && this.current().type !== endToken) {
      this.skipNewlines()
      if (this.isAtEnd() || this.current().type === endToken) break
      statements.push(this.parseStatement())
      this.skipNewlines()
    }

    return statements
  }

  private parseStatement(): AstNode {
    const token = this.current()

    switch (token.type) {
      case TokenType.IF:
        return this.parseIf()
      case TokenType.FOR:
        return this.parseFor()
      case TokenType.PARALLEL:
        return this.parseParallel()
      case TokenType.TRY:
        return this.parseTryCatch()
      case TokenType.RETURN:
        return this.parseReturn()
      case TokenType.IDENTIFIER: {
        // 判断: 赋值 (a = ...) 还是表达式 (tool(...))
        if (this.peek(1)?.type === TokenType.EQUALS && this.peek(2)?.type !== TokenType.EQUALS) {
          return this.parseAssignment()
        }
        return this.parseExpression()
      }
      default:
        return this.parseExpression()
    }
  }

  private parseAssignment(): AssignmentNode {
    const name = this.consume(TokenType.IDENTIFIER).value
    this.consume(TokenType.EQUALS)
    const value = this.parseExpression()
    return { type: 'Assignment', name, value }
  }

  private parseIf(): IfNode {
    this.consume(TokenType.IF)
    const condition = this.parseExpression()
    this.consume(TokenType.LBRACE)
    const thenBlock = this.parseBlock(TokenType.RBRACE)
    this.consume(TokenType.RBRACE)

    let elseBlock: AstNode[] | undefined
    this.skipNewlines()
    if (!this.isAtEnd() && this.current().type === TokenType.ELSE) {
      this.advance()
      this.consume(TokenType.LBRACE)
      elseBlock = this.parseBlock(TokenType.RBRACE)
      this.consume(TokenType.RBRACE)
    }

    return { type: 'If', condition, then: thenBlock, else: elseBlock }
  }

  private parseFor(): ForNode {
    this.consume(TokenType.FOR)
    const variable = this.consume(TokenType.IDENTIFIER).value
    this.consume(TokenType.IN)
    const iterable = this.parseExpression()
    this.consume(TokenType.LBRACE)
    const body = this.parseBlock(TokenType.RBRACE)
    this.consume(TokenType.RBRACE)
    return { type: 'For', variable, iterable, body }
  }

  private parseParallel(): ParallelNode {
    this.consume(TokenType.PARALLEL)
    this.consume(TokenType.LBRACE)
    const expressions = this.parseBlock(TokenType.RBRACE)
    this.consume(TokenType.RBRACE)
    return { type: 'Parallel', expressions }
  }

  private parseTryCatch(): TryCatchNode {
    this.consume(TokenType.TRY)
    this.consume(TokenType.LBRACE)
    const tryBlock = this.parseBlock(TokenType.RBRACE)
    this.consume(TokenType.RBRACE)
    this.skipNewlines()
    this.consume(TokenType.CATCH)
    this.consume(TokenType.LBRACE)
    const catchBlock = this.parseBlock(TokenType.RBRACE)
    this.consume(TokenType.RBRACE)
    return { type: 'TryCatch', tryBlock, catchBlock }
  }

  private parseReturn(): ReturnNode {
    this.consume(TokenType.RETURN)
    const value = this.parseExpression()
    return { type: 'Return', value }
  }

  // ── 表达式解析 (优先级递降) ──

  private parseExpression(): AstNode {
    return this.parseOr()
  }

  private parseOr(): AstNode {
    let left = this.parseAnd()
    while (!this.isAtEnd() && this.current().type === TokenType.OR) {
      this.advance()
      const right = this.parseAnd()
      left = { type: 'BinaryOp', op: 'or', left, right } as BinaryOpNode
    }
    return left
  }

  private parseAnd(): AstNode {
    let left = this.parseNot()
    while (!this.isAtEnd() && this.current().type === TokenType.AND) {
      this.advance()
      const right = this.parseNot()
      left = { type: 'BinaryOp', op: 'and', left, right } as BinaryOpNode
    }
    return left
  }

  private parseNot(): AstNode {
    if (!this.isAtEnd() && this.current().type === TokenType.NOT) {
      this.advance()
      const operand = this.parseNot()
      return { type: 'UnaryOp', op: 'not', operand } as UnaryOpNode
    }
    return this.parseComparison()
  }

  private parseComparison(): AstNode {
    let left = this.parseAddSub()
    const cmpOps = [
      TokenType.EQ,
      TokenType.NEQ,
      TokenType.LT,
      TokenType.GT,
      TokenType.LTE,
      TokenType.GTE,
    ]
    while (!this.isAtEnd() && cmpOps.includes(this.current().type)) {
      const op = this.current().value
      this.advance()
      const right = this.parseAddSub()
      left = { type: 'BinaryOp', op, left, right } as BinaryOpNode
    }
    return left
  }

  private parseAddSub(): AstNode {
    let left = this.parseUnary()
    while (
      !this.isAtEnd() &&
      (this.current().type === TokenType.PLUS || this.current().type === TokenType.MINUS)
    ) {
      const op = this.current().value
      this.advance()
      const right = this.parseUnary()
      left = { type: 'BinaryOp', op, left, right } as BinaryOpNode
    }
    return left
  }

  private parseUnary(): AstNode {
    if (!this.isAtEnd() && this.current().type === TokenType.MINUS) {
      this.advance()
      const operand = this.parsePostfix()
      return { type: 'UnaryOp', op: '-', operand } as UnaryOpNode
    }
    return this.parsePostfix()
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary()

    while (!this.isAtEnd()) {
      const t = this.current().type

      // 属性访问: obj.field 或 obj.method()
      if (t === TokenType.DOT) {
        this.advance()
        const field = this.consume(TokenType.IDENTIFIER).value

        // 检查是否为方法调用: obj.method(...)
        if (!this.isAtEnd() && this.current().type === TokenType.LPAREN) {
          const args = this.parseArgList()
          // 方法调用转换为 FunctionCall: method(obj, ...args)
          const objArg: FunctionArg = { key: null, value: node }
          node = {
            type: 'FunctionCall',
            name: `__method_${field}`,
            args: [objArg, ...args],
          } as FunctionCallNode
        } else {
          node = { type: 'MemberAccess', object: node, field } as MemberAccessNode
        }
        continue
      }

      // 索引访问: arr[0]
      if (t === TokenType.LBRACKET) {
        this.advance()
        const index = this.parseExpression()
        this.consume(TokenType.RBRACKET)
        node = { type: 'IndexAccess', object: node, index } as IndexAccessNode
        continue
      }

      break
    }

    return node
  }

  private parsePrimary(): AstNode {
    const token = this.current()

    switch (token.type) {
      case TokenType.STRING:
        this.advance()
        return { type: 'StringLiteral', value: token.value } as StringLiteralNode

      case TokenType.NUMBER:
        this.advance()
        return { type: 'NumberLiteral', value: Number(token.value) } as NumberLiteralNode

      case TokenType.BOOLEAN:
        this.advance()
        return { type: 'BooleanLiteral', value: token.value === 'true' } as BooleanLiteralNode

      case TokenType.IDENTIFIER: {
        this.advance()
        // 检查函数调用: name(...)
        if (!this.isAtEnd() && this.current().type === TokenType.LPAREN) {
          const args = this.parseArgList()
          return { type: 'FunctionCall', name: token.value, args } as FunctionCallNode
        }
        return { type: 'Identifier', name: token.value } as IdentifierNode
      }

      case TokenType.LBRACKET:
        return this.parseArrayLiteral()

      case TokenType.LPAREN: {
        this.advance()
        const expr = this.parseExpression()
        this.consume(TokenType.RPAREN)
        return expr
      }

      default:
        throw new Error(
          `NIT Parser: 预期表达式，得到 '${token.value}' (${token.type}) (行 ${token.line}, 列 ${token.col})`,
        )
    }
  }

  private parseArgList(): FunctionArg[] {
    this.consume(TokenType.LPAREN)
    const args: FunctionArg[] = []

    while (!this.isAtEnd() && this.current().type !== TokenType.RPAREN) {
      if (args.length > 0) this.consume(TokenType.COMMA)

      // 检查命名参数: key=value
      if (
        this.current().type === TokenType.IDENTIFIER &&
        this.peek(1)?.type === TokenType.EQUALS &&
        this.peek(2)?.type !== TokenType.EQUALS
      ) {
        const key = this.consume(TokenType.IDENTIFIER).value
        this.consume(TokenType.EQUALS)
        const value = this.parseExpression()
        args.push({ key, value })
      } else {
        // 位置参数
        const value = this.parseExpression()
        args.push({ key: null, value })
      }
    }

    this.consume(TokenType.RPAREN)
    return args
  }

  private parseArrayLiteral(): ArrayLiteralNode {
    this.consume(TokenType.LBRACKET)
    const elements: AstNode[] = []

    while (!this.isAtEnd() && this.current().type !== TokenType.RBRACKET) {
      if (elements.length > 0) this.consume(TokenType.COMMA)
      elements.push(this.parseExpression())
    }

    this.consume(TokenType.RBRACKET)
    return { type: 'ArrayLiteral', elements }
  }

  // ── 工具方法 ──

  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, col: 0 }
  }

  private peek(offset: number): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private consume(expected: TokenType): Token {
    const token = this.current()
    if (token.type !== expected) {
      throw new Error(
        `NIT Parser: 预期 ${expected}，得到 '${token.value}' (${token.type}) (行 ${token.line}, 列 ${token.col})`,
      )
    }
    return this.advance()
  }

  private skipNewlines(): void {
    while (!this.isAtEnd() && this.current().type === TokenType.NEWLINE) {
      this.advance()
    }
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length || this.current().type === TokenType.EOF
  }
}
