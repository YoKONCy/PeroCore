import { describe, expect, it, vi } from 'vitest'
import { SocialAppCompiler } from '@infos/social/runtime/compiler'
import type { SocialGenerationOptions } from '@infos/social/runtime/socialGeneration'
import { finishSocialTurn, runSocialRecovery } from '@infos/social/runtime/socialRecovery'
import type { SocialTurnRecord } from '@infos/shared'
import type { ChatMessage, ChatOptions, ToolDefinition } from '@infos/backend/applicationHostAbi'

const model = { provider: 'openai' as const, modelId: 'social-test', apiKey: 'key' }
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: { name: 'social', description: '社交工具', parameters: { type: 'object' } },
  },
]
const input: ChatMessage[] = [
  { role: 'system', content: '当前角色：可洛米' },
  { role: 'user', content: '处理当前群聊' },
]

const entryTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'social_act',
      description: '统一入口',
      parameters: { type: 'object' },
    },
  },
]

function entryReply(index: number) {
  const response = toolReply(index, { reply: `第${index}段` })
  response.choices[0]!.message.toolCalls[0]!.function.name = 'social_act'
  return response
}

describe('社交入口协议的 ReAct 接入', () => {
  it('迁移旧版执行中断的工具时补齐未知结果，不通过新入口盲目重放', async () => {
    const record = recoveryRecord()
    const interrupted = {
      id: 'legacy',
      type: 'function' as const,
      function: { name: 'social', arguments: '{"action":"poke"}' },
    }
    record.checkpoint.generation = {
      messages: [
        ...structuredClone(input),
        {
          role: 'assistant',
          content: null,
          toolCalls: [interrupted],
          reasoningContent: '此前的工具调用',
        },
      ],
      round: 1,
      index: 0,
      pending: [interrupted],
      toolStarted: true,
      retries: 0,
      continuations: 0,
      prefix: '',
    }
    const chat = vi.fn().mockResolvedValueOnce(entryReply(2))
    const execute = vi.fn().mockResolvedValue('{"success":true,"status":"completed"}')
    await runSocialRecovery(recovery(record), () =>
      compiler(chat).generateReply(structuredClone(input), model, {
        tools: entryTools,
        orchestrationTool: 'social_act',
        toolExecutor: execute,
      }),
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toBe('social_act')
    expect(execute.mock.calls[0]?.[3]).toEqual({ closing: true })
    expect(record.generationSummary?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'social', status: 'unknown' })]),
    )
  })

  it('入口完成即结束，不追加一次模型请求，也不回退到普通文字发送', async () => {
    const chat = vi.fn().mockResolvedValue(entryReply(1))
    const execute = vi.fn().mockResolvedValue('{"success":true,"status":"completed"}')
    expect(
      await compiler(chat).generateReply(structuredClone(input), model, {
        tools: entryTools,
        orchestrationTool: 'social_act',
        toolExecutor: execute,
      }),
    ).toBe('')
    expect(chat).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('未调用入口的普通文字只做有限纠正，不作为可发送回复返回', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(textReply('这段不能直接发送'))
      .mockResolvedValueOnce(entryReply(2))
    const execute = vi.fn().mockResolvedValue('{"success":true,"status":"completed"}')
    expect(
      await compiler(chat).generateReply(structuredClone(input), model, {
        tools: entryTools,
        orchestrationTool: 'social_act',
        toolExecutor: execute,
      }),
    ).toBe('')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('入口参数异常成为工具观察，模型仍可再次调用入口修正', async () => {
    const chat = vi.fn().mockResolvedValueOnce(entryReply(1)).mockResolvedValueOnce(entryReply(2))
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('参数无效'))
      .mockResolvedValueOnce('{"success":true,"status":"completed"}')
    const record = recoveryRecord()
    await runSocialRecovery(recovery(record), () =>
      compiler(chat).generateReply(structuredClone(input), model, {
        tools: entryTools,
        orchestrationTool: 'social_act',
        toolExecutor: execute,
      }),
    )
    expect(execute).toHaveBeenCalledTimes(2)
    const state = record.checkpoint.generation as { messages: ChatMessage[] }
    expect(
      state.messages.some(
        (message) =>
          message.role === 'tool' && String(message.content).includes('SOCIAL_ACT_INVALID'),
      ),
    ).toBe(true)
  })

  it('业务轮次耗尽后入口仍开放，执行器收到收尾标记', async () => {
    const chat = vi.fn()
    for (let i = 1; i <= 6; i++) chat.mockResolvedValueOnce(entryReply(i))
    const execute = vi.fn()
    for (let i = 1; i <= 5; i++)
      execute.mockResolvedValueOnce('{"success":true,"status":"continue"}')
    execute.mockResolvedValueOnce('{"success":true,"status":"completed"}')
    await compiler(chat).generateReply(structuredClone(input), model, {
      tools: entryTools,
      orchestrationTool: 'social_act',
      toolExecutor: execute,
    })
    expect(execute.mock.calls[5]?.[3]).toEqual({ closing: true })
    expect(chat.mock.calls[5]?.[2]).toMatchObject({ tools: entryTools, toolChoice: 'auto' })
  })

  it('托管等待后恢复同一个调用，不重新请求模型或丢失原生工具配对', async () => {
    const chat = vi.fn().mockResolvedValueOnce(entryReply(1))
    const execute = vi
      .fn()
      .mockResolvedValueOnce('{"success":true,"status":"waiting"}')
      .mockResolvedValueOnce('{"success":true,"status":"completed"}')
    const record = recoveryRecord()
    const generateEntry = () =>
      runSocialRecovery(recovery(record), () =>
        compiler(chat).generateReply(structuredClone(input), model, {
          tools: entryTools,
          orchestrationTool: 'social_act',
          toolExecutor: execute,
        }),
      )
    await generateEntry()
    expect((record.checkpoint.generation as { pending?: unknown[] }).pending).toHaveLength(1)
    await generateEntry()
    expect(chat).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[0]?.[2]).toBe(execute.mock.calls[1]?.[2])
    const state = record.checkpoint.generation as { messages: ChatMessage[] }
    expect(state.messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })
})

