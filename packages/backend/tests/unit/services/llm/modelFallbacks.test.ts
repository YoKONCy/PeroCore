import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmService, type ModelConfig } from '../../../../src/services/llm/llmService'
import type {
  ChatCompletion,
  ChatDelta,
  ChatMessage,
  LlmProvider,
} from '../../../../src/services/llm/types'
import type { LlmUsageAttempt } from '../../../../src/services/llm/usage'
import { AppError } from '../../../../src/lib/appError'
import * as retryPolicy from '../../../../src/services/llm/retryPolicy'
import { modelFallbackIds } from '../../../../src/services/llm/modelFallbacks'

beforeEach(() => vi.spyOn(retryPolicy, 'waitForRetry').mockResolvedValue(undefined))
afterEach(() => vi.restoreAllMocks())
const primary: ModelConfig = {
  configId: 1,
  provider: 'openai',
  modelId: 'primary',
  apiKey: 'key-1',
}
const second: ModelConfig = {
  configId: 2,
  provider: 'deepseek',
  modelId: 'second',
  apiKey: 'key-2',
}
const third: ModelConfig = { configId: 3, provider: 'openai', modelId: 'third', apiKey: 'key-3' }
const success: ChatCompletion = {
  choices: [{ message: { role: 'assistant', content: '完成' }, finishReason: 'stop' }],
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
}
const failure = () =>
  new AppError('LLM_ERROR', {
    message: '模拟模型接口错误',
    data: { status: 400, retryable: false },
  })

async function collect(stream: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const result: ChatDelta[] = []
  for await (const delta of stream) result.push(delta)
  return result
}

