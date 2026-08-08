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
})

/**
 * 创建 Thread 请求
 *
 * 注：social/group channel 已从 ContextCompiler 剥离，由社交子 Agent 应用独立处理。
 * 当前 Thread API 仅服务主 Agent 场景（desktop/companion）。
 */
const createThreadSchema = z.object({
  agentId: z.string().default('pero'),
  channel: z.enum(['desktop', 'companion']).default('desktop'),
  platform: z.string().optional(),
  platformIdentifier: z.string().optional(),
  title: z.string().optional(),
})

/** 编辑消息请求 */
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

    // 获取 Thread，确定 agentId
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }
    const agentId = body.agentId ?? thread.agentId

    // 1. 追加用户消息
    await ctx.threadService.appendUserMessage(threadId, content)

    // 2. 编译上下文
    const compiled = await ctx.contextCompiler.compile(threadId, agentId)

    // 3. 执行对话
    const reply = await ctx.agentService.chatWithCompiledMessages({
      messages: compiled.messages,
      agentId,
      threadId,
    })

    // 4. 追加 Agent 回复
    const pairId = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // 用户消息的 pairId 需要更新（或者我们改用 saveMessagePair 方式）
    // 这里先用简单方式：直接追加 assistant 消息
    await ctx.threadService.appendAssistantMessage({
      threadId,
      content: reply,
      pairId,
      agentId,
    })

    return c.json({ code: 'OK', message: '对话完成', data: { reply, threadId, agentId } })
  })

  /**
   * POST /api/chat/stream — 流式对话 (SSE)
   *
   * 请求体：{ threadId, content, agentId? }
   */
  router.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const { threadId, content } = body

    // 获取 Thread
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }
    const agentId = body.agentId ?? thread.agentId

    // 1. 追加用户消息
    await ctx.threadService.appendUserMessage(threadId, content)

    // 2. 编译上下文
    const compiled = await ctx.contextCompiler.compile(threadId, agentId)

    // 3. 注册任务
    ctx.runtimeStateService.registerTask(threadId)

    return streamSSE(c, async (stream) => {
      const startTime = Date.now()
      let tokenCount = 0
      let toolCallCount = 0
      let fullReply = ''

      try {
        // 4. 流式对话
        // AIOS: 透传 Thread channel 给 AgentService，用于工具过滤和权限校验
        const gen = ctx.agentService.chatStreamWithCompiledMessages({
          messages: compiled.messages,
          agentId,
          threadId,
          channel: thread.channel,
        })

        for await (const chunk of gen) {
          if (typeof chunk === 'string') {
            // delta 事件: 文本增量
            tokenCount += chunk.length
            fullReply += chunk
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

        // 5. 追加 Agent 回复到 Thread
        const pairId = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        if (fullReply) {
          await ctx.threadService.appendAssistantMessage({
            threadId,
            content: fullReply,
            pairId,
            agentId,
          })
        }

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
        const errMsg = err instanceof Error ? err.message : String(err)
        const isLlmError =
          errMsg.includes('API') || errMsg.includes('timeout') || errMsg.includes('超时')
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: isLlmError ? 'LLM_ERROR' : 'INTERNAL_ERROR',
            message: errMsg,
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
    const agentId = c.req.query('agentId') ?? 'pero'
    const channel = c.req.query('channel') ?? undefined
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)))

    const result = await ctx.threadService.listThreads({
      agentId,
      channel,
      page,
      pageSize,
    })

    return c.json({ code: 'OK', message: '获取成功', data: result })
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

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        thread,
        messages: messages.items,
        total: messages.total,
      },
    })
  })

  /**
   * POST /api/threads — 创建新 Thread
   */
  router.post('/threads', zValidator('json', createThreadSchema), async (c) => {
    const body = c.req.valid('json')
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
    const channel = ((body as Record<string, unknown>).channel as string) ?? 'desktop'

    const thread = await ctx.threadService.getOrCreateLatest(
      agentId,
      channel as ThreadChannel,
    )
    return c.json({ code: 'OK', message: '获取成功', data: { thread } })
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
    const count = await ctx.threadService.deleteMessagePair(msgId)
    if (count === 0) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    return c.json({
      code: 'OK',
      message: `已删除 ${count} 条关联消息`,
      data: { deletedCount: count },
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
