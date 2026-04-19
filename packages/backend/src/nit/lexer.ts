/**
 * NIT v3 Lexer — 词法分析器
 *
 * 将 NIT 脚本文本转换为 Token 流。
 * 纯 TS 实现，替代 v1 的 Python + Rust 双轨 Lexer。
 *
 * @module packages/backend/src/nit/lexer
 */

import { TokenType, type Token } from './types'

/** 关键字映射 */
const KEYWORDS: Record<string, TokenType> = {
  if: TokenType.IF,
  else: TokenType.ELSE,
  for: TokenType.FOR,
  in: TokenType.IN,
  parallel: TokenType.PARALLEL,
  try: TokenType.TRY,
  catch: TokenType.CATCH,
  return: TokenType.RETURN,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  true: TokenType.BOOLEAN,
  false: TokenType.BOOLEAN,
}

export class NitLexer {
  private pos = 0
  private line = 1
  private col = 1
  private tokens: Token[] = []

  constructor(private source: string) {}

  /** 词法分析，返回 Token 列表 */
  tokenize(): Token[] {
    this.tokens = []
    this.pos = 0
    this.line = 1
    this.col = 1

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]!

      // 跳过空格和制表符
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance()
        continue
      }

      // 跳过注释 (// 单行)
      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.advance()
        }
        continue
      }

      // 换行
      if (ch === '\n') {
        this.pushToken(TokenType.NEWLINE, '\\n')
        this.advance()
        this.line++
        this.col = 1
        continue
      }

      // 分号 (等价换行)
      if (ch === ';') {
        this.pushToken(TokenType.NEWLINE, ';')
        this.advance()
        continue
      }

      // 字符串
      if (ch === '"' || ch === "'") {
        this.readString(ch)
        continue
      }

      // 数字
      if (ch >= '0' && ch <= '9') {
        this.readNumber()
        continue
      }

      // 标识符 / 关键字
      if (this.isIdentStart(ch)) {
        this.readIdentifier()
        continue
      }

      // 双字符运算符
      const next = this.peek(1)
      if (ch === '=' && next === '=') {
        this.pushToken(TokenType.EQ, '==')
        this.advance()
        this.advance()
        continue
      }
      if (ch === '!' && next === '=') {
        this.pushToken(TokenType.NEQ, '!=')
        this.advance()
        this.advance()
        continue
      }
      if (ch === '<' && next === '=') {
        this.pushToken(TokenType.LTE, '<=')
        this.advance()
        this.advance()
        continue
      }
      if (ch === '>' && next === '=') {
        this.pushToken(TokenType.GTE, '>=')
        this.advance()
        this.advance()
        continue
      }

      // 单字符运算符
      switch (ch) {
        case '=':
          this.pushToken(TokenType.EQUALS, '=')
          break
        case '(':
          this.pushToken(TokenType.LPAREN, '(')
          break
        case ')':
          this.pushToken(TokenType.RPAREN, ')')
          break
        case '{':
          this.pushToken(TokenType.LBRACE, '{')
          break
        case '}':
          this.pushToken(TokenType.RBRACE, '}')
          break
        case '[':
          this.pushToken(TokenType.LBRACKET, '[')
          break
        case ']':
          this.pushToken(TokenType.RBRACKET, ']')
          break
        case ',':
          this.pushToken(TokenType.COMMA, ',')
          break
        case '.':
          this.pushToken(TokenType.DOT, '.')
          break
        case '+':
          this.pushToken(TokenType.PLUS, '+')
          break
        case '-':
          this.pushToken(TokenType.MINUS, '-')
          break
        case '<':
          this.pushToken(TokenType.LT, '<')
          break
        case '>':
          this.pushToken(TokenType.GT, '>')
          break
        default:
          throw new Error(`NIT Lexer: 未知字符 '${ch}' (行 ${this.line}, 列 ${this.col})`)
      }
      this.advance()
    }

    this.pushToken(TokenType.EOF, '')
    return this.tokens
  }

  // ── 内部方法 ──

  private advance(): void {
    this.pos++
    this.col++
  }

  private peek(offset: number): string {
    return this.source[this.pos + offset] ?? ''
  }

  private pushToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, col: this.col })
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= '0' && ch <= '9')
  }

  private readString(quote: string): void {
    const startCol = this.col
    this.advance() // 跳过开引号
    let value = ''
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === '\\') {
        this.advance()
        const escaped = this.source[this.pos]
        switch (escaped) {
          case 'n':
            value += '\n'
            break
          case 't':
            value += '\t'
            break
          case '\\':
            value += '\\'
            break
          default:
            value += escaped ?? ''
            break
        }
      } else {
        value += this.source[this.pos]
      }
      this.advance()
    }
    if (this.pos >= this.source.length) {
      throw new Error(`NIT Lexer: 未闭合的字符串 (行 ${this.line})`)
    }
    this.advance() // 跳过闭引号
    this.tokens.push({ type: TokenType.STRING, value, line: this.line, col: startCol })
  }

  private readNumber(): void {
    const startCol = this.col
    let value = ''
    while (
      this.pos < this.source.length &&
      ((this.source[this.pos]! >= '0' && this.source[this.pos]! <= '9') ||
        this.source[this.pos] === '.')
    ) {
      value += this.source[this.pos]
      this.advance()
    }
    this.tokens.push({ type: TokenType.NUMBER, value, line: this.line, col: startCol })
  }

  private readIdentifier(): void {
    const startCol = this.col
    let value = ''
    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos]!)) {
      value += this.source[this.pos]
      this.advance()
    }
    const kwType = KEYWORDS[value]
    if (kwType) {
      this.tokens.push({ type: kwType, value, line: this.line, col: startCol })
    } else {
      this.tokens.push({ type: TokenType.IDENTIFIER, value, line: this.line, col: startCol })
    }
  }
}