describe('模型多级回退', () => {
  it('每级两次，成功后停止；不递归子卡片的链，保留工具历史并按真实模型入账', async () => {
    const records: LlmUsageAttempt[] = []
    const attempted: string[] = []
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'c1', content: '文件内容' },
    ]
    const chat = vi.fn(async (input: ChatMessage[], config: ModelConfig) => {
      expect(input).toEqual(messages)
      attempted.push(config.modelId)
      if (config.modelId !== 'third') throw failure()
      return success
    })
    const service = new LlmService((record) => records.push(record))
    const beforeAttempt = vi.fn(async () => {})
    vi.spyOn(service, 'createProvider').mockImplementation(
      (config) =>
        ({
          chat: (input: ChatMessage[]) => chat(input, config),
        }) as unknown as LlmProvider,
    )
    await expect(
      service.chat(
        {
          ...primary,
          fallbackModels: [
            { ...second, fallbackModels: [{ ...third, modelId: '不应展开' }] },
            third,
          ],
        },
        messages,
        {
          maxRetries: 0,
          usageContext: { threadId: 'thread-a', agentId: 'pero' },
          beforeAttempt,
        },
      ),
    ).resolves.toEqual(success)
    expect(attempted).toEqual(['primary', 'primary', 'second', 'second', 'third'])
    expect(beforeAttempt).toHaveBeenCalledTimes(5)
    expect(records.map((record) => [record.modelId, record.status, record.threadId])).toEqual([
      ['primary', 'failed', 'thread-a'],
      ['primary', 'failed', 'thread-a'],
      ['second', 'failed', 'thread-a'],
      ['second', 'failed', 'thread-a'],
      ['third', 'completed', 'thread-a'],
    ])
    expect(records.at(-1)?.usage?.totalTokens).toBe(120)
  })

  it('全部失败时终止，标明已耗尽，外层不能再乘一次整条链', async () => {
    const chat = vi.fn(async () => {
      throw failure()
    })
    const service = new LlmService()
    vi.spyOn(service, 'createProvider').mockReturnValue({ chat } as unknown as LlmProvider)
    await expect(
      service.chat({ ...primary, fallbackModels: [second, third] }, []),
    ).rejects.toMatchObject({
      data: { retryable: false, fallbackExhausted: true },
    })
    expect(chat).toHaveBeenCalledTimes(6)
  })

  it('未配置回退时保留原有不可重试错误行为', async () => {
    const chat = vi.fn(async () => {
      throw failure()
    })
    const service = new LlmService()
    vi.spyOn(service, 'createProvider').mockReturnValue({ chat } as unknown as LlmProvider)
    await expect(service.chat(primary, [], { maxRetries: 5 })).rejects.toMatchObject({
      code: 'LLM_ERROR',
      data: { status: 400 },
    })
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('退避期间停止任务，不发起下一次尝试或后继回退', async () => {
    const controller = new AbortController()
    const chat = vi.fn(async () => {
      throw failure()
    })
    vi.mocked(retryPolicy.waitForRetry).mockImplementationOnce(async () => {
      controller.abort(new Error('用户停止'))
      throw controller.signal.reason
    })
    const service = new LlmService()
    vi.spyOn(service, 'createProvider').mockReturnValue({ chat } as unknown as LlmProvider)
    await expect(
      service.chat({ ...primary, fallbackModels: [second] }, [], { signal: controller.signal }),
    ).rejects.toThrow('用户停止')
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('流式中断可重放时记录每次草稿清理，回退卡片使用自己的非流式设置与参数', async () => {
    const stream = vi.fn(async function* () {
      yield {
        choices: [{ delta: { toolCalls: [{ index: 0, function: { arguments: '{"中断' } }] } }],
      }
      throw new TypeError('fetch failed')
    })
    const chat = vi.fn(async () => success)
    const service = new LlmService()
    vi.spyOn(service, 'createProvider').mockImplementation(
      (config) =>
        (config.modelId === 'primary'
          ? { chatStream: stream }
          : { chat }) as unknown as LlmProvider,
    )
    const received = await collect(
      service.chatConfigured(
        {
          ...primary,
          temperature: 1,
          fallbackModels: [{ ...second, stream: false, temperature: 0.2, maxTokens: 1000 }],
        },
        [],
        { retryPartialResponse: true, temperature: 1, maxTokens: 2000 },
      ),
    )
    expect(stream).toHaveBeenCalledTimes(2)
    expect(chat).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ temperature: 0.2, maxTokens: 1000 }),
    )
    expect(
      received.flatMap((delta) => (delta.retry?.state === 'waiting' ? [delta.retry] : [])),
    ).toEqual([
      expect.objectContaining({
        modelId: 'primary',
        modelLevel: 1,
        modelAttempt: 2,
        partialResponse: true,
      }),
      expect.objectContaining({
        modelId: 'second',
        modelLevel: 2,
        modelAttempt: 1,
        partialResponse: true,
      }),
    ])
    expect(received.at(-1)?.choices[0]?.delta.content).toBe('完成')
  })

  it('非流式主卡也可切到流式回退卡', async () => {
    const chat = vi.fn(async () => {
      throw failure()
    })
    const stream = vi.fn(async function* () {
      yield { choices: [{ delta: { content: '完成' }, finishReason: 'stop' }] }
    })
    const service = new LlmService()
    vi.spyOn(service, 'createProvider').mockImplementation(
      (config) =>
        (config.modelId === 'primary'
          ? { chat }
          : { chatStream: stream }) as unknown as LlmProvider,
    )
    const received = await collect(
      service.chatConfigured({ ...primary, stream: false, fallbackModels: [second] }, []),
    )
    expect(chat).toHaveBeenCalledTimes(2)
    expect(stream).toHaveBeenCalledTimes(1)
    expect(received.at(-1)?.choices[0]?.delta.content).toBe('完成')
  })

  it('读取旧配置时过滤自身、重复与非法 ID，损坏数据不影响正常主模型', () => {
    expect(modelFallbackIds('[1,2,2,3,0,-1,"4",null]', 1)).toEqual([2, 3])
    expect(modelFallbackIds('{坏数据', 1)).toEqual([])
  })
})
