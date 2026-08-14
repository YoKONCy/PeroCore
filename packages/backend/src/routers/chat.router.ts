/**
 * Chat Router — 新版对话 HTTP/SSE 端点
 *
 * 基于 Thread + ContextCompiler 架构：
 * - POST /api/chat             非流式对话 { threadId, content, agentId? }
 * - POST /api/chat/stream       流式对话 (SSE) { threadId, content, agentId? }
 * - POST /api/chat/stop         停止生成
 * - GET  /api/threads           Thread 列表
 * - GET  /api/threads/:id       Thread 详情 + 消息
 * - POST /api/threads           创建新 Thread
 * - PATCH /api/threads/:id/messages/:msgId  编辑消息
 * - DELETE /api/threads/:id/messages/:msgId 软删除消息
 * - DELETE /api/threads/:id/messages/:msgId/pair 软删除对话对
 *
 * SSE 事件类型：
 * - delta: 文本增量
 * - tool_call: 工具调用开始
 * - tool_result: 工具执行结果
 * - status: 状态变更 (thinking/calling/generating)
 * - done: 对话完成 (含 usage)
 * - error: 错误
 *
 * @module packages/backend/src/routers/chat.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { resolveToolUserLabel } from '../tools/toolUserLabels'
import { isSystemProtocolTool } from '../tools/systemProtocolTools'
import type { ThreadChannel } from '../repositories/thread.repo'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

/** 新版对话请求：只接受 threadId + content */
const chatRequestSchema = z.object({
  threadId: z.string().min(1),
  content: z.string().min(1),
  /** 可选覆盖 Agent（默认用 Thread 的 agentId） */
  agentId: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
  /** 图片识别方式：原生视觉或专用多模态转述。 */
  imageMode: z.enum(['auto', 'native', 'relay']).optional(),
  /** 工作区隐式上下文：仅注入模型上下文，不写入用户消息正文。 */
  workspaceContext: z
    .object({
      filePath: z.string().max(2048).optional(),
      terminalId: z.string().max(256).optional(),
    })
    .optional(),
})

/**
 * 创建 Thread 请求
 *
 * 注：social/group channel 已从 ContextCompiler 剥离，由社交子 Agent 应用独立处理。
 * 当前 Thread API 服务本地主 Agent 的 desktop 场景。
 */
const createThreadSchema = z.object({
  agentId: z.string().default('pero'),
  channel: z.literal('desktop').default('desktop'),
  platform: z.string().optional(),
  platformIdentifier: z.string().optional(),
  title: z.string().optional(),
})

/** 修改会话标题请求；允许空字符串恢复为“未命名会话”展示。 */
const renameThreadSchema = z.object({
  title: z.string().max(100),
})

/** 编辑消息请求 */
const threadToolsSchema = z.object({
  disabledTools: z.array(z.string().min(1)).max(500),
})

const rewindSchema = z
  .object({
    messageId: z.number().int().positive().optional(),
    wholeThread: z.boolean().optional(),
  })
  .refine((value) => value.wholeThread === true || value.messageId !== undefined, {
    message: '必须指定 messageId 或 wholeThread=true',
  })

