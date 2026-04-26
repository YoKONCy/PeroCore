import { describe, expect, it, vi } from 'vitest'
import { createChatRouter } from '@perocore/backend/routers/chat.router'

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function createCtx() {
  return {
    agentService: {
      chat: vi.fn(() => Promise.resolve('回复')),
      chatStream: vi.fn(),
    },
    sessionService: {
      incrementMessageCount: vi.fn(),
      notifyCompanionActivity: vi.fn(),
      clearSession: vi.fn(() => Promise.resolve({ sessionId: 'new-session' })),
      switchProfile: vi.fn(() =>
        Promise.resolve({ profile: 'companion', sessionId: 'companion-session' }),
      ),
    },
    taskManager: {
      register: vi.fn(),
      unregister: vi.fn(),
      cancel: vi.fn(),
      listActiveTasks: vi.fn(() => [{ sessionId: 's1', status: 'running' }]),
      pause: vi.fn((sessionId: string) => sessionId === 's1'),
      resume: vi.fn((sessionId: string) => sessionId === 's1'),
      inject: vi.fn((sessionId: string) => sessionId === 's1'),
    },
    logService: {
      listSessionSummaries: vi.fn(() =>
        Promise.resolve({
          items: [{ sessionId: 's1' }],
          total: 1,
          page: 1,
          pageSize: 20,
          hasMore: false,
        }),
      ),
      query: vi.fn(() =>
        Promise.resolve([
          {
            id: 2,
            role: 'assistant',
            content: '回复',
            rawContent: null,
            timestamp: '2026-01-02T00:00:00.000Z',
            pairId: 'p1',
          },
          {
            id: 1,
            role: 'user',
            content: '你好',
            rawContent: 'raw',
            timestamp: '2026-01-01T00:00:00.000Z',
            pairId: 'p1',
          },
        ]),
      ),
      updateMessage: vi.fn(() => Promise.resolve(true)),
      deleteMessage: vi.fn(() => Promise.resolve(true)),
      deleteMessagePair: vi.fn(() => Promise.resolve(2)),
    },
    chatResetService: {
      reset: vi.fn(() => Promise.resolve({ message: '已重置', data: { action: 'logs' } })),
    },
  }
}

