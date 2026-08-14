import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from '@infos/backend/services/agent/agentService'
import type { AgentServiceDeps } from '@infos/backend/services/agent/agentService'
import type { ChatDelta } from '@infos/backend/services/llm/types'

const modelConfig = { provider: 'openai', modelId: 'test-model', apiKey: 'test-key' }

async function* streamFrom(chunks: ChatDelta[]) {
  for (const chunk of chunks) yield chunk
}

function createDeps(overrides: Partial<AgentServiceDeps> = {}): AgentServiceDeps {
  const deps: AgentServiceDeps = {
    llmService: {
      chatStream: vi
        .fn()
        .mockReturnValue(streamFrom([{ choices: [{ delta: { content: '回复' } }] }])),
    } as never,
    configRepo: {
      get: vi.fn().mockResolvedValue('default'),
    } as never,
    agentManager: {} as never,
    scorerService: {
      checkAndProcess: vi.fn().mockResolvedValue(undefined),
    } as never,
    toolExecutor: undefined,
    getToolDefinitions: vi
      .fn()
      .mockReturnValue([{ name: 'finish_task', description: '结束', parameters: {} }]),
    cancelChecker: undefined,
    gatewayBroadcast: vi.fn().mockResolvedValue(undefined),
    getModelConfig: vi.fn().mockResolvedValue(modelConfig),
  }
  return { ...deps, ...overrides }
}

