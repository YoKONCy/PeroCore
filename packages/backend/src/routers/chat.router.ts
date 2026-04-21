/**
 * Chat Router — 对话 HTTP/SSE 端点
 *
 * 提供完整的对话 API：
 * - POST /api/chat             非流式对话
 * - POST /api/chat/stream       流式对话 (SSE)
 * - POST /api/chat/stop         停止生成
 * - GET  /api/chat/sessions     分页会话列表 (新增)
 * - GET  /api/chat/sessions/:id 会话详情 (新增)
 * - POST /api/chat/session      会话管理
 *
 * SSE 事件类型, B6-3 完整对齐:
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
import type { MemorySource } from '@perocore/shared'
import type { ChatMessage } from '../services/pipeline/types'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.any())]),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
})

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  agentId: z.string().default('pero'),
  source: z.string().default('desktop'),
  sessionId: z.string().default('default'),
  isVoiceMode: z.boolean().optional(),
  extraVars: z.record(z.string()).optional(),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createChatRouter(ctx: AppContext) {
  const router = new Hono()

  // POST /api/chat — 非流式对话
  router.post('/', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')

    // 消息计数 + 陪伴活动通知
    ctx.sessionService?.incrementMessageCount?.(body.agentId)
    ctx.sessionService?.notifyCompanionActivity?.(body.agentId)

    const reply = await ctx.agentService.chat({
      messages: body.messages as ChatMessage[],
      agentId: body.agentId,
      source: body.source as MemorySource,
      sessionId: body.sessionId,
      isVoiceMode: body.isVoiceMode,
      extraVars: body.extraVars,
    })
    return c.json({ code: 'OK', message: '对话完成', data: { reply } })
  })

  // POST /api/chat/stream — 流式对话 (SSE)
  // 完整对齐 6 种 SSE 事件
  router.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')

    // 消息计数 + 陪伴活动通知
    ctx.sessionService?.incrementMessageCount?.(body.agentId)
    ctx.sessionService?.notifyCompanionActivity?.(body.agentId)

    // TaskManager 注册任务
    ctx.taskManager.register(body.sessionId)

    return streamSSE(c, async (stream) => {
      const startTime = Date.now()
      let tokenCount = 0
      let toolCallCount = 0

      try {
        const gen = ctx.agentService.chatStream({
          messages: body.messages as ChatMessage[],
          agentId: body.agentId,
          source: body.source as MemorySource,
          sessionId: body.sessionId,
          isVoiceMode: body.isVoiceMode,
          extraVars: body.extraVars,
        })

        for await (const chunk of gen) {
          // B6-3: 区分 string (文本增量) 和 SseEvent (结构化事件)
          if (typeof chunk === 'string') {
            // delta 事件: 文本增量
            tokenCount += chunk.length
            await stream.writeSSE({
              event: 'delta',
              data: JSON.stringify({ content: chunk }),
            })
          } else if (chunk && typeof chunk === 'object' && 'event' in chunk) {
            // SseEvent 对象: tool_call / tool_result / status
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

        // done 事件: 对话完成 (含 usage 统计)
        const durationMs = Date.now() - startTime
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            usage: {
              promptTokens: 0, // TODO: 从 Provider 获取实际 token 数
              completionTokens: tokenCount,
            },
            toolCallCount,
            durationMs,
          }),
        })
      } catch (err) {
        // error 事件
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
        // 注销任务
        ctx.taskManager.unregister(body.sessionId)
      }
    })
  })

  // POST /api/chat/stop — 停止生成
  router.post('/stop', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const sessionId = ((body as Record<string, unknown>).sessionId as string) ?? 'default'
    ctx.taskManager.cancel(sessionId)
    return c.json({ code: 'OK', message: '已停止生成' })
  })

  // POST /api/chat/session/clear — 清除会话 (新建对话)
  router.post('/session/clear', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'

    if (ctx.sessionService) {
      const newSession = await ctx.sessionService.clearSession(agentId)
      return c.json({
        code: 'OK',
        message: '会话已清除',
        data: { sessionId: newSession.sessionId },
      })
    }
    return c.json({ code: 'OK', message: '会话已清除' })
  })

  // POST /api/chat/session/profile — 切换 Profile
  router.post('/session/profile', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'
    const profile = ((body as Record<string, unknown>).profile as string) ?? 'default'

    if (ctx.sessionService) {
      const session = await ctx.sessionService.switchProfile(
        agentId,
        profile as 'default' | 'lightweight' | 'companion',
      )
      return c.json({
        code: 'OK',
        message: `已切换到 ${profile} 模式`,
        data: { profile: session.profile, sessionId: session.sessionId },
      })
    }
    return c.json({ code: 'OK', message: `已切换到 ${profile} 模式` })
  })

  // ─────────────────────────────────────────────
  // 会话历史查询 (前端 LogsTab 消费)
  // ─────────────────────────────────────────────

  // GET /api/chat/sessions — 分页会话列表
  router.get('/sessions', async (c) => {
    const agentId = c.req.query('agentId') ?? 'pero'
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)))
    const source = c.req.query('source')

    const result = await ctx.logService.listSessionSummaries({
      agentId,
      source,
      page,
      pageSize,
    })

    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  // GET /api/chat/sessions/:sessionId — 某会话的消息列表
  router.get('/sessions/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')
    const agentId = c.req.query('agentId') ?? 'pero'
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100)))

    const logs = await ctx.logService.query({
      agentId,
      sessionId,
      limit,
    })

    // 日志是 DESC 返回的，反转为时间正序
    const messages = logs.reverse().map((log) => ({
      id: log.id,
      role: log.role,
      content: log.content,
      timestamp: log.timestamp ? new Date(log.timestamp).toISOString() : null,
      pairId: log.pairId,
    }))

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        sessionId,
        agentId,
        messages,
        total: messages.length,
      },
    })
  })

  // ─────────────────────────────────────────────
  // 消息编辑/删除 (P2-7)
  // ─────────────────────────────────────────────

  // PATCH /api/chat/messages/:id — 编辑消息内容
  router.patch('/messages/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'id', expected: 'positive integer' },
      })
    }
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const content = (body as Record<string, unknown>).content as string
    if (!content?.trim()) {
      throw new AppError('MISSING_FIELD', {
        message: '内容不能为空',
        data: { field: 'content' },
      })
    }
    const success = await ctx.logService.updateMessage(id, content)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    return c.json({ code: 'OK', message: '消息已更新' })
  })

  // DELETE /api/chat/messages/:id — 删除单条消息
  router.delete('/messages/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'id', expected: 'positive integer' },
      })
    }
    const success = await ctx.logService.deleteMessage(id)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    return c.json({ code: 'OK', message: '消息已删除' })
  })

  // ─────────────────────────────────────────────
  // 任务控制 (P2-11: ReActViewer 消费)
  // ─────────────────────────────────────────────

  // GET /api/chat/tasks — 活跃任务列表
  router.get('/tasks', (c) => {
    const tasks = ctx.taskManager.listActiveTasks()
    return c.json({ code: 'OK', data: tasks })
  })

  // POST /api/chat/task/pause — 暂停任务
  router.post('/task/pause', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const sessionId = ((body as Record<string, unknown>).sessionId as string) ?? ''
    if (!sessionId) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 sessionId',
        data: { field: 'sessionId' },
      })
    }
    const ok = ctx.taskManager.pause(sessionId)
    return ok
      ? c.json({ code: 'OK', message: '任务已暂停' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  // POST /api/chat/task/resume — 恢复任务
  router.post('/task/resume', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const sessionId = ((body as Record<string, unknown>).sessionId as string) ?? ''
    if (!sessionId) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 sessionId',
        data: { field: 'sessionId' },
      })
    }
    const ok = ctx.taskManager.resume(sessionId)
    return ok
      ? c.json({ code: 'OK', message: '任务已恢复' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  // POST /api/chat/task/inject — 注入指令
  router.post('/task/inject', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const sessionId = ((body as Record<string, unknown>).sessionId as string) ?? ''
    const instruction = ((body as Record<string, unknown>).instruction as string) ?? ''
    if (!sessionId || !instruction.trim()) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 sessionId 或 instruction',
        data: { field: 'sessionId, instruction' },
      })
    }
    const ok = ctx.taskManager.inject(sessionId, instruction)
    return ok
      ? c.json({ code: 'OK', message: '指令已注入' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  // ─────────────────────────────────────────────
  // 数据重置 (P2-12: ResetTab 消费)
  // ─────────────────────────────────────────────

  // POST /api/chat/reset — 分级重置
  router.post('/reset', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const action = (body as Record<string, unknown>).action as string
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'

    switch (action) {
      case 'clear_logs': {
        // 通过 logService 删除所有对话日志
        const count = await ctx.logService.deleteAllSessions(agentId)
        return c.json({ code: 'OK', message: `已删除 ${count} 个会话的对话记录` })
      }
      case 'reset_memories': {
        // 通过 memoryService 删除所有记忆
        const { data: memories } = await ctx.memoryService.list({
          agentId,
          page: 1,
          pageSize: 100000,
        })
        for (const mem of memories) {
          await ctx.memoryService.delete(mem.id, agentId)
        }
        return c.json({ code: 'OK', message: `已删除 ${memories.length} 条记忆` })
      }
      case 'factory_reset': {
        // 全量重置: 日志 + 记忆 + 配置
        await ctx.logService.deleteAllSessions(agentId)
        const { data: memories } = await ctx.memoryService.list({
          agentId,
          page: 1,
          pageSize: 100000,
        })
        for (const mem of memories) {
          await ctx.memoryService.delete(mem.id, agentId)
        }
        // 清除该 agent 的配置 (ConfigRepo 是 KV CRUD，Router→Repo 直调是可接受的例外)
        const configs = await ctx.configRepo.listAll(`agent.${agentId}`)
        for (const cfg of configs) {
          await ctx.configRepo.delete(cfg.key)
        }
        return c.json({ code: 'OK', message: '恢复出厂设置完成' })
      }
      default:
        throw new AppError('INVALID_PARAMETER', {
          message: `未知操作: ${action}`,
          data: { field: 'action', expected: 'clear_logs | reset_memories | factory_reset' },
        })
    }
  })

  return router
}
