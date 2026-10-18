import { describe, expect, it, vi } from 'vitest'
import { AgentService } from '@infos/backend/services/agent/agentService'
import { runReActLoop } from '@infos/backend/services/agent/reactLoop'
import { LlmService, type ModelConfig } from '@infos/backend/services/llm/llmService'

const baseModel: ModelConfig = { provider: 'openai', modelId: '测试模型', apiKey: '' }

function scenario(toolTurns: number) {
  let modelCalls = 0
  const counter = new LlmService()
  const execute = vi.fn(async () => ({
    output: '成功',
    durationMs: 1,
    isError: false,
    shouldTerminate: false,
  }))
  const llmService = {
    estimateInputTokens: counter.estimateInputTokens.bind(counter),
    chatStream: vi.fn(() =>
      (async function* () {
        modelCalls++
        yield modelCalls <= toolTurns
          ? {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: `call-${modelCalls}`,
                        function: { name: 'test_action', arguments: '{}' },
                      },
                    ],
                  },
                  finishReason: 'tool_calls',
                },
              ],
            }
          : { choices: [{ delta: { content: '任务已完成。' }, finishReason: 'stop' }] }
      })(),
    ),
  }
  return {
    execute,
    llmService,
    params: {
      llmService: llmService as never,
      modelConfig: baseModel,
      messages: [{ role: 'user' as const, content: '完成全部步骤' }],
      source: 'desktop',
      tools: [{ name: 'test_action', description: '测试动作', parameters: {} }],
      toolExecutor: { execute },
    },
  }
}

async function collect(params: Parameters<typeof runReActLoop>[0]) {
  const run = runReActLoop(params)
  let next = await run.next()
  while (!next.done) next = await run.next()
  return next.value
}

describe('桌面 ReAct 轮次配置', () => {
  it('默认允许执行超过原来的三十轮后正常完成', async () => {
    const run = scenario(40)
    const result = await collect(run.params)
    expect(run.execute).toHaveBeenCalledTimes(40)
    expect(run.llmService.chatStream).toHaveBeenCalledTimes(41)
    expect(result.turnLimitReached).toBeUndefined()
    expect(result.contentBlocks.at(-1)).toMatchObject({ kind: 'narration', phase: 'final' })
  })

  it('采用当前模型的独立上限，并保留最后一次成功工具的结果', async () => {
    const run = scenario(10)
    const result = await collect({ ...run.params, modelConfig: { ...baseModel, maxReActTurns: 3 } })
    expect(run.execute).toHaveBeenCalledTimes(3)
    expect(result.turnLimitReached).toBe(3)
    expect(result.toolCalls.at(-1)?.isError).toBe(false)
  })

  it('最后一轮正常回复不应误报达到上限', async () => {
    const run = scenario(2)
    const result = await collect({ ...run.params, modelConfig: { ...baseModel, maxReActTurns: 3 } })
    expect(result.turnLimitReached).toBeUndefined()
    expect(result.contentBlocks.at(-1)).toMatchObject({ kind: 'narration', phase: 'final' })
  })

  it('桌面模型配置不覆盖社交通道的固定预算', async () => {
    const run = scenario(10)
    await collect({
      ...run.params,
      source: 'social',
      modelConfig: { ...baseModel, maxReActTurns: 500 },
    })
    expect(run.execute).toHaveBeenCalledTimes(2)
  })

  it('达到上限时先交付过程回调，再返回明确错误', async () => {
    const run = scenario(10)
    const onToolCalls = vi.fn()
    const onContentBlocks = vi.fn()
    const service = new AgentService({
      llmService: run.llmService as never,
      configRepo: {} as never,
      agentManager: {} as never,
      getModelConfig: async () => ({ ...baseModel, maxReActTurns: 2 }),
      getToolDefinitions: () => run.params.tools,
      toolExecutor: run.params.toolExecutor,
    })
    await expect(
      service.chatWithCompiledMessages({
        agentId: 'pero',
        threadId: '轮次验证',
        messages: run.params.messages,
        onToolCalls,
        onContentBlocks,
      }),
    ).rejects.toMatchObject({ code: 'REACT_TURN_LIMIT' })
    expect(onToolCalls).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'test_action', isError: false })]),
    )
    expect(onContentBlocks).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: 'tool', name: 'test_action' })]),
    )
  })
})
