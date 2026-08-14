import { describe, expect, it } from 'vitest'
import { NitLexer } from '@infos/backend/nit/lexer'
import { NitParser } from '@infos/backend/nit/parser'

function parseSource(source: string) {
  const tokens = new NitLexer(source).tokenize()
  return new NitParser(tokens).parse()
}

describe('NitParser', () => {
  describe('parse', () => {
    it('应当解析赋值、函数调用、命名参数和返回语句', () => {
      const source = `name = "pero"
say(name, mood="happy")
return name`

      const program = parseSource(source)

      expect(program).toEqual({
        type: 'Program',
        body: [
          {
            type: 'Assignment',
            name: 'name',
            value: { type: 'StringLiteral', value: 'pero' },
          },
          {
            type: 'FunctionCall',
            name: 'say',
            args: [
              { key: null, value: { type: 'Identifier', name: 'name' } },
              { key: 'mood', value: { type: 'StringLiteral', value: 'happy' } },
            ],
          },
          {
            type: 'Return',
            value: { type: 'Identifier', name: 'name' },
          },
        ],
      })
    })

    it('应当按照表达式优先级解析逻辑、比较和加减运算', () => {
      const source = 'return not a == 1 + -2 or b != 3 and c <= 4'

      const program = parseSource(source)

      expect(program.body[0]).toEqual({
        type: 'Return',
        value: {
          type: 'BinaryOp',
          op: 'or',
          left: {
            type: 'UnaryOp',
            op: 'not',
            operand: {
              type: 'BinaryOp',
              op: '==',
              left: { type: 'Identifier', name: 'a' },
              right: {
                type: 'BinaryOp',
                op: '+',
                left: { type: 'NumberLiteral', value: 1 },
                right: { type: 'UnaryOp', op: '-', operand: { type: 'NumberLiteral', value: 2 } },
              },
            },
          },
          right: {
            type: 'BinaryOp',
            op: 'and',
            left: {
              type: 'BinaryOp',
              op: '!=',
              left: { type: 'Identifier', name: 'b' },
              right: { type: 'NumberLiteral', value: 3 },
            },
            right: {
              type: 'BinaryOp',
              op: '<=',
              left: { type: 'Identifier', name: 'c' },
              right: { type: 'NumberLiteral', value: 4 },
            },
          },
        },
      })
    })

    it('应当解析条件、循环、并行和异常捕获语句块', () => {
      const source = `if ready {
  for item in items {
    parallel {
      handle(item)
      audit(item)
    }
  }
} else {
  try {
    recover()
  } catch {
    report(false)
  }
}`

      const program = parseSource(source)

      expect(program.body).toHaveLength(1)
      expect(program.body[0]).toMatchObject({
        type: 'If',
        condition: { type: 'Identifier', name: 'ready' },
        then: [
          {
            type: 'For',
            variable: 'item',
            iterable: { type: 'Identifier', name: 'items' },
            body: [
              {
                type: 'Parallel',
                expressions: [
                  { type: 'FunctionCall', name: 'handle' },
                  { type: 'FunctionCall', name: 'audit' },
                ],
              },
            ],
          },
        ],
        else: [
          {
            type: 'TryCatch',
            tryBlock: [{ type: 'FunctionCall', name: 'recover' }],
            catchBlock: [{ type: 'FunctionCall', name: 'report' }],
          },
        ],
      })
    })

    it('应当解析数组、成员访问、索引访问和方法调用', () => {
      const source = 'return user.friends[0].send([true, false], text="hi")'

      const program = parseSource(source)

      expect(program.body[0]).toEqual({
        type: 'Return',
        value: {
          type: 'FunctionCall',
          name: '__method_send',
          args: [
            {
              key: null,
              value: {
                type: 'IndexAccess',
                object: {
                  type: 'MemberAccess',
                  object: { type: 'Identifier', name: 'user' },
                  field: 'friends',
                },
                index: { type: 'NumberLiteral', value: 0 },
              },
            },
            {
              key: null,
              value: {
                type: 'ArrayLiteral',
                elements: [
                  { type: 'BooleanLiteral', value: true },
                  { type: 'BooleanLiteral', value: false },
                ],
              },
            },
            { key: 'text', value: { type: 'StringLiteral', value: 'hi' } },
          ],
        },
      })
    })

    it('语法缺失时应当抛出包含期望 Token 的错误', () => {
      const source = 'if ready { say("hi")'

      expect(() => parseSource(source)).toThrow('NIT Parser: 预期 RBRACE')
    })
  })
})
