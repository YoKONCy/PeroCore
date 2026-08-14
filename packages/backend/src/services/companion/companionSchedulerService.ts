/**
 * Companion Scheduler Service — 陪伴调度器管理服务
 *
 * 从 SessionService 解耦出来的 CompanionScheduler 生命周期管理。
 * AIOS 重构废弃 SessionService 后，由本服务统一负责:
 * - Agent → CompanionScheduler 实例映射
 * - 启动 / 停止 / 通知活动
 * - 工厂函数注入 (由 container.ts 设置)
 *
 * 原先由 SessionService 承担的职责映射:
 * - setCompanionSchedulerFactory → setSchedulerFactory
 * - notifyCompanionActivity       → notifyActivity
 * - startCompanionScheduler       → start
 * - stopCompanionScheduler        → stop
 *
 * @module packages/backend/src/services/companion/companionSchedulerService
 */

import { createLogger } from '../../lib/logger'
import type { CompanionScheduler } from './companionScheduler'

const logger = createLogger('CompanionSchedulerService')

/** 陪伴调度器工厂函数 (由 container.ts 注入) */
export type CompanionSchedulerFactory = (agentId: string) => CompanionScheduler

export class CompanionSchedulerService {
  /** 工厂函数 (由 container.ts 调用 setSchedulerFactory 注入) */
  private factory: CompanionSchedulerFactory | null = null

  /** 运行中的调度器实例 (agentId → scheduler) */
  private schedulers = new Map<string, CompanionScheduler>()

  constructor() {}

  /**
   * 注入调度器工厂 (由 container.ts 调用)
   */
  setSchedulerFactory(factory: CompanionSchedulerFactory): void {
    this.factory = factory
  }

  /**
   * 启动某 Agent 的陪伴调度
   *
   * 已有运行中实例则跳过；否则调用工厂创建实例并 start()。
   */
  start(agentId: string): void {
    // 已有运行中实例则跳过
    const existing = this.schedulers.get(agentId)
    if (existing && existing.isRunning) {
      logger.warn(`陪伴调度已在运行中: agent=${agentId}`)
      return
    }

    if (!this.factory) {
      logger.warn('陪伴调度器工厂未注入，无法启动')
      return
    }

    const scheduler = this.factory(agentId)
    scheduler.start()
    this.schedulers.set(agentId, scheduler)
    logger.info(`陪伴调度已启动: agent=${agentId}`)
  }

  /**
   * 停止某 Agent 的陪伴调度
   *
   * 找到实例调用 stop()，并从 map 移除。
   */
  async stop(agentId: string): Promise<void> {
    const scheduler = this.schedulers.get(agentId)
    if (!scheduler) return

    await scheduler.stop()
    this.schedulers.delete(agentId)
    logger.info(`陪伴调度已停止: agent=${agentId}`)
  }

  /**
   * 通知某 Agent 有用户活动 (重置空闲计时器)
   *
   * 找不到实例则忽略。
   */
  notifyActivity(agentId: string): void {
    const scheduler = this.schedulers.get(agentId)
    if (!scheduler) return
    scheduler.notifyActivity()
  }

  /**
   * 批量读取指定 Agent 的陪伴调度状态。
   *
   * 该接口只暴露只读运行状态，不会隐式创建或启动调度器，供任务中心统一展示。
   */
  listStates(agentIds: string[]): Array<{ agentId: string; enabled: boolean }> {
    return agentIds.map((agentId) => ({
      agentId,
      enabled: this.isRunning(agentId),
    }))
  }

  /**
   * 检查某 Agent 的调度器是否运行中
   */
  isRunning(agentId: string): boolean {
    const scheduler = this.schedulers.get(agentId)
    return scheduler?.isRunning ?? false
  }
}
