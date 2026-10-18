import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_INPUT_TIMEOUT_MS,
  AgentInputService,
} from '../../../../src/services/execution/agentInputService'

afterEach(() => vi.useRealTimers())

describe('AgentInputService', () => {
  it('十分钟截止前仍可回答，并完整保留所选选项与附言', async () => {
    vi.useFakeTimers()
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

    let settled = false
    void waiting.finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(AGENT_INPUT_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
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
      expect.objectContaining({ code: 'CONFLICT' }),
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
    expect(() => service.resolve(required.id, { skipped: true })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )

    const controller = new AbortController()
    const waiting = service.waitForResolution(required.id, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow(Error)
    expect(service.get(required.id)?.status).toBe('cancelled')
  })
  it('非必答问题到期后解除等待，未回答不等于同意', async () => {
    vi.useFakeTimers()
    const service = new AgentInputService()
    const request = service.create({
      agentId: 'nana',
      channel: 'desktop',
      sessionId: 'optional',
      threadId: 'optional',
      question: '请选择方案',
    })
    const waiting = service.waitForResolution(request.id)
    await vi.advanceTimersByTimeAsync(AGENT_INPUT_TIMEOUT_MS)
    await expect(waiting).resolves.toMatchObject({ status: 'skipped', selectedOptionIds: [] })
    expect(service.list({ status: 'pending' })).toHaveLength(0)
    expect(() => service.resolve(request.id, { message: '迟到回答' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    )
  })

  it('必答问题到期只释放本轮等待，随后仍可提交回答', async () => {
    vi.useFakeTimers()
    const service = new AgentInputService()
    const request = service.create({
      agentId: 'nana',
      channel: 'desktop',
      sessionId: 'required',
      threadId: 'required',
      question: '需要确认的信息',
      required: true,
    })
    const waiting = service.waitForResolution(request.id)
    await vi.advanceTimersByTimeAsync(AGENT_INPUT_TIMEOUT_MS)
    await expect(waiting).resolves.toMatchObject({ status: 'pending', selectedOptionIds: [] })
    expect(service.hasActiveWaiter(request.id)).toBe(false)
    expect(service.resolve(request.id, { message: '我的回答' })).toMatchObject({
      status: 'answered',
      responseMessage: '我的回答',
    })
  })

  it('多题必须完整校验后一次提交，错误回答不能部分结算', () => {
    const service = new AgentInputService()
    const resolved = vi.fn()
    service.onResolved(resolved)
    const request = service.create({
      agentId: 'nana',
      channel: 'desktop',
      sessionId: 'group',
      threadId: 'group',
      questions: [
        {
          id: 'format',
          question: '输出格式？',
          options: [
            { id: 'md', label: 'Markdown' },
            { id: 'txt', label: '文本' },
          ],
        },
        { id: 'notes', question: '还有哪些要求？' },
      ],
    })
    const format = { questionId: 'format', selectedOptionIds: ['md'], message: '附上目录' }
    const notes = { questionId: 'notes', selectedOptionIds: [], message: '保留原文件' }
    for (const answers of [
      [format],
      [format, { ...notes, questionId: 'unknown' }],
      [format, format],
      [{ ...format, selectedOptionIds: ['missing'] }, notes],
      [{ ...format, selectedOptionIds: ['md', 'txt'] }, notes],
      [format, { ...notes, message: ' ' }],
    ]) {
      expect(() => service.resolve(request.id, { answers })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      )
      expect(service.get(request.id)?.status).toBe('pending')
      expect(resolved).not.toHaveBeenCalled()
    }
    expect(service.resolve(request.id, { answers: [notes, format] })).toMatchObject({
      status: 'answered',
      answers: [format, notes],
    })
    expect(resolved).toHaveBeenCalledTimes(1)
    expect(() => service.resolve(request.id, { answers: [format, notes] })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    )
  })

  it('明确允许多选的题目可提交多个选项和补充', () => {
    const service = new AgentInputService()
    const request = service.create({
      agentId: 'nana',
      channel: 'desktop',
      sessionId: 'multiple',
      threadId: 'multiple',
      questions: [
        {
          id: 'files',
          question: '需要哪些文件？',
          multiple: true,
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    })
    const answer = { questionId: 'files', selectedOptionIds: ['a', 'b'], message: '按名称排序' }
    expect(service.resolve(request.id, { answers: [answer] }).answers).toEqual([answer])
  })
})
