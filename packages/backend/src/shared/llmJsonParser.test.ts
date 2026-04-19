import { describe, expect, it } from 'vitest'
import { parseLlmJson, parseLlmJsonStrict } from './llmJsonParser'

describe('parseLlmJson', () => {
  it('应当直接解析合法的 JSON 字符串', () => {
    const result = parseLlmJson<{ name: string }>('{"name":"pero"}')

    expect(result).toEqual({ name: 'pero' })
  })

  it('应当从 json 代码块中提取并解析对象', () => {
    const raw = '这是结果\n```json\n{"score": 3, "ok": true}\n```\n请查收'

    const result = parseLlmJson<{ score: number; ok: boolean }>(raw)

    expect(result).toEqual({ score: 3, ok: true })
  })

  it('应当从普通文本中提取最外层对象', () => {
    const raw = '分析完成，结构如下：{"items":[1,2,3],"total":3}，结束。'

    const result = parseLlmJson<{ items: number[]; total: number }>(raw)

    expect(result).toEqual({ items: [1, 2, 3], total: 3 })
  })

  it('应当从普通文本中提取最外层数组', () => {
    const raw = '候选标签如下：["聊天","记忆","日记"]。'

    const result = parseLlmJson<string[]>(raw)

    expect(result).toEqual(['聊天', '记忆', '日记'])
  })

  it('无法解析时应当返回 null', () => {
    const result = parseLlmJson('这不是 JSON，也没有代码块')

    expect(result).toBeNull()
  })
})

describe('parseLlmJsonStrict', () => {
  it('解析失败时应当抛出带上下文的错误', () => {
    expect(() => parseLlmJsonStrict('not-json', '提炼结果')).toThrow(
      'LLM JSON 解析失败 (提炼结果): not-json',
    )
  })
})
