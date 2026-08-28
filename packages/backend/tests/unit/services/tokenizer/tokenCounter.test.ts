import { describe, expect, it } from 'vitest'
import { tokenCounter } from '../../../../src/services/tokenizer/tokenCounter'

describe('O200kTokenCounter', () => {
  it('应使用 o200k_base 对中英文与代码进行确定性计数', () => {
    expect(tokenCounter.tokenizerId).toBe('o200k_base')
    expect(tokenCounter.countTokens('hello world')).toBe(2)
    expect(tokenCounter.countTokens('你好，世界！')).toBeGreaterThan(0)
    expect(tokenCounter.countTokens('')).toBe(0)
  })

  it('应统一计算结构化消息角色与正文', () => {
    const contentOnly = tokenCounter.countTokens('你好')
    const total = tokenCounter.countMessages([{ role: 'user', content: '你好' }])
    expect(total).toBeGreaterThan(contentOnly)
  })
})
