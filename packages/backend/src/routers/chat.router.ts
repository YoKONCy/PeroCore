/**
 * Chat Router — 对话 HTTP/SSE 端点
 *
 * 提供完整的对话 API：
 * - POST /api/chat        非流式对话
 * - POST /api/chat/stream  流式对话 (SSE, 02_API_RESPONSE_SPEC.md §9)
 * - POST /api/chat/stop    停止生成
 * - POST /api/chat/session  会话管理
 *
 * SSE 事件类型 (§9), B6-3 完整对齐:
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

    // 消息计数
    ctx.sessionService?.incrementMessageCount?.(body.agentId)

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
  // B6-3: 完整对齐 02_API_RESPONSE_SPEC.md §9 的 6 种 SSE 事件
  router.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')

    // 消息计数
    ctx.sessionService?.incrementMessageCount?.(body.agentId)

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
    const profile = (body as Record<string, unknown>).profile as string ?? 'default'

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

  return router
}
