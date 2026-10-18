import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegistryToolExecutor } from '../../../src/services/agent/toolExecutor'
import { ToolRegistry } from '../../../src/services/agent/toolRegistry'
import { AgentInputService } from '../../../src/services/execution/agentInputService'
import { askUserTool, setAgentInputService } from '../../../src/tools/askUser'

afterEach(() => vi.useRealTimers())

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

    const result = await execution
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.output)).toMatchObject({
      answered: true,
      answers: [{ questionId: 'question', selectedOptionIds: [], message: '继续。' }],
    })
  })

  it('整组问题回答后才继续，并返回题目、选项与补充', async () => {
    const service = new AgentInputService()
    setAgentInputService(service)
    const execution = askUserTool.execute(
      {
        questions: [
          { id: 'plan', question: '选择一种方案', options: [{ id: 'safe', label: '安全方案' }] },
          { id: 'note', question: '还需要什么？' },
        ],
      },
      {
        agentId: 'pero',
        source: 'desktop',
        channel: 'desktop',
        sessionId: 'thread-1',
        threadId: 'thread-1',
      },
    )
    const request = service.list({ status: 'pending' })[0]!
    service.resolve(request.id, {
      answers: [
        { questionId: 'plan', selectedOptionIds: ['safe'], message: '就用这个。' },
        { questionId: 'note', selectedOptionIds: [], message: '保留备份' },
      ],
    })
    const result = await execution
    expect(typeof result).toBe('string')
    expect(JSON.parse(result as string)).toMatchObject({
      answered: true,
      answers: [
        {
          questionId: 'plan',
          question: '选择一种方案',
          selectedOptions: ['安全方案'],
          message: '就用这个。',
        },
        { questionId: 'note', question: '还需要什么？', message: '保留备份' },
      ],
    })
  })
})
