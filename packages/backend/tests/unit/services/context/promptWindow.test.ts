import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../src/services/llm/types'
import { slidePromptWindow } from '../../../../src/services/context/promptWindow'
import { tokenCounter } from '../../../../src/services/tokenizer/tokenCounter'

function group(index: number): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: null,
      reasoningContent: `第 ${index} 轮思考`,
      toolCalls: ['a', 'b'].map((suffix) => ({
        id: `${index}-${suffix}`,
        type: 'function' as const,
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: `${index}-${suffix}.ts` }),
        },
      })),
    },
    ...['a', 'b'].map(
      (suffix): ChatMessage => ({
        role: 'tool',
        toolCallId: `${index}-${suffix}`,
        content: `文件 ${index}-${suffix}\n` + '原始正文'.repeat(100),
      }),
    ),
  ]
}
function paired(messages: ChatMessage[]) {
  const calls = messages.flatMap((message) => message.toolCalls ?? [])
  const results = messages.filter((message) => message.role === 'tool')
  expect(results.map((message) => message.toolCallId).sort()).toEqual(
    calls.map((call) => call.id).sort(),
  )
}

describe('逐请求自动滑动窗口', () => {
  it('一次用户输入中几百个 ReAct 组也能前移，保持最新结果及多工具关联', () => {
    const current: ChatMessage = {
      role: 'user',
      content: '持续完成任务',
      cacheControl: { kind: 'current' },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: '固定规则' },
      current,
      ...Array.from({ length: 220 }, (_, index) => group(index)).flat(),
    ]
    const count = () => tokenCounter.countMessages(messages)
    const result = slidePromptWindow(messages, 5000, count)
    expect(result.usedTokens).toBeLessThanOrEqual(5000)
    expect(result.removedMessages).toBeGreaterThan(0)
    expect(messages).toContain(current)
    expect(messages.some((message) => message.toolCallId === '219-b')).toBe(true)
    expect(messages.some((message) => message.toolCallId === '0-a')).toBe(false)
    paired(messages)
  })

  it('未超预算保持对象和顺序，不进行摘要或改写', () => {
    const messages = [{ role: 'user' as const, content: '任务' }, ...group(1)]
    const original = structuredClone(messages)
    const result = slidePromptWindow(messages, 100_000, () => tokenCounter.countMessages(messages))
    expect(result.removedMessages).toBe(0)
    expect(messages).toEqual(original)
  })

  it('不会拆散未闭合的工具批次', () => {
    const pending: ChatMessage = {
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: 'pending', type: 'function', function: { name: 'edit_file', arguments: '{}' } },
      ],
    }
    const messages: ChatMessage[] = [
      { role: 'user', content: '任务', cacheControl: { kind: 'current' } },
      ...group(1),
      ...group(2),
      pending,
    ]
    slidePromptWindow(messages, 1800, () => tokenCounter.countMessages(messages))
    expect(messages).toContain(pending)
    expect(messages.some((message) => message.toolCallId === 'pending')).toBe(false)
  })
})
