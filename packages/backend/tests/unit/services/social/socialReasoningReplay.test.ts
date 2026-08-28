import { describe, expect, it, vi } from 'vitest'
import { SocialAppCompiler } from '@infos/social/runtime/compiler'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'
import type { ChatMessage } from '@infos/backend/applicationHostAbi'

const model = {
  provider: 'openai',
  modelId: 'deepseek-reasoner',
  apiKey: 'key',
  reasoningDialect: 'deepseek',
}

function createCompiler(chat: ReturnType<typeof vi.fn>) {
  const compiler = new SocialAppCompiler({} as never, {} as never, {} as never, {} as never)
  compiler.setLlmService({ chat } as never)
  return compiler
}

describe('Social严格思考模型ReAct续轮', () => {
  it('首轮工具调用后应原样回放reasoning_content和原生思考结构', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoningContent: '需要查询联系人。',
              nativeReasoning: [{ format: 'reasoning_content', text: '需要查询联系人。' }],
              toolCalls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'social_get_contacts', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: '查询完成。' } }],
      })
    const compiler = createCompiler(chat)

    await expect(
      compiler.generateReply(
        [
          { role: 'system', content: '<persona>测试</persona>' },
          { role: 'user', content: '查询联系人' },
        ],
        model,
        {
          tools: [
            {
              type: 'function',
              function: {
                name: 'social_get_contacts',
                description: '查询联系人',
                parameters: { type: 'object' },
              },
            },
          ],
          toolExecutor: vi.fn().mockResolvedValue('{"contacts":[]}'),
        },
      ),
    ).resolves.toBe('查询完成。')

    const secondMessages = chat.mock.calls[1]![1] as ChatMessage[]
    expect(secondMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoningContent: '需要查询联系人。',
          nativeReasoning: [{ format: 'reasoning_content', text: '需要查询联系人。' }],
          toolCalls: [expect.objectContaining({ id: 'call-1' })],
        }),
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call-1',
          content: '{"contacts":[]}',
        }),
      ]),
    )

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '完成' } }],
      }),
      text: vi.fn(),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await new OpenAiProvider({
        apiKey: 'key',
        apiBase: 'https://deepseek.example/v1',
        modelId: 'deepseek-reasoner',
        reasoningDialect: 'deepseek',
      }).chat(secondMessages, {})
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as {
        messages: Array<Record<string, unknown>>
      }
      expect(body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            reasoning_content: '需要查询联系人。',
            tool_calls: [expect.objectContaining({ id: 'call-1' })],
          }),
        ]),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('后续ReAct轮产生新工具调用时也应保留本轮思考内容', async () => {
    const toolCall = (id: string, name: string) => ({
      id,
      type: 'function' as const,
      function: { name, arguments: '{}' },
    })
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoningContent: '第一步。',
              toolCalls: [toolCall('call-1', 'first_tool')],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              reasoningContent: '第二步。',
              nativeReasoning: [{ format: 'reasoning_content', text: '第二步。' }],
              toolCalls: [toolCall('call-2', 'second_tool')],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: '全部完成。' } }],
      })
    const compiler = createCompiler(chat)

    await compiler.generateReply(
      [
        { role: 'system', content: '系统' },
        { role: 'user', content: '执行任务' },
      ],
      model,
      {
        tools: [
          {
            type: 'function',
            function: { name: 'first_tool', description: '第一步', parameters: {} },
          },
          {
            type: 'function',
            function: { name: 'second_tool', description: '第二步', parameters: {} },
          },
        ],
        toolExecutor: vi.fn().mockResolvedValue('{"success":true}'),
      },
    )

    const thirdMessages = chat.mock.calls[2]![1] as ChatMessage[]
    expect(thirdMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoningContent: '第二步。',
          nativeReasoning: [{ format: 'reasoning_content', text: '第二步。' }],
          toolCalls: [expect.objectContaining({ id: 'call-2' })],
        }),
      ]),
    )
  })
})