const editMessageSchema = z.object({
  content: z.string().min(1),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createChatRouter(ctx: AppContext) {
  const router = new Hono()

  // ─────────────────────────────────────────────
  // 对话接口
  // ─────────────────────────────────────────────

  /**
   * POST /api/chat — 非流式对话
   *
   * 请求体：{ threadId, content, agentId? }
   * 流程：
   * 1. 追加用户消息到 Thread
   * 2. ContextCompiler 编译上下文
   * 3. AgentService 执行对话（ReAct Loop）
   * 4. 追加 Agent 回复到 Thread
   */
  router.post('/', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const { threadId, content } = body

    const result = await ctx.conversationTurnService.executeTurn({
      threadId,
      agentId: body.agentId,
      content,
      attachmentIds: body.attachmentIds,
      imageMode: body.imageMode,
    })

    return c.json({
      code: 'OK',
      message: '对话完成',
      data: { reply: result.reply, threadId: result.threadId, agentId: result.agentId },
    })
  })

  /**
   * POST /api/chat/stream — 流式对话 (SSE)
   *
   * 请求体：{ threadId, content, agentId? }
   */
  router.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const { threadId, content } = body

    // 预先确认 Thread 存在，流式执行本身会在 streamTurn 内统一完成消息持久化。
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }
    const agentId = body.agentId ?? thread.agentId

    // 注册任务，并把同一取消信号传入完整对话链路。
    ctx.runtimeStateService.registerTask(threadId, agentId)
    const signal = ctx.runtimeStateService.getAbortSignal(threadId)

    return streamSSE(c, async (stream) => {
      const startTime = Date.now()
      let tokenCount = 0
      let toolCallCount = 0
      try {
        // 统一流式对话：创建 Pair、编译上下文、保存原始文本与工具调用都由服务处理。
        const gen = ctx.conversationTurnService.streamTurn({
          threadId,
          agentId,
          content,
          attachmentIds: body.attachmentIds,
          imageMode: body.imageMode,
          workspaceContext: body.workspaceContext,
          signal,
        })

        for await (const chunk of gen) {
          if (typeof chunk === 'string') {
            // delta 事件: 文本增量
            tokenCount += chunk.length
            await stream.writeSSE({
              event: 'delta',
              data: JSON.stringify({ content: chunk }),
            })
          } else if (chunk && typeof chunk === 'object' && 'event' in chunk) {
            const sseEvent = chunk as { event: string; data: unknown }
            if (sseEvent.event === 'tool_call') {
              toolCallCount++
            }
            await stream.writeSSE({
              event: sseEvent.event,
              data: JSON.stringify(sseEvent.data),
            })
          }
        }

        // streamTurn 已在生成器自然结束后持久化 assistant 消息。

        // done 事件
        const durationMs = Date.now() - startTime
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            usage: {
              promptTokens: 0,
              completionTokens: tokenCount,
            },
            toolCallCount,
            durationMs,
            threadId,
            agentId,
          }),
        })
      } catch (err) {
        const appError = err instanceof AppError ? err : null
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: appError?.code ?? 'INTERNAL_ERROR',
            message: appError?.message ?? (err instanceof Error ? err.message : String(err)),
            data: appError?.data,
          }),
        })
      } finally {
        ctx.runtimeStateService.unregisterTask(threadId)
      }
    })
  })

  // POST /api/chat/stop — 停止生成
  router.post('/stop', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (threadId) {
      ctx.runtimeStateService.cancelTask(threadId)
    }
    return c.json({ code: 'OK', message: '已停止生成' })
  })

  // ─────────────────────────────────────────────
  // Thread 管理接口
  // ─────────────────────────────────────────────

  /**
   * GET /api/threads — Thread 列表
   *
   * 查询参数：agentId, channel, page, pageSize
   */
  router.get('/threads', async (c) => {
    const agentId = c.req.query('agentId') || undefined
    const channel = c.req.query('channel') ?? undefined
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)))

    const knownAgentIds = ctx.agentManager.listAgents().map((agent) => agent.id)
    if (agentId && !ctx.agentManager.getAgent(agentId)) {
      throw new AppError('NOT_FOUND', { message: `角色不存在: ${agentId}` })
    }

    // M05 §8.3: 普通聊天列表默认排除后台任务 Thread，除非显式传 purpose
    const purpose = c.req.query('purpose') ?? 'conversation'

    const result = await ctx.threadService.listThreads({
      agentId,
      agentIds: agentId ? undefined : knownAgentIds,
      channel,
      // 社交是独立应用；其用于心流生命周期的内部 Thread 不属于主应用对话日志。
      // 同时排除旧版本已误标为 conversation 的 social Thread。
      excludeChannels: ['social'],
      purpose: purpose as import('../repositories/thread.repo').ThreadPurpose,
      page,
      pageSize,
    })

    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  async function assertThreadMutable(threadId: string): Promise<void> {
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const reactBusy = ctx.runtimeStateService
      .listActiveTasks()
      .some((task) => task.threadId === threadId)
    const taskBusy = ctx.backgroundTaskService
      ? await ctx.backgroundTaskService.hasActiveWork({ threadId })
      : false
    if (reactBusy || taskBusy) {
      throw new AppError('CONFLICT', {
        message: '会话关联的 Agent 工作仍在进行，请先停止或等待完成',
      })
    }
  }

  /** 计算 Thread 可配置工具：Registry 通道声明 ∩ Agent/Channel 能力矩阵。 */
  async function resolveThreadTools(threadId: string) {
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const registryTools = ctx.toolRegistry.getDefinitions(thread.channel)
    const allowed = ctx.capabilityGate.hasConfig(thread.agentId)
      ? ctx.capabilityGate.resolve(thread.agentId, thread.channel).allowedTools
      : new Set(registryTools.map((tool) => tool.name))
    const disabled = new Set(thread.disabledTools.filter((name) => !isSystemProtocolTool(name)))
    const tools = registryTools
      .filter((tool) => isSystemProtocolTool(tool.name) || allowed.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        label: resolveToolUserLabel(tool.name, tool.display?.label),
        description: tool.description,
        display: tool.display ?? undefined,
        enabled: isSystemProtocolTool(tool.name) || !disabled.has(tool.name),
        locked: isSystemProtocolTool(tool.name),
      }))
    return { thread, tools }
  }

  /** GET /threads/:id/flow-state — 查看当前 Thread 的心流；group 返回全部 Agent。 */
  router.get('/threads/:id/flow-state', async (c) => {
    const threadId = c.req.param('id')
    const agentId = c.req.query('agentId')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const data = agentId
      ? [await ctx.flowStateService.get(threadId, agentId)]
      : thread.channel === 'group'
        ? await ctx.flowStateService.listByThread(threadId)
        : [await ctx.flowStateService.get(threadId, thread.agentId)]
    return c.json({ code: 'OK', data })
  })

  /** DELETE /threads/:id/flow-state — 用户清空指定 Agent 的当前会话心流。 */
  router.delete('/threads/:id/flow-state', async (c) => {
    const threadId = c.req.param('id')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const agentId = c.req.query('agentId') ?? thread.agentId
    const data = await ctx.flowStateService.clear(threadId, agentId)
    return c.json({ code: 'OK', message: '心流已清空', data })
  })

  /** GET /threads/:id/tools — 仅返回当前 Channel 合法且可由会话控制的工具。 */
  router.get('/threads/:id/tools', async (c) => {
    const { thread, tools } = await resolveThreadTools(c.req.param('id'))
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { threadId: thread.id, channel: thread.channel, tools },
    })
  })

  /** PUT /threads/:id/tools — 持久化禁用集合；禁止提交 Channel 白名单之外的工具。 */
  router.put('/threads/:id/tools', zValidator('json', threadToolsSchema), async (c) => {
    const threadId = c.req.param('id')
    if (ctx.runtimeStateService.listActiveTasks().some((task) => task.threadId === threadId)) {
      throw new AppError('INVALID_PARAMETER', { message: '会话正在生成中，请停止后再修改工具配置' })
    }
    const { tools } = await resolveThreadTools(threadId)
    const configurable = new Set(tools.map((tool) => tool.name))
    const requestedDisabled = [...new Set(c.req.valid('json').disabledTools)]
    const protocolTools = requestedDisabled.filter(isSystemProtocolTool)
    if (protocolTools.length) {
      throw new AppError('INVALID_PARAMETER', {
        message: `系统协议工具不可禁用: ${protocolTools.join(', ')}`,
      })
    }
    const disabledTools = requestedDisabled
    const invalid = disabledTools.filter((name) => !configurable.has(name))
    if (invalid.length) {
      throw new AppError('INVALID_PARAMETER', {
        message: `工具不属于当前 Channel: ${invalid.join(', ')}`,
      })
    }
    await ctx.threadService.updateDisabledTools(threadId, disabledTools)
    return c.json({
      code: 'OK',
      message: '本会话工具配置已保存',
      data: {
        disabledTools,
        tools: tools.map((tool) => ({ ...tool, enabled: !disabledTools.includes(tool.name) })),
      },
    })
  })

  /**
   * GET /api/threads/:id — Thread 详情 + 消息列表
   *
   * 查询参数：page, pageSize（消息分页）
   */
  router.get('/threads/:id', async (c) => {
    const threadId = c.req.param('id')
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? 100)))

    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }

    const messages = await ctx.threadService.listMessages({
      threadId,
      page,
      pageSize,
    })

    const attachmentMap = await ctx.attachmentService.listForMessages(
      messages.items.map((message) => message.id),
    )
    const messagesWithAttachments = messages.items.map((message) => ({
      ...message,
      attachments: attachmentMap.get(message.id) ?? [],
    }))

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        thread,
        messages: messagesWithAttachments,
        total: messages.total,
      },
    })
  })

  /**
   * POST /api/threads — 创建新 Thread
   */
  router.post('/threads', zValidator('json', createThreadSchema), async (c) => {
    const body = c.req.valid('json')
    if (!ctx.agentManager.getAgent(body.agentId)) {
      throw new AppError('NOT_FOUND', { message: `角色不存在: ${body.agentId}` })
    }
    const thread = await ctx.threadService.createThread({
      agentId: body.agentId,
      channel: body.channel as ThreadChannel,
      platform: body.platform,
      platformIdentifier: body.platformIdentifier,
      title: body.title,
    })
    return c.json({ code: 'OK', message: 'Thread 已创建', data: { thread } })
  })

  /**
   * POST /api/threads/latest — 获取或创建 Agent 的最新 Thread
   *
   * 前端打开聊天页时调用，自动获取最新 Thread 或创建新的。
   */
  router.post('/threads/latest', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'
    const channel = 'desktop'

    const thread = await ctx.threadService.getOrCreateLatest(agentId, channel, 'conversation')
    return c.json({ code: 'OK', message: '获取成功', data: { thread } })
  })

  /** PATCH /api/threads/:id — 修改会话标题。 */
  router.patch('/threads/:id', zValidator('json', renameThreadSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    await ctx.threadService.renameThread(threadId, body.title)
    return c.json({ code: 'OK', message: '会话标题已更新' })
  })

  /** POST /threads/:id/rewind-preview — 返回删除及文件回滚清单，不产生副作用。 */
  router.post('/threads/:id/rewind-preview', zValidator('json', rewindSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    const preview = body.wholeThread
      ? await ctx.threadService.previewThreadRewind(threadId)
      : await ctx.threadService.previewMessageRewind(threadId, body.messageId!)
    return c.json({ code: 'OK', message: '预检成功', data: preview })
  })

  /** POST /threads/:id/rewind — 强制回滚文件并链式删除对话历史。 */
  router.post('/threads/:id/rewind', zValidator('json', rewindSchema), async (c) => {
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    const body = c.req.valid('json')
    const preview = body.wholeThread
      ? await ctx.threadService.previewThreadRewind(threadId)
      : await ctx.threadService.previewMessageRewind(threadId, body.messageId!)
    const result = body.wholeThread
      ? await ctx.threadService.rewindThread(threadId)
      : await ctx.threadService.rewindMessage(threadId, body.messageId!)
    if (body.wholeThread) {
      await ctx.flowStateService.deleteThread(threadId)
    } else {
      // “回滚到目标轮次”保留目标轮次完成后的心流，只撤销其后 B/C/D 等轮次的修订。
      const laterPairIds = preview.pairIds.slice(1)
      if (laterPairIds.length) await ctx.flowStateService.rollbackPairs(threadId, laterPairIds)
    }
    return c.json({ code: 'OK', message: '对话、工作区与心流已回滚', data: result })
  })

  /** DELETE /api/threads/:id — 兼容旧客户端：删除时同样回滚整条会话。 */
  router.delete('/threads/:id', async (c) => {
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    await ctx.threadService.rewindThread(threadId)
    await ctx.flowStateService.deleteThread(threadId)
    return c.json({ code: 'OK', message: '会话、工作区与心流已回滚' })
  })

  // ─────────────────────────────────────────────
  // 消息编辑/删除
  // ─────────────────────────────────────────────

  /**
   * PATCH /api/threads/:id/messages/:msgId — 编辑消息内容
   */
  router.patch('/threads/:id/messages/:msgId', zValidator('json', editMessageSchema), async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const body = c.req.valid('json')
    const success = await ctx.threadService.editMessage(msgId, body.content)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    return c.json({ code: 'OK', message: '消息已更新' })
  })

  /**
   * DELETE /api/threads/:id/messages/:msgId — 软删除单条消息
   */
  router.delete('/threads/:id/messages/:msgId', async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const success = await ctx.threadService.deleteMessage(msgId)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    return c.json({ code: 'OK', message: '消息已删除' })
  })

  /**
   * DELETE /api/threads/:id/messages/:msgId/pair — 软删除整对消息
   */
  router.delete('/threads/:id/messages/:msgId/pair', async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    const result = await ctx.threadService.rewindMessage(threadId, msgId)
    return c.json({
      code: 'OK',
      message: `已回滚 ${result.preview.pairCount} 轮对话及关联文件`,
      data: { deletedCount: result.deletedMessageIds.length, preview: result.preview },
    })
  })

  // ─────────────────────────────────────────────
  // 任务控制 (保留)
  // ─────────────────────────────────────────────

  router.get('/tasks', (c) => {
    const tasks = ctx.runtimeStateService.listActiveTasks()
    return c.json({ code: 'OK', message: '获取成功', data: tasks })
  })

  router.post('/tasks/pause', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (!threadId) {
      throw new AppError('MISSING_FIELD', { message: '缺少 threadId', data: { field: 'threadId' } })
    }
    const ok = ctx.runtimeStateService.pauseTask(threadId)
    return ok
      ? c.json({ code: 'OK', message: '任务已暂停' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  router.post('/tasks/resume', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (!threadId) {
      throw new AppError('MISSING_FIELD', { message: '缺少 threadId', data: { field: 'threadId' } })
    }
    const ok = ctx.runtimeStateService.resumeTask(threadId)
    return ok
      ? c.json({ code: 'OK', message: '任务已恢复' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  router.post('/tasks/inject', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    const instruction = ((body as Record<string, unknown>).instruction as string) ?? ''
    if (!threadId || !instruction.trim()) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 threadId 或 instruction',
        data: { field: 'threadId, instruction' },
      })
    }
    const ok = ctx.runtimeStateService.injectInstruction(threadId, instruction)
    return ok
      ? c.json({ code: 'OK', message: '指令已注入' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  return router
}
