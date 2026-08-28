import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowStateService } from '@infos/backend/services/flow/flowStateService'

describe('FlowStateService', () => {
  const repo = {
    get: vi.fn(),
    listByThread: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
    rollbackPairs: vi.fn(),
    deleteThread: vi.fn(),
  }
  const threadService = { getThread: vi.fn() }
  let service: FlowStateService

  beforeEach(() => {
    vi.clearAllMocks()
    threadService.getThread.mockResolvedValue({
      id: 'thread-1',
      agentId: 'pero',
      channel: 'desktop',
    })
    service = new FlowStateService(repo as never, threadService as never, {
      get: vi.fn().mockResolvedValue(null),
    })
  })

  it('局部更新目标时保留已有私有事实', async () => {
    repo.get.mockResolvedValue({ currentGoal: '旧目标', privateFacts: '隐藏汤底', revision: 1 })
    repo.save.mockImplementation(async (input) => ({
      ...input,
      revision: 2,
      updatedAt: '2026-08-14 12:00:00',
    }))

    const result = await service.update({
      threadId: 'thread-1',
      agentId: 'pero',
      currentGoal: '主持海龟汤',
    })

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ currentGoal: '主持海龟汤', privateFacts: '隐藏汤底' }),
    )
    expect(result.revision).toBe(2)
  })

  it('拒绝访问普通 Thread 中其他 Agent 的心流', async () => {
    await expect(service.get('thread-1', 'nana')).rejects.toThrow('不能访问其他 Agent')
  })

  it('清空时保留一条可回滚修订', async () => {
    repo.clear.mockResolvedValue({
      threadId: 'thread-1',
      agentId: 'pero',
      currentGoal: '',
      privateFacts: '',
      revision: 3,
      updatedAt: '2026-08-14 12:00:00',
    })

    const result = await service.clear('thread-1', 'pero')

    expect(repo.clear).toHaveBeenCalledWith('thread-1', 'pero')
    expect(result.currentGoal).toBe('')
  })

  it('按固定标签格式注入两个心流字段', () => {
    const prompt = service.formatForPrompt({
      threadId: 'thread-1',
      agentId: 'pero',
      currentGoal: '继续游戏',
      privateFacts: '汤底',
      workContext: '',
      workContextRemainingPairs: 0,
      revision: 1,
      updatedAt: null,
    })
    expect(prompt).toContain('<Current_Goal>\n继续游戏')
    expect(prompt).toContain('<Private_Facts>\n汤底')
  })

  it('工作上下文达到配置轮次后强制清空', async () => {
    threadService.getThread.mockResolvedValue({
      id: 'thread-1',
      agentId: 'pero',
      channel: 'desktop',
      pairCount: 8,
    })
    repo.get.mockResolvedValue({
      threadId: 'thread-1',
      agentId: 'pero',
      currentGoal: '',
      privateFacts: '',
      workContext: '临时资料',
      workContextUpdatedAtPairCount: 3,
      revision: 1,
      updatedAt: '2026-08-14 12:00:00',
    })
    repo.save.mockImplementation(async (input) => ({
      ...input,
      revision: 2,
      updatedAt: '2026-08-14 12:01:00',
    }))

    const result = await service.get('thread-1', 'pero')

    expect(result.workContext).toBe('')
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ workContext: '' }))
  })
})
