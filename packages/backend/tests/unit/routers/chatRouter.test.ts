import { describe, expect, it, vi } from 'vitest'
import { createChatRouter } from '@infos/backend/routers/chat.router'

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

/** 测试用 Thread 数据 */
function createThread() {
  return {
    id: 't1',
    agentId: 'pero',
    channel: 'desktop',
    platform: undefined,
    platformIdentifier: undefined,
    title: '测试 Thread',
    messageCount: 0,
    pairCount: 0,
    lastMessageAt: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** 测试用消息列表（倒序，最新在前，与 listMessages 行为一致） */
function createMessages() {
  return [
    {
      id: 2,
      threadId: 't1',
      role: 'assistant',
      content: '回复',
      rawContent: null,
      pairId: 'p1',
      senderId: null,
      agentId: 'pero',
      revision: 1,
      metadataJson: '{}',
      timestamp: '2026-01-02T00:00:00.000Z',
      status: 'active',
    },
    {
      id: 1,
      threadId: 't1',
      role: 'user',
      content: '你好',
      rawContent: 'raw',
      pairId: 'p1',
      senderId: null,
      agentId: null,
      revision: 1,
      metadataJson: '{}',
      timestamp: '2026-01-01T00:00:00.000Z',
      status: 'active',
    },
  ]
}

function createCtx() {
  const thread = createThread()
  const messages = createMessages()
  return {
    agentService: {
      chatWithCompiledMessages: vi.fn(() => Promise.resolve('回复')),
      chatStreamWithCompiledMessages: vi.fn(),
    },
    agentManager: {
      getAgent: vi.fn((agentId: string) => (agentId === 'pero' ? { id: 'pero' } : undefined)),
      listAgents: vi.fn(() => [{ id: 'pero' }]),
    },
    // AIOS: ThreadService 替代旧 SessionService + LogService
    threadService: {
      getThread: vi.fn(() => Promise.resolve(thread)),
      appendUserMessage: vi.fn(() => Promise.resolve(messages[1])),
      appendAssistantMessage: vi.fn(() => Promise.resolve(messages[0])),
      listThreads: vi.fn(() => Promise.resolve({ items: [thread], total: 1 })),
      listMessages: vi.fn(() => Promise.resolve({ items: messages, total: messages.length })),
      createThread: vi.fn(() => Promise.resolve(thread)),
      getOrCreateLatest: vi.fn(() => Promise.resolve(thread)),
      editMessage: vi.fn(() => Promise.resolve(true)),
      deleteMessage: vi.fn(() => Promise.resolve(true)),
      deleteMessagePair: vi.fn(() => Promise.resolve(2)),
      rewindMessage: vi.fn(() =>
        Promise.resolve({
          deletedMessageIds: [1, 2],
          preview: { pairCount: 1, messageCount: 2, affectedPaths: [] },
        }),
      ),
      deleteThread: vi.fn(() => Promise.resolve(true)),
    },
    // AIOS: ContextCompiler 编译上下文
    contextCompiler: {
      compile: vi.fn(() =>
        Promise.resolve({
          messages: [{ role: 'system', content: 'system prompt' }],
          manifest: {},
        }),
      ),
    },
    conversationTurnService: {
      executeTurn: vi.fn(() =>
        Promise.resolve({
          reply: '回复',
          rawContent: '回复',
          toolCalls: [],
          threadId: 't1',
          agentId: 'pero',
        }),
      ),
      streamTurn: vi.fn(),
    },
    attachmentService: {
      listForMessages: vi.fn(() => Promise.resolve(new Map())),
    },
    toolRegistry: {
      getDefinitions: vi.fn(() => []),
    },
    capabilityGate: {
      resolve: vi.fn(() => ({ allowedTools: new Set<string>() })),
    },
    flowStateService: {
      get: vi.fn(),
      listByThread: vi.fn(),
      clear: vi.fn(),
    },
    backgroundTaskService: {
      hasActiveWork: vi.fn(() => Promise.resolve(false)),
    },
    // AIOS: RuntimeStateService 替代旧 TaskManager（按 threadId 索引）
    runtimeStateService: {
      registerTask: vi.fn(),
      unregisterTask: vi.fn(),
      cancelTask: vi.fn(() => true),
      listActiveTasks: vi.fn(() => []),
      pauseTask: vi.fn((threadId: string) => threadId === 't1'),
      resumeTask: vi.fn((threadId: string) => threadId === 't1'),
      injectInstruction: vi.fn((threadId: string) => threadId === 't1'),
    },
  }
}

describe('ChatRouter', () => {
  it('group 会话工具应严格限制为 Channel 白名单，不得回退注册表全量工具', async () => {
    const ctx = createCtx()
    const registryTools = Array.from({ length: 44 }, (_, index) => ({
      name: index < 6 ? `group_tool_${index}` : `other_tool_${index}`,
      description: `工具 ${index}`,
    }))
    ctx.threadService.getThread.mockResolvedValue({
      ...createThread(),
      channel: 'group',
      disabledTools: [],
    } as never)
    ctx.toolRegistry.getDefinitions.mockReturnValue(registryTools)
    ctx.capabilityGate.resolve.mockReturnValue({
      allowedTools: new Set(registryTools.slice(0, 6).map((tool) => tool.name)),
    })
    const router = createChatRouter(ctx as never)

    const response = await router.request('http://test/threads/t1/tools')
    const body = (await response.json()) as {
      data: { tools: Array<{ name: string }> }
    }

    expect(body.data.tools).toHaveLength(6)
    expect(body.data.tools.map((tool) => tool.name)).toEqual(
      registryTools.slice(0, 6).map((tool) => tool.name),
    )
  })

  it('应当执行非流式对话: 获取 Thread→追加用户消息→编译上下文→对话→追加 Agent 回复', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    // 不传 agentId，验证从 thread.agentId 取默认值的逻辑
    const response = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1', content: '你好' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(response)).toMatchObject({
      code: 'OK',
      message: '对话完成',
      data: { reply: '回复', threadId: 't1', agentId: 'pero' },
    })
    expect(ctx.conversationTurnService.executeTurn).toHaveBeenCalledWith({
      threadId: 't1',
      agentId: undefined,
      content: '你好',
      attachmentIds: undefined,
    })
  })

  it('应当停止生成、创建 Thread 并获取最新 Thread', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const stopped = await router.request('http://test/stop', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1' }),
      headers: { 'content-type': 'application/json' },
    })
    const created = await router.request('http://test/threads', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero', channel: 'desktop', title: '新对话' }),
      headers: { 'content-type': 'application/json' },
    })
    const latest = await router.request('http://test/threads/latest', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero', channel: 'desktop' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(stopped)).toEqual({ code: 'OK', message: '已停止生成' })
    expect(ctx.runtimeStateService.cancelTask).toHaveBeenCalledWith('t1')
    expect(await readJson(created)).toMatchObject({
      code: 'OK',
      message: 'Thread 已创建',
      data: { thread: { id: 't1', agentId: 'pero' } },
    })
    expect(ctx.threadService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'pero',
        channel: 'desktop',
        title: '新对话',
      }),
    )
    expect(await readJson(latest)).toMatchObject({
      code: 'OK',
      message: '获取成功',
      data: { thread: { id: 't1', agentId: 'pero' } },
    })
    expect(ctx.threadService.getOrCreateLatest).toHaveBeenCalledWith(
      'pero',
      'desktop',
      'conversation',
    )
  })

  it('应当查询 Thread 列表和 Thread 详情(含消息列表)', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const list = await router.request(
      'http://test/threads?agentId=pero&channel=desktop&page=1&pageSize=10',
    )
    const detail = await router.request('http://test/threads/t1?page=1&pageSize=20')

    expect(await readJson(list)).toMatchObject({
      code: 'OK',
      message: '获取成功',
      data: { items: [{ id: 't1' }], total: 1 },
    })
    expect(ctx.threadService.listThreads).toHaveBeenCalledWith({
      agentId: 'pero',
      agentIds: undefined,
      channel: 'desktop',
      excludeChannels: ['social'],
      page: 1,
      pageSize: 10,
      // M05 §8.3: 普通聊天列表默认 conversation purpose（排除后台任务 Thread）
      purpose: 'conversation',
    })
    // 详情: messages 为 items（倒序，最新在前），total 为消息总数
    expect(await readJson(detail)).toMatchObject({
      code: 'OK',
      message: '获取成功',
      data: {
        thread: { id: 't1' },
        messages: [{ id: 2 }, { id: 1 }],
        total: 2,
      },
    })
    expect(ctx.threadService.getThread).toHaveBeenCalledWith('t1')
    expect(ctx.threadService.listMessages).toHaveBeenCalledWith({
      threadId: 't1',
      page: 1,
      pageSize: 20,
    })
  })

  it('应当编辑、删除单条消息和级联删除消息对', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    const patched = await router.request('http://test/threads/t1/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: '新内容' }),
      headers: { 'content-type': 'application/json' },
    })
    const deleted = await router.request('http://test/threads/t1/messages/1', {
      method: 'DELETE',
    })
    const pairDeleted = await router.request('http://test/threads/t1/messages/1/pair', {
      method: 'DELETE',
    })

    expect(await readJson(patched)).toEqual({ code: 'OK', message: '消息已更新' })
    expect(ctx.threadService.editMessage).toHaveBeenCalledWith(1, '新内容')
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '消息已删除' })
    expect(ctx.threadService.deleteMessage).toHaveBeenCalledWith(1)
    expect(await readJson(pairDeleted)).toMatchObject({
      code: 'OK',
      data: { deletedCount: 2 },
    })
    expect(ctx.threadService.rewindMessage).toHaveBeenCalledWith('t1', 1)
  })

  it('应当管理活跃任务: 列出/暂停/恢复/注入', async () => {
    const ctx = createCtx()
    const router = createChatRouter(ctx as never)

    ctx.runtimeStateService.listActiveTasks.mockReturnValueOnce([
      { threadId: 't1', state: 'running' },
    ])
    const tasks = await router.request('http://test/tasks')
    const paused = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1' }),
      headers: { 'content-type': 'application/json' },
    })
    const missingPause = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'missing' }),
      headers: { 'content-type': 'application/json' },
    })
    const resumed = await router.request('http://test/tasks/resume', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1' }),
      headers: { 'content-type': 'application/json' },
    })
    const injected = await router.request('http://test/tasks/inject', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1', instruction: '继续' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(tasks)).toMatchObject({ code: 'OK', data: [{ threadId: 't1' }] })
    expect(await readJson(paused)).toEqual({ code: 'OK', message: '任务已暂停' })
    // pauseTask 返回 false 时路由返回 404
    expect(missingPause.status).toBe(404)
    expect(await readJson(resumed)).toEqual({ code: 'OK', message: '任务已恢复' })
    expect(await readJson(injected)).toEqual({ code: 'OK', message: '指令已注入' })
    expect(ctx.runtimeStateService.pauseTask).toHaveBeenCalledWith('t1')
    expect(ctx.runtimeStateService.resumeTask).toHaveBeenCalledWith('t1')
    expect(ctx.runtimeStateService.injectInstruction).toHaveBeenCalledWith('t1', '继续')
  })

  it('应当拒绝非法对话、非法消息和缺失任务参数', async () => {
    const ctx = createCtx()
    // 让 service 返回失败值，触发 AppError NOT_FOUND
    ctx.threadService.editMessage.mockResolvedValueOnce(false)
    ctx.threadService.deleteMessage.mockResolvedValueOnce(false)
    ctx.threadService.rewindMessage.mockRejectedValueOnce(new Error('消息不存在'))
    const router = createChatRouter(ctx as never)

    // 非法对话: 缺 threadId 和 content → zValidator 400
    const invalidChat = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ messages: [] }),
      headers: { 'content-type': 'application/json' },
    })
    // 非法消息 ID (msgId=0) → AppError INVALID_PARAMETER → 500
    const invalidPatchId = await router.request('http://test/threads/t1/messages/0', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
    // 空内容 (content 长度 0) → zValidator 400
    const missingPatch = await router.request('http://test/threads/t1/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: '' }),
      headers: { 'content-type': 'application/json' },
    })
    // 消息不存在: editMessage 返回 false → AppError NOT_FOUND → 500
    const notFoundPatch = await router.request('http://test/threads/t1/messages/1', {
      method: 'PATCH',
      body: JSON.stringify({ content: '新内容' }),
      headers: { 'content-type': 'application/json' },
    })
    // 删除消息不存在 → AppError NOT_FOUND → 500
    const notFoundDelete = await router.request('http://test/threads/t1/messages/1', {
      method: 'DELETE',
    })
    // 删除对话对不存在 → AppError NOT_FOUND → 500
    const notFoundPair = await router.request('http://test/threads/t1/messages/1/pair', {
      method: 'DELETE',
    })
    // 缺 threadId → AppError MISSING_FIELD → 500
    const missingPause = await router.request('http://test/tasks/pause', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    // 空 instruction → AppError MISSING_FIELD → 500
    const missingInject = await router.request('http://test/tasks/inject', {
      method: 'POST',
      body: JSON.stringify({ threadId: 't1', instruction: ' ' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(invalidChat.status).toBe(400)
    expect(invalidPatchId.status).toBe(500)
    expect(missingPatch.status).toBe(400)
    expect(notFoundPatch.status).toBe(500)
    expect(notFoundDelete.status).toBe(500)
    expect(notFoundPair.status).toBe(500)
    expect(missingPause.status).toBe(500)
    expect(missingInject.status).toBe(500)
  })
})
