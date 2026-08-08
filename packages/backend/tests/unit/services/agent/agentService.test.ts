import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentService } from '@perocore/backend/services/agent/agentService'
import type { AgentServiceDeps } from '@perocore/backend/services/agent/agentService'
import type { ChatDelta } from '@perocore/backend/services/llm/types'

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
      // 新版 AgentService 调用 processBatch（旧版 checkAndProcess 已废弃）
      processBatch: vi.fn().mockResolvedValue(undefined),
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

    const reply = await service.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [
        { role: 'system', content: '系统' },
        { role: 'user', content: '你好' },
      ],
    })

    expect(reply).toBe('回复')
    // chat() 兼容层直接把 messages 转交 ReAct Loop，由其调用 llmService.chatStream
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

  it('应当在没有模型配置时使用环境变量兜底或抛出配置错误', async () => {
    const envDeps = createDeps({ getModelConfig: vi.fn().mockResolvedValue(null) })
    process.env.PERO_LLM_API_KEY = 'env-key'
    process.env.PERO_LLM_MODEL = 'env-model'
    process.env.PERO_LLM_PROVIDER = 'gemini'
    process.env.PERO_LLM_API_BASE = 'https://example.test'
    const envService = new AgentService(envDeps)

    await envService.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
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
      errorService.chat({
        agentId: 'pero',
        source: 'desktop',
        sessionId: 's1',
        messages: [{ role: 'user', content: '你好' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
  })

  it('应当在持久化或 Scorer 失败时不影响主回复', async () => {
    const deps = createDeps({
      logService: { savePair: vi.fn().mockRejectedValue(new Error('保存失败')) } as never,
      scorerService: {
        processBatch: vi.fn().mockRejectedValue(new Error('评分失败')),
      } as never,
    })
    const service = new AgentService(deps)

    const reply = await service.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [{ role: 'user', content: '你好' }],
    })
    await Promise.resolve()

    expect(reply).toBe('回复')
  })
})
