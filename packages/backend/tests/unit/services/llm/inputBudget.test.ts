import { describe, expect, it } from 'vitest'
import { LlmService } from '@infos/backend/services/llm/llmService'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'
import {
  appendNativeReasoning,
  compactNativeReasoning,
} from '@infos/backend/services/llm/reasoning'
import type { ChatMessage, NativeReasoningPayload } from '@infos/backend/services/llm/types'

describe('模型实际输入预算', () => {
  const config = { provider: 'openai', modelId: 'test-model', apiKey: '' }

  // 真实 WASM 分词保留四千分片，单独设置时限以适配共享 CPU 的 CI 环境。
  it('相同思考不因流式分包数量不同而增加输入预算', () => {
    const service = new LlmService()
    const text = '思考片段'.repeat(4000)
    const base: ChatMessage[] = [
      { role: 'user', content: '继续' },
      {
        role: 'assistant',
        content: '准备执行',
        reasoningContent: text,
      },
    ]
    const fragmented: ChatMessage[] = structuredClone(base)
    fragmented[1]!.nativeReasoning = Array.from({ length: 4000 }, () => ({
      format: 'reasoning_content',
      text: '思考片段',
    }))
    expect(service.estimateInputTokens(config, fragmented)).toBe(
      service.estimateInputTokens(config, base),
    )
    // 预算预览只读取输入，不删除运行中的消息字段。
    expect(fragmented[1]!.nativeReasoning).toHaveLength(4000)
  }, 20_000)

  it('纯文本思考只保留一份，协议推理块合并文字但保留签名', () => {
    const blocks: NativeReasoningPayload[] = []
    appendNativeReasoning(blocks, [
      { format: 'reasoning_content', text: '重复展示文本' },
      { format: 'reasoning_details', opaque: [{ type: 'reasoning.text', index: 0, text: '前半' }] },
    ])
    appendNativeReasoning(blocks, [
      {
        format: 'reasoning_details',
        opaque: [{ type: 'reasoning.text', index: 0, text: '后半', signature: '协议签名' }],
      },
    ])
    expect(blocks).toEqual([
      {
        format: 'reasoning_details',
        opaque: [{ type: 'reasoning.text', index: 0, text: '前半后半', signature: '协议签名' }],
      },
    ])
    expect(compactNativeReasoning(blocks)).toEqual(blocks)
  })

  it('工具结果配对和回传思考完整保留，预算投影不包含内部重复包装', () => {
    const provider = new OpenAiProvider({
      modelId: 'test-model',
      apiKey: '',
      apiBase: 'https://model.invalid',
    })
    const payload = provider.getInputTokenPayload(
      [
        { role: 'system', content: '系统指令' },
        { role: 'user', content: '读取文件' },
        {
          role: 'assistant',
          content: null,
          reasoningContent: '需要读文件',
          nativeReasoning: [{ format: 'reasoning_content', text: '需要读文件' }],
          toolCalls: [
            { id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
        },
        { role: 'tool', toolCallId: 'read-1', content: '文件内容' },
      ],
      {},
    )
    const messages = payload.messages as Array<Record<string, unknown>>
    expect(messages[2]?.reasoning_content).toBe('需要读文件')
    expect(messages[2]).not.toHaveProperty('nativeReasoning')
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'read-1', content: '文件内容' })
  })
})
