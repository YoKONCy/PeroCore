import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowStateService } from '@infos/backend/services/flow/flowStateService'
import { trimWorkContextToFit } from '@infos/backend/services/context/contextCompiler'

describe('FlowStateService', () => {
  const repo = {
    get: vi.fn(),
    listByThread: vi.fn(),
    save: vi.fn(),
    appendWorkContextEntry: vi.fn(),
    listWorkContextEntries: vi.fn(),
    deleteExpiredWorkContextEntries: vi.fn(),
    clearWorkContextEntries: vi.fn(),
    clear: vi.fn(),
    rollbackPairs: vi.fn(),
    deleteThread: vi.fn(),
  }
  const threadService = { getThread: vi.fn() }
  let service: FlowStateService

  beforeEach(() => {
    vi.clearAllMocks()
    repo.listWorkContextEntries.mockResolvedValue([])
    repo.deleteExpiredWorkContextEntries.mockResolvedValue(undefined)
    repo.clearWorkContextEntries.mockResolvedValue(undefined)
    repo.appendWorkContextEntry.mockResolvedValue(undefined)
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
      workContextSegments: [],
      workContextRemainingPairs: 0,
      revision: 1,
      updatedAt: null,
    })
    expect(prompt).toContain('<Current_Goal>\n继续游戏')
    expect(prompt).toContain('<Private_Facts>\n汤底')
  })

  it('同一来源跨轮重复读取时只保留最新内容', async () => {
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
      workContext: '',
      workContextUpdatedAtPairCount: 0,
      revision: 1,
      updatedAt: '2026-08-14 12:00:00',
    })
    repo.listWorkContextEntries.mockResolvedValue([
      {
        id: 1,
        pairCount: 6,
        content: JSON.stringify({
          version: 1,
          items: [
            { sourceKey: 'file:src/main.ts', content: '旧文件内容' },
            { sourceKey: 'browser:page-1', content: '旧页面内容' },
          ],
        }),
      },
      {
        id: 2,
        pairCount: 7,
        content: JSON.stringify({
          version: 1,
          items: [
            { sourceKey: 'FILE:SRC/MAIN.TS', content: '最新文件内容' },
            { sourceKey: 'file:src/other.ts', content: '其他文件内容' },
          ],
        }),
      },
    ])

    const result = await service.get('thread-1', 'pero')

    expect(result.workContextSegments).toEqual([
      '旧页面内容',
      '最新文件内容',
      '其他文件内容',
    ])
    expect(result.workContext).not.toContain('旧文件内容')
  })

  it('自动工作上下文按产生轮次独立保留后续五轮', async () => {
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
      workContext: '',
      workContextUpdatedAtPairCount: 0,
      revision: 1,
      updatedAt: '2026-08-14 12:00:00',
    })
    repo.listWorkContextEntries.mockResolvedValue([
      { id: 2, pairCount: 3, content: '第三轮过程' },
      { id: 3, pairCount: 7, content: '第七轮过程' },
    ])

    const result = await service.get('thread-1', 'pero')

    expect(repo.deleteExpiredWorkContextEntries).toHaveBeenCalledWith('thread-1', 'pero', 3)
    expect(result.workContext).toBe('第三轮过程\n\n第七轮过程')
    expect(result.workContextSegments).toEqual(['第三轮过程', '第七轮过程'])
    expect(result.workContextRemainingPairs).toBe(4)
  })

  it('第 N 轮自动记录从 N+6 轮开始消失', async () => {
    threadService.getThread.mockResolvedValue({
      id: 'thread-1',
      agentId: 'pero',
      channel: 'desktop',
      pairCount: 9,
    })
    repo.get.mockResolvedValue({
      threadId: 'thread-1',
      agentId: 'pero',
      currentGoal: '',
      privateFacts: '',
      workContext: '',
      workContextUpdatedAtPairCount: 0,
      revision: 1,
      updatedAt: '2026-08-14 12:00:00',
    })

    await service.get('thread-1', 'pero')

    expect(repo.deleteExpiredWorkContextEntries).toHaveBeenCalledWith('thread-1', 'pero', 4)
  })

  it('手动压缩会清除逐轮记录并从当前轮重新计时', async () => {
    threadService.getThread.mockResolvedValue({
      id: 'thread-1',
      agentId: 'pero',
      channel: 'desktop',
      pairCount: 8,
    })
    repo.get.mockResolvedValue({ currentGoal: '', privateFacts: '', revision: 1 })
    repo.save.mockImplementation(async (input) => ({
      ...input,
      revision: 2,
      updatedAt: '2026-08-14 12:01:00',
    }))

    await service.updateWorkContext({
      threadId: 'thread-1',
      agentId: 'pero',
      pairId: 'pair-9',
      content: '压缩摘要',
    })

    expect(repo.clearWorkContextEntries).toHaveBeenCalledWith('thread-1', 'pero')
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workContext: '压缩摘要',
        workContextUpdatedAtPairCount: 9,
      }),
    )
  })

  it('模型窗口不足时按轮移除最久远工作上下文', () => {
    const segments = ['最旧轮'.repeat(50), '较新轮'.repeat(50), '最新轮'.repeat(50)]
    const rendered = segments.join('\n\n')
    const messages = [{ role: 'system' as const, content: `<Work_Context>${rendered}</Work_Context>` }]

    const trimmed = trimWorkContextToFit(messages, segments, rendered, 180)
    const content = String(trimmed[0]?.content)

    expect(content).not.toContain('最旧轮')
    expect(content).not.toContain('较新轮')
    expect(content).toContain('最新轮')
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
