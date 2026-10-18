import { describe, expect, it } from 'vitest'
import { AnthropicProvider } from '@infos/backend/services/llm/providers/anthropicProvider'
import { OpenAiResponsesProvider } from '@infos/backend/services/llm/providers/openaiResponsesProvider'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'
import { GeminiProvider } from '@infos/backend/services/llm/providers/geminiProvider'
import type { ChatMessage } from '@infos/backend/services/llm/types'

const config = { apiKey: 'test', apiBase: 'https://api.test', modelId: 'test-model' }
const first = Buffer.from('第一张原始字节').toString('base64')
const second = Buffer.from('第二张原始字节').toString('base64')
const messages: ChatMessage[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: '比较前后两张图片' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${first}`, detail: 'high' } },
      { type: 'image_url', image_url: { url: `data:image/webp;base64,${second}`, detail: 'high' } },
    ],
  },
]

describe('各协议的多图原始字节交付', () => {
  it('Anthropic 应输出图片内容块，不能静默丢掉数组消息', () => {
    const payload = new AnthropicProvider(config).getInputTokenPayload(messages, {})
    expect(payload.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '比较前后两张图片' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: first } },
          { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: second } },
        ],
      },
    ])
  })
  it('Responses 应使用原生输入块，并保留高细节选项', () => {
    const payload = new OpenAiResponsesProvider(config).getInputTokenPayload(messages, {})
    expect(payload.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '比较前后两张图片' },
          { type: 'input_image', image_url: `data:image/png;base64,${first}`, detail: 'high' },
          { type: 'input_image', image_url: `data:image/webp;base64,${second}`, detail: 'high' },
        ],
      },
    ])
  })
  it.each([OpenAiProvider, GeminiProvider])('已有协议仍完整交付每一张原图', (Provider) => {
    const payload = new Provider(config).getInputTokenPayload(messages, {})
    const json = JSON.stringify(payload)
    expect(json).toContain(first)
    expect(json).toContain(second)
  })
})
