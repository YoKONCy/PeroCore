/**
 * 已废弃的周期调度兼容层。
 *
 * 周期计划现由 KernelScheduler 统一管理；BackgroundScheduler 名称专属于 Agent 后台任务。
 */

import type { KernelExecutionId } from '@infos/shared'
import type { KernelScheduler } from '../../kernel/kernelScheduler'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Scheduler')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 定时任务注册定义 */
export interface ScheduledTaskDefinition {
  /** 内部任务标识 */
  name: string
  /** 中文显示名称 */
  displayName: string
  /** 任务说明 */
  description: string
  /** 执行间隔 (ms) */
  intervalMs: number
  /** 任务处理函数 */
  handler: () => Promise<void>
}

/** 定时任务定义 */
interface ScheduledTask extends ScheduledTaskDefinition {
  /** 下次预计调度到期时间 */
  nextDueAt: number
  /** 是否正在运行 */
  running: boolean
  /** 当前Kernel Execution。 */
  executionId?: KernelExecutionId
  /** 运行时间与结果 */
  execution: TaskExecutionState
  /** 历史执行统计 */
  stats: TaskStats
}

/** 任务执行时间与结果 */
interface TaskExecutionState {
  lastStartedAt: number | null
  lastFinishedAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastOutcome: 'success' | 'error' | null
}

/** 任务统计 */
export interface TaskStats {
  totalRuns: number
  successCount: number
  errorCount: number
  lastError?: string
  lastDurationMs?: number
  averageDurationMs: number
}

/** 外部查看的任务状态 */
export interface TaskStatus extends TaskExecutionState {
  name: string
  displayName: string
  description: string
  intervalMs: number
  running: boolean
  nextDueAt: number
  stats: TaskStats
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class LegacyPeriodicScheduler {
  private tasks = new Map<string, ScheduledTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private tickIntervalMs = 10_000 // 每 10 秒检查一轮
  private started = false

  constructor(private readonly kernelScheduler: KernelScheduler) {}

  /**
   * 注册定时任务
   */
  register(definition: ScheduledTaskDefinition): void {
    const registeredAt = Date.now()
    this.tasks.set(definition.name, {
      ...definition,
      nextDueAt: registeredAt + definition.intervalMs,
      running: false,
      execution: {
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastOutcome: null,
      },
      stats: {
        totalRuns: 0,
        successCount: 0,
        errorCount: 0,
        averageDurationMs: 0,
      },
    })
    logger.info(
      `任务注册: ${definition.displayName} (${definition.name}, 间隔=${Math.round(definition.intervalMs / 1000)}s)`,
    )
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.timer) return

    this.timer = setInterval(() => {
      void this.tick()
    }, this.tickIntervalMs)

    this.started = true
    logger.info(`调度器已启动 (tick=${this.tickIntervalMs}ms, 任务数=${this.tasks.size})`)
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.started = false
    logger.info('调度器已停止')
  }

  /** 调度器是否已启动 */
  get isStarted(): boolean {
    return this.started
  }

  /**
   * 手动触发某个任务 (不等待间隔)
   */
  async triggerNow(name: string): Promise<boolean> {
    const task = this.tasks.get(name)
    if (!task) return false
    if (task.running) {
      logger.warn(`任务 ${name} 正在运行中，跳过手动触发`)
      return false
    }
    await this.runTask(task)
    return true
  }

  /**
   * 获取所有任务状态 (供 /api/admin/scheduler 使用)
   */
  getStatus(): TaskStatus[] {
    return Array.from(this.tasks.values()).map((task) => ({
      name: task.name,
      displayName: task.displayName,
      description: task.description,
      intervalMs: task.intervalMs,
      running: task.running,
      nextDueAt: task.nextDueAt,
      ...task.execution,
      stats: { ...task.stats },
    }))
  }

  /**
   * 获取已注册的任务名列表
   */
  getTaskNames(): string[] {
    return Array.from(this.tasks.keys())
  }

  // ── 内部 ──

  private async tick(): Promise<void> {
    const now = Date.now()

    for (const task of this.tasks.values()) {
      // 跳过正在运行的任务 (防重入)
      if (task.running) continue

      // 检查是否到时间
      if (now < task.nextDueAt) continue

      // 异步执行 (不阻塞 tick 循环)
      void this.runTask(task)
    }
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    const startedAt = Date.now()
    task.running = true
    task.nextDueAt = startedAt + task.intervalMs
    task.execution.lastStartedAt = startedAt
    task.stats.totalRuns++

    try {
      const terminal = await this.kernelScheduler.submitAndWait({
        principalId: 'system',
        taskId: `maintenance:${task.name}:${startedAt}`,
        class: 'maintenance',
        priority: 5,
        resourceKey: `maintenance:${task.name}`,
        budget: { maxDurationMs: Math.max(task.intervalMs, 60_000), maxConcurrentIo: 8 },
        run: async () => task.handler(),
      })
      task.executionId = terminal.descriptor.executionId
      if (terminal.state !== 'completed') {
        throw new Error(
          terminal.state === 'failed'
            ? 'Kernel维护Execution执行失败'
            : `Kernel维护Execution终止: ${terminal.state}`,
        )
      }
      const finishedAt = Date.now()
      task.stats.successCount++
      task.execution.lastSuccessAt = finishedAt
      task.execution.lastOutcome = 'success'
    } catch (err) {
      const failedAt = Date.now()
      task.stats.errorCount++
      task.stats.lastError = String(err)
      task.execution.lastFailureAt = failedAt
      task.execution.lastOutcome = 'error'
      logger.error(`任务 ${task.displayName} (${task.name}) 执行失败: ${err}`)
    } finally {
      const finishedAt = Date.now()
      task.running = false
      task.executionId = undefined
      task.execution.lastFinishedAt = finishedAt
      const durationMs = finishedAt - startedAt
      task.stats.lastDurationMs = durationMs

      const prevAvg = task.stats.averageDurationMs
      const runs = task.stats.totalRuns
      task.stats.averageDurationMs = prevAvg + (durationMs - prevAvg) / runs
    }
  }
}
