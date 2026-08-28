import { describe, expect, it, vi } from 'vitest'
import { AgentInputService } from '../../../../src/services/execution/agentInputService'

describe('AgentInputService', () => {
  it('应永久等待用户回答并把选项与附言原地返回', async () => {
    const service = new AgentInputService()
    const requested = vi.fn()
    service.onRequested(requested)
    const request = service.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      question: '你希望采用哪一种方式？',
      options: [
        { id: 'simple', label: '简单方式' },
        { id: 'complete', label: '完整方式' },
      ],
    })
    const waiting = service.waitForResolution(request.id)

    expect(requested).toHaveBeenCalledWith(request)
    expect(service.list({ status: 'pending' })).toHaveLength(1)
    service.resolve(request.id, {
      selectedOptionIds: ['complete'],
      message: '保留现有数据。',
    })

    await expect(waiting).resolves.toMatchObject({
      status: 'answered',
      selectedOptionIds: ['complete'],
      responseMessage: '保留现有数据。',
    })
  })

  it('同一会话同时只允许一个待回答请求', () => {
    const service = new AgentInputService()
    const input = {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      question: '第一个问题',
    }
    service.create(input)
    expect(() => service.create({ ...input, question: '第二个问题' })).toThrow(
      '当前对话已有一个等待用户回答的问题',
    )
  })

  it('必答问题不得跳过，取消信号会结束等待', async () => {
    const service = new AgentInputService()
    const required = service.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-required',
      threadId: 'thread-required',
      question: '必须回答的问题',
      required: true,
    })
    expect(() => service.resolve(required.id, { skipped: true })).toThrow('这个问题需要回答')

    const controller = new AbortController()
    const waiting = service.waitForResolution(required.id, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow('用户回答等待已取消')
    expect(service.get(required.id)?.status).toBe('cancelled')
  })
})
