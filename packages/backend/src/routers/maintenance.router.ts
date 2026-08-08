/**
 * Maintenance Router — 记忆维护 API
 *
 * 暴露记忆维护子系统的手动触发和状态查询端点：
 * - GET  /api/maintenance/status     维护系统状态
 * - POST /api/maintenance/trigger    手动触发维护任务
 * - POST /api/maintenance/reindex    触发向量重索引
 *
 * 维护子系统包含 7 个子模块:
 * Tagger, Consolidator, Auditor, RetirementPolicy,
 * DreamAssociator, GraphGardener, ReflectionOrchestrator
 *
 * 遵循 .docs/S02_API_SPEC.md 信封规范。
 *
 * @module packages/backend/src/routers/maintenance.router
 */

import { Hono } from 'hono'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'

export function createMaintenanceRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/maintenance/status — 维护系统状态
  router.get('/status', async (c) => {
    const status = await ctx.maintenanceService.getStatus()

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: status,
    })
  })

  // POST /api/maintenance/trigger — 手动触发维护任务
  router.post('/trigger', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const taskName = (body as Record<string, unknown>).task as string | undefined

    if (!taskName) {
      throw new AppError('MISSING_FIELD', {
        message: '请指定要触发的任务名称',
        data: { field: 'task', available: ctx.scheduler.getTaskNames() },
      })
    }

    // 通过 Scheduler 触发
    const success = await ctx.scheduler.triggerNow(taskName)
    if (!success) {
      throw new AppError('NOT_FOUND', {
        message: `维护任务 "${taskName}" 不存在或正在运行中`,
        data: { taskName, available: ctx.scheduler.getTaskNames() },
      })
    }

    return c.json(
      {
        code: 'ACCEPTED',
        message: `维护任务 "${taskName}" 已触发`,
        data: { taskName },
      },
      202,
    )
  })

  // POST /api/maintenance/reindex — 触发向量重索引
  router.post('/reindex', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'

    // 检查是否有重索引任务正在运行
    const tasks = ctx.scheduler.getStatus()
    const reindexTask = tasks.find((t) => t.name === 'vector-reindex')
    if (reindexTask?.running) {
      throw new AppError('TASK_ALREADY_RUNNING', {
        message: '向量重索引正在运行中，请稍后再试',
      })
    }

    const reindexStatus = await ctx.maintenanceService.getReindexStatus(agentId)

    return c.json(
      {
        code: 'ACCEPTED',
        message: `向量重索引已触发 (Agent: ${agentId}, 待同步: ${reindexStatus.pendingCount})`,
        data: reindexStatus,
      },
      202,
    )
  })

  return router
}
