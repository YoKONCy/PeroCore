import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareBuiltinTask } from '@infos/backend/services/prompt/taskPrompts'
import {
  normalizeKnowledgeText,
  decodeKnowledgeText,
} from '@infos/backend/services/knowledge/knowledgeText'
import {
  knowledgeAnchors,
  organizeKnowledge,
  parseKnowledgeParts,
} from '@infos/backend/services/knowledge/knowledgeOrganizer'
import { tokenCounter } from '@infos/backend/services/tokenizer/tokenCounter'
import type { LlmService, ModelConfig } from '@infos/backend/services/llm/llmService'

const content = '第一章：参数与限制。\n\n第二章：使用流程。'
const model: ModelConfig = {
  provider: 'openai',
  modelId: 'knowledge-model',
  apiKey: 'key',
  contextWindowTokens: 32_000,
}
const part = (start: number, end: number) => ({
  start,
  end,
  title: '资料',
  summary: '参数、限制与使用流程。',
  keywords: ['参数', '使用流程'],
})
afterEach(() => vi.restoreAllMocks())

describe('文档知识入库边界', () => {
  it('400K Token 可入库，超过 400K 返回输入错误', () => {
    const count = vi.spyOn(tokenCounter, 'countTokens').mockReturnValue(400_000)
    expect(normalizeKnowledgeText('\uFEFF资料\r\n正文').content).toBe('资料\n正文')
    count.mockReturnValue(400_001)
    expect(() => normalizeKnowledgeText('资料')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })

  it('无效 UTF-8 与二进制不会作为文字进入整理模型', () => {
    expect(() => decodeKnowledgeText(new Uint8Array([0xc3, 0x28]))).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
    expect(() => normalizeKnowledgeText('资料\0数据')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })

  it('9999 Token 时即使模型尝试切分，也拒绝发布多个部分', async () => {
    const chatText = vi.fn().mockResolvedValue(JSON.stringify({ parts: [part(1, 1), part(2, 2)] }))
    await expect(
      organizeKnowledge(
        { chatText, preparePromptMessages: prepareBuiltinTask } as unknown as LlmService,
        model,
        '资料',
        content,
        9999,
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })

  it('短文可在模型纠正无效分段后整篇入库', async () => {
    const chatText = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ parts: [part(1, 1), part(2, 2)] }))
      .mockResolvedValueOnce(JSON.stringify({ parts: [part(1, 2)] }))
    const llm = { chatText, preparePromptMessages: prepareBuiltinTask } as unknown as LlmService
    const short = await organizeKnowledge(
      llm,
      model,
      '资料',
      content,
      9999,
      new AbortController().signal,
    )
    expect(short).toHaveLength(1)
    expect(content.slice(short[0]!.startOffset, short[0]!.endOffset)).toBe(content)
  })

  it('10000 Token 起允许语义分段，原文必须完整且不重复', async () => {
    const chatText = vi.fn().mockResolvedValue(JSON.stringify({ parts: [part(1, 1), part(2, 2)] }))
    const long = await organizeKnowledge(
      { chatText, preparePromptMessages: prepareBuiltinTask } as unknown as LlmService,
      model,
      '资料',
      content,
      10_000,
      new AbortController().signal,
    )
    expect(long).toHaveLength(2)
    expect(long.map((p) => content.slice(p.startOffset, p.endOffset)).join('')).toBe(content)
  })

  it.each([[part(1, 1)], [part(1, 1), part(1, 2)], [part(2, 2)]])(
    '拒绝缺尾、重叠或缺头的分段范围',
    (...parts) => {
      expect(() =>
        parseKnowledgeParts(JSON.stringify({ parts }), content, knowledgeAnchors(content), false),
      ).toThrow()
    },
  )

  it('长段落的定位锚点不会切断 Unicode 字符，也不会变成强制碎片', () => {
    const original = '甲'.repeat(1999) + '😀' + '乙'.repeat(100)
    const anchors = knowledgeAnchors(original)
    const parts = parseKnowledgeParts(
      JSON.stringify({ parts: [part(1, anchors.length)] }),
      original,
      anchors,
      true,
    )
    expect(anchors.map((a) => a.text).join('')).toBe(original)
    expect(anchors.every((a) => !/[\uD800-\uDBFF]$/.test(a.text))).toBe(true)
    expect(parts).toHaveLength(1)
    expect(original.slice(parts[0]!.startOffset, parts[0]!.endOffset)).toBe(original)
  })

  it('模型窗口不足时不会先发起付费整理请求', async () => {
    const chatText = vi.fn()
    await expect(
      organizeKnowledge(
        { chatText, preparePromptMessages: prepareBuiltinTask } as unknown as LlmService,
        { ...model, contextWindowTokens: 100 },
        '资料',
        content,
        10_000,
        new AbortController().signal,
      ),
    ).rejects.toThrow(Error)
    expect(chatText).not.toHaveBeenCalled()
  })
})
