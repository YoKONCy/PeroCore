/**
 * BackgroundTask Router — 统一任务中心 API（M05 §5）
 *
 * 端点：
 * - POST   /api/background-tasks            派发后台任务
 * - GET    /api/background-tasks            分页查询（agentId/status/keyword/时间范围）
 * - GET    /api/background-tasks/active-count 各 Agent 活跃任务数概览
 * - GET    /api/background-tasks/:id        任务详情
 * - POST   /api/background-tasks/:id/pause  暂停
 * - POST   /api/background-tasks/:id/resume 恢复
 * - POST   /api/background-tasks/:id/cancel 取消
 * - DELETE /api/background-tasks/:id        删除记录
 *
 * 事件桥接：
 * 订阅 BackgroundTaskService 的任务事件，通过 GatewayHub 广播给前端
 * （M05 §6 Gateway 事件草案，前端收到后只更新对应任务，不切换前台角色）
 *
 * @module packages/backend/src/routers/backgroundTask.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { createLogger } from '../lib/logger'
import { createEnvelope } from '../services/gateway/types'

const logger = createLogger('BackgroundTaskRouter')

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

/** 派发任务请求 */
const dispatchSchema = z
  .object({
    agentId: z.string().min(1).max(64),
    instruction: z.string().min(1).max(4000),
    title: z.string().max(64).optional(),
    targetThreadId: z.string().min(1).optional(),
    priority: z.number().int().min(1).max(10).optional(),
    completionAction: z.enum(['notify', 'open_result', 'send_to_chat']).optional(),
  })
  .refine((body) => body.completionAction !== 'send_to_chat' || !!body.targetThreadId, {
    message: '发送到对话时必须提供目标 Thread',
    path: ['targetThreadId'],
  })

/** 状态过滤值（与 M05 状态机一致） */
const statusEnum = z.enum([
  'queued',
  'running',
  'paused',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
])

/** 任务恢复请求（手动 resumeInterrupted） */
const resumeInterruptedSchema = z.object({})

const inputSchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny_once']),
  message: z.string().max(2000).optional(),
})

/** 分页查询参数 */
const querySchema = z.object({
  agentId: z.string().optional(),
  status: statusEnum.optional(),
  keyword: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createBackgroundTaskRouter(ctx: AppContext) {
  const router = new Hono()

  /** 依赖缺失时统一报错（仅最小 mock ctx 的集成测试会走到这里） */
  const service = ctx.backgroundTaskService
  const requireService = () => {
    if (!service) {
      throw new AppError('INTERNAL_ERROR', { message: '任务中心服务未初始化' })
    }
    return service
  }

  // ── Gateway 事件桥接：服务事件 → 全端广播 ──
  // 注册一次即可（router 创建即生效），前端通过 /ws 订阅。
  // 防御性判空：集成测试用最小 mock ctx 只构造监控路由，两个依赖可能缺失
  const gatewayHub = ctx.gatewayHub
  if (service && gatewayHub) {
    service.onEvent((event) => {
      gatewayHub
        .broadcast(createEnvelope('push', { action: event.type, task: event.task }))
        .catch((err) => logger.warn(`任务事件广播失败 (${event.type}): ${err}`))
    })
  }

  /** POST /api/background-tasks — 派发后台任务 */
  router.post('/', zValidator('json', dispatchSchema), async (c) => {
    const body = c.req.valid('json')

    // 校验 Agent 存在
    if (!ctx.agentManager.getAgent(body.agentId)) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent 不存在: ${body.agentId}`,
        data: { agentId: body.agentId },
      })
    }

    const task = await service.dispatch({
      agentId: body.agentId,
      instruction: body.instruction,
      title: body.title,
      targetThreadId: body.targetThreadId,
      priority: body.priority,
      requestedBy: 'user',
      completionAction: body.completionAction,
    })
    return c.json({ code: 'OK', data: task }, 201)
  })

  /** GET /api/background-tasks — 分页查询 */
  router.get('/', zValidator('query', querySchema), async (c) => {
    const params = c.req.valid('query')
    const page = await service.query(params)
    return c.json({ code: 'OK', data: page })
  })

  /** GET /api/background-tasks/active-count — 各 Agent 活跃任务数概览 */
  router.get('/active-count', async (c) => {
    const counts = await service.countActiveByAgent()
    return c.json({ code: 'OK', data: counts })
  })

  /** POST /api/background-tasks/mark-all-read — 批量标记历史记录已读 */
  router.post('/mark-all-read', async (c) => {
    const count = await requireService().markAllRead()
    return c.json({ code: 'OK', data: { count } })
  })

  /** POST /api/background-tasks/:id/read — 标记单条历史记录已读 */
  router.post('/:id/read', async (c) => {
    await requireService().markRead(c.req.param('id'))
    return c.json({ code: 'OK' })
  })

  /** GET /api/background-tasks/:id — 任务详情 */
  router.get('/:id', async (c) => {
    const task = await requireService().getTask(c.req.param('id'))
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    return c.json({ code: 'OK', data: task })
  })

  /** POST /api/background-tasks/:id/pause — 暂停 */
  router.post('/:id/pause', async (c) => {
    const task = await requireService().pause(c.req.param('id'))
    return c.json({ code: 'OK', data: task })
  })

  /** POST /api/background-tasks/:id/resume — 恢复 */
  router.post('/:id/resume', async (c) => {
    const task = await requireService().resume(c.req.param('id'))
    return c.json({ code: 'OK', data: task })
  })

  /** POST /api/background-tasks/:id/resume-interrupted — 恢复因服务重启中断的任务（M05-篇3-1） */
  router.post('/:id/resume-interrupted', zValidator('json', resumeInterruptedSchema), async (c) => {
    const task = await requireService().resumeInterrupted(c.req.param('id'))
    return c.json({ code: 'OK', data: task })
  })

  router.post('/:id/input', zValidator('json', inputSchema), async (c) => {
    const task = await requireService().submitInput(c.req.param('id'), c.req.valid('json'))
    return c.json({ code: 'OK', data: task })
  })

  router.post('/:id/retry', async (c) => {
    const task = await requireService().retry(c.req.param('id'))
    return c.json({ code: 'OK', data: task }, 201)
  })

  /** POST /api/background-tasks/:id/cancel — 取消 */
  router.post('/:id/cancel', async (c) => {
    const task = await requireService().cancel(c.req.param('id'))
    return c.json({ code: 'OK', data: task })
  })

  /** DELETE /api/background-tasks/:id — 删除记录 */
  router.delete('/:id', async (c) => {
    await requireService().deleteTask(c.req.param('id'))
    return c.json({ code: 'OK', message: '任务已删除' })
  })

  return router
}
