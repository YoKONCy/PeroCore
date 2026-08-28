import { describe, expect, it, vi } from 'vitest'
import { RegistryToolExecutor } from '../../../src/services/agent/toolExecutor'
import { ToolRegistry } from '../../../src/services/agent/toolRegistry'
import { AgentInputService } from '../../../src/services/execution/agentInputService'
import { askUserTool, setAgentInputService } from '../../../src/tools/askUser'

describe('ask_user工具', () => {
  it('经工具执行器等待超过原30秒边界后仍不返回，用户回答后才继续', async () => {
    vi.useFakeTimers()
    const service = new AgentInputService()
    setAgentInputService(service)
    const registry = new ToolRegistry()
    registry.register(
      { name: 'ask_user', description: '向用户提问', parameters: { type: 'object' } },
      (args, ctx) => askUserTool.execute(args, ctx),
    )
    const executor = new RegistryToolExecutor(registry)
    let settled = false
    const execution = executor
      .execute('ask_user', { question: '还要继续吗？' }, 'desktop', {
        agentId: 'pero',
        sessionId: 'thread-timeout',
        threadId: 'thread-timeout',
      })
      .finally(() => {
        settled = true
      })

    await vi.advanceTimersByTimeAsync(31_000)
    expect(settled).toBe(false)
    const request = service.list({ status: 'pending' })[0]!
    service.resolve(request.id, { message: '继续。' })

    await expect(execution).resolves.toMatchObject({
      isError: false,
      output: JSON.stringify({
        answered: true,
        selectedOptionIds: [],
        message: '继续。',
      }),
    })
    vi.useRealTimers()
  })

  it('应等待用户回答并返回结构化工具结果', async () => {
    const service = new AgentInputService()
    setAgentInputService(service)
    const execution = askUserTool.execute(
      {
        question: '选择一种方案',
        options: [{ id: 'safe', label: '安全方案' }],
      },
      {
        agentId: 'pero',
        source: 'desktop',
        channel: 'desktop',
        sessionId: 'thread-1',
        threadId: 'thread-1',
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const request = service.list({ status: 'pending' })[0]!
    service.resolve(request.id, { selectedOptionIds: ['safe'], message: '就用这个。' })

    await expect(execution).resolves.toBe(
      JSON.stringify({
        answered: true,
        selectedOptionIds: ['safe'],
        message: '就用这个。',
      }),
    )
  })
})