describe('ChatRouter', () => {
  it('应当执行非流式对话并通知会话活动', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const response = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: '你好' }],
        agentId: 'pero',
        source: 'desktop',
        sessionId: 's1',
        isVoiceMode: true,
        extraVars: { mood: '开心' },
      }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(response)).toMatchObject({ code: 'OK', data: { reply: '回复' } })
    expect(ctx.sessionService.incrementMessageCount).toHaveBeenCalledWith('pero')
    expect(ctx.sessionService.notifyCompanionActivity).toHaveBeenCalledWith('pero')
    expect(ctx.agentService.chat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: '你好' }],
      agentId: 'pero',
      source: 'desktop',
      sessionId: 's1',
      isVoiceMode: true,
      extraVars: { mood: '开心' },
    })
  })

  it('应当停止、清除会话并切换 profile', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const stopped = await router.request('http://test/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1' }),
      headers: { 'content-type': 'application/json' },
    })
    const cleared = await router.request('http://test/session/clear', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero' }),
      headers: { 'content-type': 'application/json' },
    })
    const switched = await router.request('http://test/session/profile', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero', profile: 'companion' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(stopped)).toEqual({ code: 'OK', message: '已停止生成' })
    expect(ctx.taskManager.cancel).toHaveBeenCalledWith('s1')
    expect(await readJson(cleared)).toMatchObject({
      code: 'OK',
      data: { sessionId: 'new-session' },
    })
    expect(await readJson(switched)).toMatchObject({
      code: 'OK',
      message: '已切换到 companion 模式',
      data: { profile: 'companion' },
    })
  })

  it('应当查询会话摘要和会话消息并转为时间正序', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const sessions = await router.request(
      'http://test/sessions?agentId=pero&page=0&pageSize=500&source=social',
    )
    const detail = await router.request('http://test/sessions/s1?agentId=pero&limit=500')

    expect(await readJson(sessions)).toMatchObject({ code: 'OK', data: { total: 1 } })
    expect(ctx.logService.listSessionSummaries).toHaveBeenCalledWith({
      agentId: 'pero',
      source: 'social',
      page: 1,
      pageSize: 100,
    })
    expect(await readJson(detail)).toMatchObject({
      code: 'OK',
      data: {
        sessionId: 's1',
        agentId: 'pero',
        total: 2,
        messages: [
          {
            id: 1,
            role: 'user',
            content: '你好',
            rawContent: 'raw',
            timestamp: '2026-01-01T00:00:00.000Z',
            pairId: 'p1',
          },
          {
            id: 2,
            role: 'assistant',
            content: '回复',
            rawContent: null,
            timestamp: '2026-01-02T00:00:00.000Z',
            pairId: 'p1',
          },
        ],
      },
    })
    expect(ctx.logService.query).toHaveBeenCalledWith({
      agentId: 'pero',
      sessionId: 's1',
      limit: 200,
    })
  })

  it('应当编辑、删除单条消息和级联删除消息对', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const patched = await router.request('http://test/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: '新内容' }),
      headers: { 'content-type': 'application/json' },
    })
    const deleted = await router.request('http://test/messages/1', { method: 'DELETE' })
    const pairDeleted = await router.request('http://test/messages/1/pair', { method: 'DELETE' })

    expect(await readJson(patched)).toEqual({ code: 'OK', message: '消息已更新' })
    expect(ctx.logService.updateMessage).toHaveBeenCalledWith(1, '新内容')
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '消息已删除' })
    expect(await readJson(pairDeleted)).toMatchObject({ code: 'OK', data: { deletedCount: 2 } })
  })

  it('应当管理活跃任务暂停、恢复、注入和重置', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const tasks = await router.request('http://test/tasks')
    const paused = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1' }),
      headers: { 'content-type': 'application/json' },
    })
    const missingPause = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'missing' }),
      headers: { 'content-type': 'application/json' },
    })
    const resumed = await router.request('http://test/tasks/resume', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1' }),
      headers: { 'content-type': 'application/json' },
    })
    const injected = await router.request('http://test/tasks/inject', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', instruction: '继续' }),
      headers: { 'content-type': 'application/json' },
    })
    const reset = await router.request('http://test/reset', {
      method: 'POST',
      body: JSON.stringify({ action: 'logs', agentId: 'pero' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(tasks)).toMatchObject({ code: 'OK', data: [{ sessionId: 's1' }] })
    expect(await readJson(paused)).toEqual({ code: 'OK', message: '任务已暂停' })
    expect(missingPause.status).toBe(404)
    expect(await readJson(resumed)).toEqual({ code: 'OK', message: '任务已恢复' })
    expect(await readJson(injected)).toEqual({ code: 'OK', message: '指令已注入' })
    expect(await readJson(reset)).toMatchObject({
      code: 'OK',
      message: '已重置',
      data: { action: 'logs' },
    })
    expect(ctx.chatResetService.reset).toHaveBeenCalledWith('logs', 'pero')
  })

  it('应当拒绝非法对话、非法消息和缺失任务参数', async () => {
    const ctx = createCtx()
    ctx.logService.updateMessage.mockResolvedValueOnce(false)
    ctx.logService.deleteMessage.mockResolvedValueOnce(false)
    ctx.logService.deleteMessagePair.mockResolvedValueOnce(0)
    const router = createChatRouter(ctx as never)

    const invalidChat = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ messages: [] }),
      headers: { 'content-type': 'application/json' },
    })
    const invalidPatchId = await router.request('http://test/messages/0', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
    const missingPatch = await router.request('http://test/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: ' ' }),
      headers: { 'content-type': 'application/json' },
    })
    const notFoundPatch = await router.request('http://test/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: '新内容' }),
      headers: { 'content-type': 'application/json' },
    })
    const notFoundDelete = await router.request('http://test/messages/1', { method: 'DELETE' })
    const notFoundPair = await router.request('http://test/messages/1/pair', { method: 'DELETE' })
    const missingPause = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    const missingInject = await router.request('http://test/tasks/inject', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', instruction: ' ' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(invalidChat.status).toBe(400)
    expect(invalidPatchId.status).toBe(500)
    expect(missingPatch.status).toBe(500)
    expect(notFoundPatch.status).toBe(500)
    expect(notFoundDelete.status).toBe(500)
    expect(notFoundPair.status).toBe(500)
    expect(missingPause.status).toBe(500)
    expect(missingInject.status).toBe(500)
  })
})
