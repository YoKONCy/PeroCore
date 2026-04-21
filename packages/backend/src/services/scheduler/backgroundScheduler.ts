/**
 * Background Scheduler — 后台定时任务调度器
 *
 * 负责定时触发:
 * 1. Scorer 攒批超时刷新 (maxWaitMs)
 * 2. DiaryEngine 日记生成 (每日)
 * 3. Reflection 周期性维护 (6h 间隔)
 * 4. VectorSync 补偿队列消费
 *
 * 统一调度器管理所有后台任务。
 *
 * @module packages/backend/src/services/scheduler/backgroundScheduler
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('Scheduler')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 定时任务定义 */
interface ScheduledTask {
  /** 任务名 */
  name: string
  /** 执行间隔 (ms) */
  intervalMs: number
  /** 任务处理函数 */
  handler: () => Promise<void>
  /** 上次执行时间 */
  lastRunAt: number
  /** 是否正在运行 */
  running: boolean
  /** 历史执行统计 */
  stats: TaskStats
}

/** 任务统计 */
interface TaskStats {
  totalRuns: number
  successCount: number
  errorCount: number
  lastError?: string
  lastDurationMs?: number
  averageDurationMs: number
}

/** 外部查看的任务状态 */
export interface TaskStatus {
  name: string
  intervalMs: number
  running: boolean
  lastRunAt: number
  stats: TaskStats
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class BackgroundScheduler {
  private tasks = new Map<string, ScheduledTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private tickIntervalMs = 10_000 // 每 10 秒检查一轮
  private started = false

  /**
   * 注册定时任务
   */
  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.tasks.set(name, {
      name,
      intervalMs,
      handler,
      lastRunAt: Date.now(), // 首次启动后等一个周期再执行
      running: false,
      stats: {
        totalRuns: 0,
        successCount: 0,
        errorCount: 0,
        averageDurationMs: 0,
      },
    })
    logger.info(`任务注册: ${name} (间隔=${Math.round(intervalMs / 1000)}s)`)
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
      intervalMs: task.intervalMs,
      running: task.running,
      lastRunAt: task.lastRunAt,
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
      if (now - task.lastRunAt < task.intervalMs) continue

      // 异步执行 (不阻塞 tick 循环)
      void this.runTask(task)
    }
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    task.running = true
    task.lastRunAt = Date.now()
    task.stats.totalRuns++

    const startMs = Date.now()

    try {
      await task.handler()
      task.stats.successCount++
    } catch (err) {
      task.stats.errorCount++
      task.stats.lastError = String(err)
      logger.error(`任务 ${task.name} 执行失败: ${err}`)
    } finally {
      task.running = false
      const durationMs = Date.now() - startMs
      task.stats.lastDurationMs = durationMs

      // 滑动平均耗时
      const prevAvg = task.stats.averageDurationMs
      const runs = task.stats.totalRuns
      task.stats.averageDurationMs = prevAvg + (durationMs - prevAvg) / runs
    }
  }
}
