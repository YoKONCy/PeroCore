import { describe, expect, it, vi } from 'vitest'
import { measureModelGeneration } from '@infos/backend/services/llm/generationMetrics'
import type { ChatDelta } from '@infos/backend/services/llm/types'

describe('对话输出统计', () => {
  it('每次实际请求分别计数，退避等待不计入生成耗时', async () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const retry = {
      retryId: 'r1',
      state: 'waiting' as const,
      attempt: 1,
      maxRetries: 5,
      reason: '断开',
      delayMs: 1000,
      startedAt: 1,
      updatedAt: 1,
      partialResponse: true,
    }
    async function* deltas(): AsyncGenerator<ChatDelta> {
      now = 100
      yield { choices: [], retry }
      now = 1100
      yield { choices: [], retry: { ...retry, state: 'retrying' } }
      now = 1300
      yield { choices: [{ delta: { content: '完成' }, finishReason: 'stop' }] }
    }
    const measured = vi.fn()
    try {
      for await (const delta of measureModelGeneration(deltas(), () => 2, measured)) void delta
      expect(measured.mock.calls.map(([stats]) => stats.modelCalls)).toEqual([1, 1])
      expect(measured.mock.calls.map(([stats]) => stats.modelDurationMs)).toEqual([100, 200])
    } finally {
      clock.mockRestore()
    }
  })
  it('明确上报的零输出不能被本地估算替换', async () => {
    async function* deltas(): AsyncGenerator<ChatDelta> {
      yield { choices: [], usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 } }
    }
    const estimate = vi.fn(() => 99)
    const measured = vi.fn()
    for await (const delta of measureModelGeneration(deltas(), estimate, measured)) {
      expect(delta).toHaveProperty('choices')
    }
    expect(estimate).not.toHaveBeenCalled()
    expect(measured).toHaveBeenCalledWith(
      expect.objectContaining({ outputTokens: 0, estimated: false }),
    )
  })

  it('上游中断且未上报输出时，保留已生成部分的估算用量', async () => {
    async function* deltas(): AsyncGenerator<ChatDelta> {
      yield { choices: [{ delta: { content: '部分正文' } }] }
      throw new Error('连接中断')
    }
    const measured = vi.fn()
    const consume = async () => {
      for await (const delta of measureModelGeneration(deltas(), () => 7, measured)) {
        expect(delta).toHaveProperty('choices')
      }
    }
    await expect(consume()).rejects.toThrow('连接中断')
    expect(measured).toHaveBeenCalledWith(
      expect.objectContaining({ outputTokens: 7, estimated: true }),
    )
  })
})