function toolReply(
  index: number,
  args: Record<string, unknown> = { action: 'history_get', index },
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          reasoningContent: `第 ${index} 步`,
          toolCalls: [
            {
              id: `call-${index}`,
              type: 'function',
              function: { name: 'social', arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  }
}

function textReply(content: string, finishReason = 'stop') {
  return { choices: [{ message: { role: 'assistant', content }, finishReason }] }
}

function compiler(chat: ReturnType<typeof vi.fn>) {
  const instance = new SocialAppCompiler({} as never, {} as never, {} as never, {} as never)
  instance.setLlmService({ chat, estimateInputTokens: () => 100 } as never)
  return instance
}

function generate(
  chat: ReturnType<typeof vi.fn>,
  execute: NonNullable<SocialGenerationOptions['toolExecutor']>,
) {
  return compiler(chat).generateReply(structuredClone(input), model, {
    tools,
    toolExecutor: execute,
  })
}

function recovery(record: SocialTurnRecord) {
  return { record, signal: new AbortController().signal, save: vi.fn(async () => undefined) }
}

function recoveryRecord(): SocialTurnRecord {
  return {
    id: 'social-test',
    agentId: 'keromi',
    accountId: '123456',
    channelType: 'group',
    channelId: 'group-1',
    status: 'running',
    startedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 1,
    checkpoint: {},
  }
}

describe('社交工具预算与最终回复收尾', () => {
  it('五轮工具后明确禁止新调用并请求最终回复，保持工具定义前缀稳定', async () => {
    const chat = vi.fn()
    for (let index = 1; index <= 5; index++) chat.mockResolvedValueOnce(toolReply(index))
    chat.mockResolvedValueOnce(textReply('已查询，结果如下。'))
    const execute = vi.fn().mockResolvedValue('{"success":true}')
    const result = await generate(chat, execute)
    expect(result).toBe('已查询，结果如下。')
    expect(execute).toHaveBeenCalledTimes(5)
    expect(chat).toHaveBeenCalledTimes(6)
    const options = chat.mock.calls[5]![2] as ChatOptions
    expect(options.toolChoice).toBe('none')
    expect(options.tools).toEqual(tools)
    const messages = chat.mock.calls[5]![1] as ChatMessage[]
    expect(
      messages.some(
        (message) =>
          typeof message.content === 'string' && message.content.includes('本轮已结束工具阶段'),
      ),
    ).toBe(true)
  })

  it('截断续写不占用工具轮次，续写后仍可完成五轮工具', async () => {
    const chat = vi.fn().mockResolvedValueOnce(textReply('前文。', 'length'))
    for (let index = 1; index <= 5; index++) chat.mockResolvedValueOnce(toolReply(index))
    chat.mockResolvedValueOnce(textReply('处理完成。'))
    const execute = vi.fn().mockResolvedValue('{"success":true}')
    const result = await generate(chat, execute)
    expect(result).toBe('前文。处理完成。')
    expect(execute).toHaveBeenCalledTimes(5)
    expect(chat).toHaveBeenCalledTimes(7)
    expect(chat.mock.calls[6]![2]).toMatchObject({ toolChoice: 'none' })
  })

  it('收尾时模型仍返回原生调用则拒绝执行并纠正一次，保留合法的工具协议', async () => {
    const chat = vi.fn()
    for (let index = 1; index <= 5; index++) chat.mockResolvedValueOnce(toolReply(index))
    chat.mockResolvedValueOnce(toolReply(6)).mockResolvedValueOnce(textReply('部分处理尚未完成。'))
    const execute = vi.fn().mockResolvedValue('{"success":true}')
    expect(await generate(chat, execute)).toBe('部分处理尚未完成。')
    expect(execute).toHaveBeenCalledTimes(5)
    const messages = chat.mock.calls[6]![1] as ChatMessage[]
    expect(
      messages.some((message) => message.toolCalls?.some((call) => call.id === 'call-6')),
    ).toBe(false)
    expect(messages.some((message) => message.toolCallId === 'call-6')).toBe(false)
    expect(chat.mock.calls[6]![2]).toMatchObject({ toolChoice: 'none' })
  })

  it('收尾时文本工具调用同样不执行，持续违规只做有限纠正', async () => {
    const chat = vi.fn()
    for (let index = 1; index <= 5; index++) chat.mockResolvedValueOnce(toolReply(index))
    const textCall =
      '<tool_call><function=social><parameter=action>message_send</parameter></function></tool_call>'
    chat.mockResolvedValue(textReply(textCall))
    const execute = vi.fn().mockResolvedValue('{"success":true}')
    const record = recoveryRecord()
    await expect(
      runSocialRecovery(recovery(record), () => generate(chat, execute)),
    ).rejects.toThrow('明确禁用工具后仍未生成最终正文')
    expect(execute).toHaveBeenCalledTimes(5)
    expect(chat).toHaveBeenCalledTimes(7)
    expect(
      record.generationSummary?.tools.filter((entry) => entry.status === 'blocked'),
    ).toHaveLength(2)
  })

  it('连续相同参数的明确工具错误提前进入收尾，不耗尽整个工具预算', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(toolReply(1, { action: 'message_get' }))
      .mockResolvedValueOnce(toolReply(2, { action: 'message_get' }))
      .mockResolvedValueOnce(textReply('缺少消息 ID，暂时无法读取。'))
    const execute = vi.fn().mockResolvedValue('{"success":false,"error":"缺少消息 ID"}')
    expect(await generate(chat, execute)).toContain('缺少消息 ID')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(chat).toHaveBeenCalledTimes(3)
    expect(chat.mock.calls[2]![2]).toMatchObject({ toolChoice: 'none' })
  })

  it('结果未知时不重放工具，终态保留诊断而清除正文和参数', async () => {
    const privateValue = '仅用于参数的私有内容'
    const chat = vi
      .fn()
      .mockResolvedValueOnce(toolReply(1, { action: 'message_send', content: privateValue }))
    const execute = vi.fn().mockRejectedValue(new Error('执行结果无法确认'))
    const record = recoveryRecord()
    await expect(
      runSocialRecovery(recovery(record), () => generate(chat, execute)),
    ).rejects.toThrow('已停止重复执行')
    await finishSocialTurn({ saveTurn: vi.fn(async () => undefined) } as never, record, 'failed')
    expect(execute).toHaveBeenCalledOnce()
    expect(record.checkpoint).toEqual({})
    expect(record.generationSummary).toMatchObject({
      modelResponses: 1,
      toolRounds: 1,
      toolCalls: 1,
      tools: [{ name: 'social', action: 'message_send', status: 'unknown' }],
    })
    expect(JSON.stringify(record)).not.toContain(privateValue)
  })

  it('明确返回不确定结果时立即阻止同批后续调用，并补齐未执行结果', async () => {
    const first = toolReply(1, { action: 'message_send' })
    first.choices[0]!.message.toolCalls.push(
      toolReply(2, { action: 'message_send' }).choices[0]!.message.toolCalls[0]!,
    )
    const chat = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(textReply('发送结果尚未确认，需要先核验。'))
    const execute = vi.fn().mockResolvedValue('{"success":false,"uncertain":true}')
    const record = recoveryRecord()
    expect(await runSocialRecovery(recovery(record), () => generate(chat, execute))).toBe(
      '发送结果尚未确认，需要先核验。',
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(chat.mock.calls[1]![2]).toMatchObject({ toolChoice: 'none' })
    const messages = chat.mock.calls[1]![1] as ChatMessage[]
    expect(messages.find((message) => message.toolCallId === 'call-2')?.content).toContain(
      'SOCIAL_TOOLS_CLOSED',
    )
    expect(record.generationSummary).toMatchObject({
      closingReason: 'tool_result_unknown',
      tools: [{ status: 'unknown' }, { status: 'blocked' }],
    })
  })

  it.each(['selfMinding', 'think'])('%s 标签内的文本工具不作为真实工具执行', async (tag) => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        textReply(`<${tag}><tool_call><function=social></function></tool_call></${tag}>你好。`),
      )
    const execute = vi.fn()
    expect(await generate(chat, execute)).toBe('你好。')
    expect(execute).not.toHaveBeenCalled()
  })
})
