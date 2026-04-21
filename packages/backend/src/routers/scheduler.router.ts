/**
 * Scheduler Router — 定时任务管理 API
 *
 * 提供后台定时任务的查看、列表和手动触发：
 * - GET  /api/scheduler/status        获取调度器全局状态
 * - GET  /api/scheduler/tasks         获取全部已注册任务列表
 * - POST /api/scheduler/trigger/:name 手动触发一个定时任务
 *
 * 遵循 02_API_RESPONSE_SPEC.md 信封规范。
 *
 * @module packages/backend/src/routers/scheduler.router
 */

import { Hono } from 'hono'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'

export function createSchedulerRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/scheduler/status — 获取调度器全局状态
  router.get('/status', (c) => {
    const tasks = ctx.scheduler.getStatus()
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        running: ctx.scheduler.isStarted,
        taskCount: tasks.length,
        activeTasks: tasks.filter((t) => t.running).length,
      },
    })
  })

  // GET /api/scheduler/tasks — 获取全部已注册任务列表
  router.get('/tasks', (c) => {
    const tasks = ctx.scheduler.getStatus()
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        items: tasks.map((t) => ({
          name: t.name,
          intervalMs: t.intervalMs,
          /** 格式化的间隔描述 */
          intervalDesc: formatInterval(t.intervalMs),
          running: t.running,
          lastRunAt: t.lastRunAt,
          lastRunAtIso: new Date(t.lastRunAt).toISOString(),
          /** 下次预计执行时间 (估算) */
          nextRunAt: t.lastRunAt + t.intervalMs,
          stats: t.stats,
        })),
        total: tasks.length,
      },
    })
  })

  // POST /api/scheduler/trigger/:name — 手动触发
  router.post('/trigger/:name', async (c) => {
    const taskName = c.req.param('name')
    const success = await ctx.scheduler.triggerNow(taskName)
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
