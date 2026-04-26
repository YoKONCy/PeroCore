import { describe, expect, it } from 'vitest'
import { NitLexer } from '@perocore/backend/nit/lexer'
import { TokenType } from '@perocore/backend/nit/types'

describe('NitLexer', () => {
  describe('tokenize', () => {
    it('应当识别关键字、标识符、字面量和常用标点', () => {
      const source = `if ready and not done {
  count = 12.5
  say("你好", target='pero')
}`
      const lexer = new NitLexer(source)

      const tokens = lexer.tokenize()

      expect(tokens.map((token) => token.type)).toEqual([
        TokenType.IF,
        TokenType.IDENTIFIER,
        TokenType.AND,
        TokenType.NOT,
        TokenType.IDENTIFIER,
        TokenType.LBRACE,
        TokenType.NEWLINE,
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.NUMBER,
        TokenType.NEWLINE,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.STRING,
        TokenType.COMMA,
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.STRING,
        TokenType.RPAREN,
        TokenType.NEWLINE,
        TokenType.RBRACE,
        TokenType.EOF,
      ])
      expect(tokens.find((token) => token.type === TokenType.NUMBER)?.value).toBe('12.5')
      expect(
        tokens.filter((token) => token.type === TokenType.STRING).map((token) => token.value),
      ).toEqual(['你好', 'pero'])
    })

    it('应当把分号视为换行并跳过单行注释', () => {
      const source = 'a = 1; // 忽略这行\nb = true'
      const lexer = new NitLexer(source)

      const tokens = lexer.tokenize()

      expect(tokens.map((token) => token.type)).toEqual([
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.NUMBER,
        TokenType.NEWLINE,
        TokenType.NEWLINE,
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.BOOLEAN,
        TokenType.EOF,
      ])
      expect(tokens.map((token) => token.value)).not.toContain('忽略这行')
      expect(tokens.at(-2)).toMatchObject({ type: TokenType.BOOLEAN, value: 'true', line: 2 })
    })

    it('应当正确解析字符串转义字符', () => {
      const source = 'text = "第一行\\n第二行\\t\\\\"'
      const lexer = new NitLexer(source)

      const tokens = lexer.tokenize()

      expect(tokens.find((token) => token.type === TokenType.STRING)?.value).toBe(
        '第一行\n第二行\t\\',
      )
    })

    it('遇到未知字符时应当抛出带位置信息的错误', () => {
      const source = 'value = 1 @'
      const lexer = new NitLexer(source)

      expect(() => lexer.tokenize()).toThrow("NIT Lexer: 未知字符 '@' (行 1, 列 11)")
    })

    it('遇到未闭合字符串时应当抛出错误', () => {
      const source = 'message = "未结束'
      const lexer = new NitLexer(source)

      expect(() => lexer.tokenize()).toThrow('NIT Lexer: 未闭合的字符串 (行 1)')
    })
  })
})
