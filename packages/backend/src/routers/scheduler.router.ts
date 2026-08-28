/**
 * Scheduler Router — 定时任务管理 API
 *
 * 提供后台定时任务的查看、列表和手动触发：
 * - GET  /api/scheduler/status        获取调度器全局状态
 * - GET  /api/scheduler/tasks         获取全部已注册任务列表
 * - POST /api/scheduler/trigger/:name 手动触发一个定时任务
 *
 * 遵循 .docs/S02_API_SPEC.md 信封规范。
 *
 * @module packages/backend/src/routers/scheduler.router
 */

import { Hono } from 'hono'
import { AppError } from '../lib/appError'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import type { AppContext } from '../container'

export function createSchedulerRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/scheduler/status — 获取调度器全局状态
  router.get('/status', (c) => {
    const tasks = ctx.scheduler.getPeriodicScheduleStatus()
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        schedulerRunning: ctx.scheduler.isPeriodicStarted,
        serverNow: Date.now(),
        taskCount: tasks.length,
        activeTasks: tasks.filter((t) => t.running).length,
      },
    })
  })

  // GET /api/scheduler/tasks — 获取全部已注册任务列表
  router.get('/tasks', (c) => {
    const tasks = ctx.scheduler.getPeriodicScheduleStatus()
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        schedulerRunning: ctx.scheduler.isPeriodicStarted,
        serverNow: Date.now(),
        items: tasks.map((t) => ({
          ...t,
          intervalDesc: formatInterval(t.intervalMs),
        })),
        total: tasks.length,
      },
    })
  })

  // GET /api/scheduler/reminders — 获取待触发的用户提醒列表
  router.get('/reminders', async (c) => {
    const agentId = c.req.query('agentId') ?? undefined
    const reminders = await ctx.schedulerService.listPending(agentId)
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        items: reminders,
        total: reminders.length,
      },
    })
  })

  router.post(
    '/agent-tasks',
    zValidator(
      'json',
      z.object({
        agentId: z.string().min(1).max(64),
        time: z.string().min(1),
        instruction: z.string().min(1).max(4000),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json')
      if (!ctx.agentManager.getAgent(body.agentId)) {
        throw new AppError('NOT_FOUND', { message: `角色不存在: ${body.agentId}` })
      }
      const item = await ctx.schedulerService.create({
        type: 'agent_task',
        agentId: body.agentId,
        time: body.time,
        content: body.instruction,
      })
      return c.json({ code: 'CREATED', message: '提醒已创建', data: item }, 201)
    },
  )

  // POST /api/scheduler/trigger/:name — 手动触发
  router.post('/trigger/:name', async (c) => {
    const taskName = c.req.param('name')
    const success = await ctx.scheduler.triggerPeriodicNow(taskName)
    if (!success) {
      throw new AppError('NOT_FOUND', {
        message: `定时任务 "${taskName}" 不存在或正在运行中`,
        data: { taskName },
      })
    }
    return c.json(
      {
        code: 'ACCEPTED',
        message: `任务 "${taskName}" 已触发`,
        data: { taskName },
      },
      202,
    )
  })

  return router
}

// ── 辅助函数 ──

/** 将毫秒间隔转为可读描述 */
function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}秒`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}分钟`
  return `${(ms / 3600_000).toFixed(1)}小时`
}
