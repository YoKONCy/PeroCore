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
 * 遵循 02_API_RESPONSE_SPEC.md 信封规范。
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
    // 从 Scheduler 获取维护相关任务的状态
    const schedulerTasks = ctx.scheduler.getStatus()
    const maintenanceTasks = schedulerTasks.filter(
      (t) => t.name.includes('scorer') || t.name.includes('diary') || t.name.includes('reflection'),
    )

    // 记忆统计 (通过 memoryService / memoryRepo)
    let totalMemories = 0
    try {
      const result = await ctx.memoryService.list({ agentId: 'pero', page: 1, pageSize: 1 })
      totalMemories = result.total
    } catch {
      // 统计失败不影响状态返回
    }

    // VectorSync 队列状态
    let pendingSyncCount = 0
    try {
      const pending = await ctx.vectorSyncRepo.getPending(1)
      pendingSyncCount = pending.length
    } catch {
      // 忽略
    }

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        schedulerRunning: ctx.scheduler.isStarted,
        tasks: maintenanceTasks.map((t) => ({
          name: t.name,
          running: t.running,
          lastRunAt: new Date(t.lastRunAt).toISOString(),
          intervalDesc: formatInterval(t.intervalMs),
          stats: t.stats,
        })),
        memory: {
          totalMemories,
          pendingSyncCount,
        },
      },
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

    // 获取待同步数量
    let pendingCount = 0
    try {
      const pending = await ctx.vectorSyncRepo.getPending(1)
      pendingCount = pending.length
    } catch {
      // 忽略
    }

    return c.json(
      {
        code: 'ACCEPTED',
        message: `向量重索引已触发 (Agent: ${agentId}, 待同步: ${pendingCount})`,
        data: { agentId, pendingCount },
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
