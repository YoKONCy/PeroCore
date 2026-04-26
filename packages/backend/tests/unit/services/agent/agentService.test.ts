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
    promptService: {
      assemble: vi.fn(() => ({ systemPrompt: '系统提示', footer: '脚注' })),
    } as never,
    llmService: {
      chatStream: vi
        .fn()
        .mockReturnValue(streamFrom([{ choices: [{ delta: { content: '回复' } }] }])),
    } as never,
    logService: {
      savePair: vi.fn().mockResolvedValue({}),
    } as never,
    configRepo: {
      get: vi.fn().mockResolvedValue('default'),
    } as never,
    agentManager: {} as never,
    scorerService: {
      checkAndProcess: vi.fn().mockResolvedValue(undefined),
    } as never,
    enrichers: [
      { name: 'MemoryEnricher', enrich: vi.fn().mockResolvedValue({ memoryContext: '记忆' }) },
      { name: 'ToolEnricher', enrich: vi.fn().mockResolvedValue({ toolContext: '工具' }) },
      { name: 'HistoryEnricher', enrich: vi.fn().mockResolvedValue({ historyContext: '历史' }) },
    ],
    toolExecutor: undefined,
    getToolDefinitions: vi
      .fn()
      .mockReturnValue([{ name: 'finish_task', description: '结束', parameters: {} }]),
    capabilityGate: {
      resolve: vi.fn().mockReturnValue({ toolsDescription: '工具描述', skillMenuText: '技能菜单' }),
    } as never,
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

  it('应当完成非流式五阶段编排并异步持久化', async () => {
    const deps = createDeps()
    const service = new AgentService(deps)

    const reply = await service.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [
        { role: 'system', content: '旧系统' },
        { role: 'user', content: '你好' },
      ],
      extraVars: { custom: '变量' },
    })
    await Promise.resolve()

    expect(reply).toBe('回复')
    expect(deps.promptService.assemble).toHaveBeenCalledWith(
      'pero',
      'desktop',
      expect.objectContaining({
        memoryContext: '记忆',
        toolContext: '工具',
        historyContext: '历史',
      }),
      { tools_description: '工具描述', skill_menu: '技能菜单', custom: '变量' },
    )
    expect(deps.llmService.chatStream).toHaveBeenCalledWith(
      modelConfig,
      [
        { role: 'system', content: '系统提示' },
        { role: 'system', content: '脚注' },
        { role: 'user', content: '你好' },
      ],
      {
        tools: [
          {
            type: 'function',
            function: { name: 'finish_task', description: '结束', parameters: {} },
          },
        ],
      },
    )
    expect(deps.logService.savePair).toHaveBeenCalledWith({
      sessionId: 's1',
      source: 'desktop',
      agentId: 'pero',
      userContent: '你好',
      assistantContent: '回复',
      assistantRawContent: '回复',
    })
    expect(deps.scorerService?.checkAndProcess).toHaveBeenCalledWith('pero')
  })

  it('应当在轻量 Profile 下跳过 memory/tool enricher', async () => {
    const deps = createDeps({
      configRepo: { get: vi.fn().mockResolvedValue('lightweight') } as never,
    })
    const service = new AgentService(deps)

    await service.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [{ role: 'user', content: '你好' }],
    })

    expect(deps.enrichers[0]?.enrich).not.toHaveBeenCalled()
    expect(deps.enrichers[1]?.enrich).not.toHaveBeenCalled()
    expect(deps.enrichers[2]?.enrich).toHaveBeenCalled()
  })

  it('应当在用户文本为空时直接返回空字符串', async () => {
    const deps = createDeps()
    const service = new AgentService(deps)

    const reply = await service.chat({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [{ role: 'assistant', content: '上一句' }],
    })

    expect(reply).toBe('')
    expect(deps.promptService.assemble).not.toHaveBeenCalled()
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

    for await (const chunk of service.chatStream({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [{ role: 'user', content: '开始' }],
    })) {
      chunks.push(chunk)
    }
    await Promise.resolve()

    expect(chunks).toContain('流式')
    expect(deps.gatewayBroadcast).toHaveBeenCalledWith('stream_end', { sessionId: 's1' })
    expect(deps.logService.savePair).toHaveBeenCalledWith(
      expect.objectContaining({ assistantContent: '流式', assistantRawContent: '流式' }),
    )
  })

  it('应当在流式入口没有用户文本时只返回空字符串', async () => {
    const deps = createDeps()
    const service = new AgentService(deps)
    const chunks = []

    for await (const chunk of service.chatStream({
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      messages: [],
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([''])
    expect(deps.llmService.chatStream).not.toHaveBeenCalled()
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
      scorerService: { checkAndProcess: vi.fn().mockRejectedValue(new Error('评分失败')) } as never,
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
