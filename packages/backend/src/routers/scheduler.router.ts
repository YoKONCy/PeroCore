/**
 * Scheduler Router — 定时任务管理 API
 *
 * 提供后台定时任务的查看和手动触发：
 * - GET  /api/scheduler/status        获取调度器状态
 * - POST /api/scheduler/trigger/:name 手动触发一个定时任务
 *
 * @module packages/backend/src/routers/scheduler.router
 */

import { Hono } from 'hono'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'

export function createSchedulerRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/scheduler/status — 获取调度器状态
  router.get('/status', (c) => {
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        // BackgroundScheduler 目前没有 listTasks，返回基本状态
        running: true,
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
