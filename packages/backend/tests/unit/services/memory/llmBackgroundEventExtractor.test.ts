import { describe, expect, it, vi } from 'vitest'
import { LlmBackgroundEventExtractor } from '@infos/backend/services/memory/llmBackgroundEventExtractor'
import type { BackgroundEventExtractor } from '@infos/backend/services/memory/eventMemoryFallbackService'
import type { LlmService, ModelConfig } from '@infos/backend/services/llm/llmService'

const input: Parameters<BackgroundEventExtractor['extract']>[0] = {
  agentId: 'pero',
  threadId: 'thread-1',
  channel: 'desktop',
  messages: [
    {
      role: 'user',
      content: '以后每周一起复盘工作。',
      timestamp: '2026-10-17T04:00:00.000Z',
      pairId: 'pair-1',
    },
  ],
}

const draft = {
  narrative: '我和用户约定以后每周一起复盘工作。',
  importance: 6,
  affect: { tones: ['期待'], valence: 7, arousal: 4 },
  participants: ['用户'],
  places: [],
  objects: [],
  topics: ['工作复盘'],
}

function fixture(response: unknown) {
  const chatText = vi.fn().mockResolvedValue(JSON.stringify(response))
  const extractor = new LlmBackgroundEventExtractor(
    { chatText } as unknown as LlmService,
    async (): Promise<ModelConfig> => ({
      provider: 'openai',
      modelId: 'memory-model',
      apiKey: '测试密钥',
    }),
  )
  return { extractor, chatText }
}

describe('后台事件提炼结果规范化', () => {
  it('保留完整的嵌套情感信息', async () => {
    const { extractor } = fixture([draft])
    await expect(extractor.extract(input)).resolves.toEqual([draft])
  })

  it('将数字字符串和小数规范化为范围内整数', async () => {
    const { extractor } = fixture([
      { ...draft, importance: '6.4', affect: { tones: [], valence: '7.6', arousal: 12.4 } },
      { ...draft, affect: { valence: -1, arousal: '0' } },
    ])
    const result = await extractor.extract(input)
    expect(result[0]).toMatchObject({
      importance: 6,
      affect: { tones: [], valence: 8, arousal: 10 },
    })
    expect(result[1]?.affect).toEqual({ tones: [], valence: 0, arousal: 0 })
  })

  it('将模型放在顶层的情感字段收进affect', async () => {
    const { extractor } = fixture([
      { ...draft, affect: undefined, tones: ['期待'], valence: '7', arousal: 4 },
    ])
    await expect(extractor.extract(input)).resolves.toEqual([draft])
  })

  it('缺失情绪时使用中性和平静值，不使整批补记失败', async () => {
    const { extractor } = fixture([
      { ...draft, affect: undefined },
      { ...draft, affect: { valence: 6 } },
    ])
    const result = await extractor.extract(input)
    expect(result[0]?.affect).toEqual({ tones: [], valence: 5, arousal: 0 })
    expect(result[1]?.affect).toEqual({ tones: [], valence: 6, arousal: 0 })
  })

  it.each(['', '高兴', true, [], {}])('拒绝无效情感数值：%j', async (valence) => {
    const { extractor } = fixture([{ ...draft, affect: { valence, arousal: 4 } }])
    await expect(extractor.extract(input)).rejects.toThrow('affect.valence')
  })

  it.each(['高兴', [], false])('拒绝非对象的affect：%j', async (affect) => {
    const { extractor } = fixture([{ ...draft, affect }])
    await expect(extractor.extract(input)).rejects.toThrow('情感字段格式无效')
  })

  it.each([
    { ...draft, narrative: '' },
    { ...draft, importance: null },
  ])('拒绝缺失的核心记忆字段', async (value) => {
    const { extractor } = fixture([value])
    await expect(extractor.extract(input)).rejects.toThrow('后台事件补记')
  })

  it('没有事件时保留空结果', async () => {
    const { extractor } = fixture([])
    await expect(extractor.extract(input)).resolves.toEqual([])
  })

  it('模型调用期间取消后不再接收迟到结果', async () => {
    const controller = new AbortController()
    const { extractor, chatText } = fixture([draft])
    chatText.mockImplementationOnce(async () => {
      controller.abort()
      return JSON.stringify([draft])
    })
    await expect(extractor.extract({ ...input, signal: controller.signal })).rejects.toThrow()
  })
})