describe('AgentService', () => {
  afterEach(() => {
    delete process.env.PERO_LLM_API_KEY
    delete process.env.PERO_LLM_MODEL
    delete process.env.PERO_LLM_PROVIDER
    delete process.env.PERO_LLM_API_BASE
  })

  it('应当完成非流式 ReAct 编排并返回回复', async () => {
    const deps = createDeps()
    const service = new AgentService(deps)

    const reply = await service.chatWithCompiledMessages({
      agentId: 'pero',
      channel: 'desktop',
      threadId: 's1',
      messages: [
        { role: 'system', content: '系统' },
        { role: 'user', content: '你好' },
      ],
    })

    expect(reply).toBe('回复')
    // 正式入口直接把 ContextCompiler 已编译的 messages 转交 ReAct Loop
    expect(deps.llmService.chatStream).toHaveBeenCalledWith(
      modelConfig,
      expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: '系统' }),
        expect.objectContaining({ role: 'user', content: '你好' }),
      ]),
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({ name: 'finish_task' }),
          }),
        ]),
      }),
    )
  })

  it('应当按当前 Agent 和通道解析工具定义', async () => {
    const deps = createDeps()
    const service = new AgentService(deps)

    await service.chatWithCompiledMessages({
      agentId: 'nana',
      threadId: 'stronghold_room_nana',
      channel: 'group',
      messages: [{ role: 'user', content: '你好' }],
    })

    expect(deps.getToolDefinitions).toHaveBeenCalledWith('nana', 'group', undefined, undefined)
  })

  it('应当支持流式输出并在 finish_task 后广播结束事件', async () => {
    const deps = createDeps({
      llmService: {
        chatStream: vi.fn().mockReturnValue(
          streamFrom([
            { choices: [{ delta: { content: '流式' } }] },
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'finish_task', arguments: '{"summary":"完成"}' },
                      },
                    ],
                  },
                },
              ],
            },
          ]),
        ),
      } as never,
      toolExecutor: {
        execute: vi.fn().mockResolvedValue({
          output: '完成',
          durationMs: 1,
          isError: false,
          shouldTerminate: true,
        }),
      },
    })
    const service = new AgentService(deps)
    const chunks = []

    // 使用新版 chatStreamWithCompiledMessages（兼容层 chatStream 不广播 stream_end）
    for await (const chunk of service.chatStreamWithCompiledMessages({
      agentId: 'pero',
      threadId: 's1',
      messages: [{ role: 'user', content: '开始' }],
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toContain('流式')
    expect(deps.gatewayBroadcast).toHaveBeenCalledWith('stream_end', { sessionId: 's1' })
  })

  it('流式与非流式必须使用完全一致的运行参数', async () => {
    const makeDeps = () => {
      const toolExecutor = {
        execute: vi.fn().mockResolvedValue({
          output: '心流已更新',
          durationMs: 1,
          isError: false,
          shouldTerminate: false,
        }),
      }
      let requestCount = 0
      return createDeps({
        llmService: {
          chatStream: vi.fn().mockImplementation(() => {
            requestCount++
            return requestCount === 1
              ? streamFrom([
                  {
                    choices: [
                      {
                        delta: {
                          toolCalls: [
                            {
                              index: 0,
                              id: 'flow-call',
                              type: 'function',
                              function: {
                                name: 'update_flow_state',
                                arguments: '{"current_goal":"测试"}',
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                ])
              : streamFrom([{ choices: [{ delta: { content: '完成' } }] }])
          }),
        } as never,
        toolExecutor,
        getToolDefinitions: vi
          .fn()
          .mockReturnValue([
            { name: 'update_flow_state', description: '更新心流', parameters: {} },
          ]),
      })
    }
    const params = {
      agentId: 'nana',
      threadId: 'thread-1',
      channel: 'desktop',
      taskId: 'task-1',
      pairId: 'pair-1',
      disabledTools: ['write_file'],
      messages: [{ role: 'user' as const, content: '开始' }],
    }
    const nonStreamDeps = makeDeps()
    const streamDeps = makeDeps()

    await new AgentService(nonStreamDeps).chatWithCompiledMessages(params)
    for await (const event of new AgentService(streamDeps).chatStreamWithCompiledMessages(params)) {
      expect(event).toBeDefined()
    }

    expect(nonStreamDeps.getToolDefinitions).toHaveBeenCalledWith(
      'nana',
      'desktop',
      ['write_file'],
      undefined,
    )
    expect(streamDeps.getToolDefinitions).toHaveBeenCalledWith(
      'nana',
      'desktop',
      ['write_file'],
      undefined,
    )
    expect(nonStreamDeps.llmService.chatStream).toHaveBeenCalledWith(
      modelConfig,
      expect.any(Array),
      expect.objectContaining({ tools: expect.any(Array) }),
    )
    expect(streamDeps.llmService.chatStream).toHaveBeenCalledWith(
      modelConfig,
      expect.any(Array),
      expect.objectContaining({ tools: expect.any(Array) }),
    )
    const nonStreamCall = vi.mocked(nonStreamDeps.llmService.chatStream).mock.calls[0]
    const streamCall = vi.mocked(streamDeps.llmService.chatStream).mock.calls[0]
    expect(streamCall).toEqual(nonStreamCall)

    const nonStreamExecution = vi.mocked(nonStreamDeps.toolExecutor!.execute).mock.calls[0]
    const streamExecution = vi.mocked(streamDeps.toolExecutor!.execute).mock.calls[0]
    expect(streamExecution).toEqual(nonStreamExecution)
    expect(nonStreamExecution?.[3]).toMatchObject({
      agentId: 'nana',
      threadId: 'thread-1',
      channel: 'desktop',
      taskId: 'task-1',
      pairId: 'pair-1',
      disabledTools: ['write_file'],
      toolCallId: 'flow-call',
    })
  })

  it('应当在没有模型配置时使用环境变量兜底或抛出配置错误', async () => {
    const envDeps = createDeps({ getModelConfig: vi.fn().mockResolvedValue(null) })
    process.env.PERO_LLM_API_KEY = 'env-key'
    process.env.PERO_LLM_MODEL = 'env-model'
    process.env.PERO_LLM_PROVIDER = 'gemini'
    process.env.PERO_LLM_API_BASE = 'https://example.test'
    const envService = new AgentService(envDeps)

    await envService.chatWithCompiledMessages({
      agentId: 'pero',
      channel: 'desktop',
      threadId: 's1',
      messages: [{ role: 'user', content: '你好' }],
    })

    expect(envDeps.llmService.chatStream).toHaveBeenCalledWith(
      {
        provider: 'gemini',
        modelId: 'env-model',
        apiKey: 'env-key',
        apiBase: 'https://example.test',
      },
      expect.any(Array),
      expect.any(Object),
    )

    delete process.env.PERO_LLM_API_KEY
    delete process.env.PERO_LLM_MODEL
    const errorDeps = createDeps({ getModelConfig: vi.fn().mockResolvedValue(null) })
    const errorService = new AgentService(errorDeps)

    await expect(
      errorService.chatWithCompiledMessages({
        agentId: 'pero',
        channel: 'desktop',
        threadId: 's1',
        messages: [{ role: 'user', content: '你好' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
  })

  it('应当在持久化或 Scorer 失败时不影响主回复', async () => {
    const deps = createDeps({
      logService: { savePair: vi.fn().mockRejectedValue(new Error('保存失败')) } as never,
      scorerService: {
        checkAndProcess: vi.fn().mockRejectedValue(new Error('评分失败')),
      } as never,
    })
    const service = new AgentService(deps)

    const reply = await service.chatWithCompiledMessages({
      agentId: 'pero',
      channel: 'desktop',
      threadId: 's1',
      messages: [{ role: 'user', content: '你好' }],
    })
    await Promise.resolve()

    expect(reply).toBe('回复')
  })
})
