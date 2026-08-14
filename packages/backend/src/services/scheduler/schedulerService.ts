/**
 * Scheduler Service — 用户提醒 / 定时任务业务服务
 *
 * 管理用户通过对话创建的提醒事项、定时话题和预设反应：
 * - CRUD 操作 (增删查)
 * - 到期检测 (被 BackgroundScheduler 的 cron 任务调用)
 * - 到期后通过 GatewayHub 广播通知前端
 *
 * 的核心能力，
 * 去除 APScheduler 依赖。
 *
 * 三层架构：Service 层 — 负责业务逻辑编排，禁止直接构造 HTTP 响应。
 *
 * @see 三层架构
 * @module packages/backend/src/services/scheduler/schedulerService
 */

import { eq, and, lte } from 'drizzle-orm'
import { scheduledTasks } from '../../database/schema'
import type { DrizzleDb } from '../../database'
import type { GatewayHub } from '../gateway/gatewayHub'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SchedulerService')

// ── 类型 ──

/** 提醒任务类型 */
export type ScheduledTaskType = 'reminder' | 'topic' | 'reaction' | 'agent_task'

/** 创建提醒参数 */
export interface CreateReminderParams {
  /** 触发时间 (ISO 格式) */
  time: string
  /** 提醒内容 */
  content: string
  /** 任务类型: reminder (一次性提醒) | topic (话题) | reaction (预设反应) */
  type?: ScheduledTaskType
  /** Agent ID */
  agentId?: string
}

/** 提醒 DTO (返回给前端/Agent) */
export interface ReminderDto {
  id: number
  type: ScheduledTaskType
  time: string
  content: string
  isTriggered: boolean
  agentId: string
  createdAt: string | null
}

/** 到期触发结果 */
export interface TriggerResult {
  /** 提醒类型 */
  type: ScheduledTaskType
  /** 触发的任务列表 */
  tasks: ReminderDto[]
  /** 为 Agent 生成的指令 */
  instruction: string
}

// ── Service ──

export class SchedulerService {
  constructor(
    private db: DrizzleDb,
    private gatewayHub: GatewayHub,
    /** Agent 管理器（可选注入，用于按 agentId 读取该角色的称呼） */
    private agentManager?: { getOwnerAppellation(agentId: string): string },
  ) {
    logger.info('初始化完成')
  }

  /**
   * 创建提醒/话题/反应
   */
  async create(params: CreateReminderParams): Promise<ReminderDto> {
    const type = params.type ?? 'reminder'
    const agentId = params.agentId ?? 'pero'

    const rows = await this.db
      .insert(scheduledTasks)
      .values({
        type,
        time: params.time,
        content: params.content,
        agentId,
        isTriggered: false,
      })
      .returning()

    const row = rows[0]!
    logger.info(`提醒已创建: [${type}] "${params.content}" → ${params.time}`)

    // 通过 Gateway 通知前端刷新提醒列表
    await this.gatewayHub.pushNotification({
      title: '提醒已设置',
      body: params.content,
    })

    return this.toDto(row)
  }

  /**
   * 获取待触发的提醒列表
   */
  async listPending(agentId = 'pero'): Promise<ReminderDto[]> {
    const rows = await this.db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.agentId, agentId), eq(scheduledTasks.isTriggered, false)))
      .all()

    return rows.map((r) => this.toDto(r))
  }

  /**
   * 取消提醒 (标记为已触发)
   */
  async cancel(id: number): Promise<boolean> {
    const result = await this.db
      .update(scheduledTasks)
      .set({ isTriggered: true })
      .where(eq(scheduledTasks.id, id))
      .returning()

    if (result.length === 0) {
      return false
    }

    logger.info(`提醒已取消: #${id}`)
    return true
  }

  /**
   * 检查到期任务并生成触发指令
   *
   * 由 BackgroundScheduler 的 cron 任务周期性调用。
   * 返回到期任务的 Agent 指令列表 (由调用方决定如何执行)。
   */
  async checkDueTasks(agentId = 'pero'): Promise<TriggerResult[]> {
    const now = new Date().toISOString()
    const results: TriggerResult[] = []

    // 读取该 Agent 的角色级称呼（来自 agent.json，未配置时兜底"主人"）
    const ownerAppellation = this.agentManager?.getOwnerAppellation(agentId) ?? '主人'

    // 查询所有未触发且已到期的任务
    const dueTasks = await this.db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.agentId, agentId),
          eq(scheduledTasks.isTriggered, false),
          lte(scheduledTasks.time, now),
        ),
      )
      .all()

    if (dueTasks.length === 0) return results

    // 按类型分组处理
    const byType = new Map<string, typeof dueTasks>()
    for (const task of dueTasks) {
      const list = byType.get(task.type) ?? []
      list.push(task)
      byType.set(task.type, list)
    }

    // ── 提醒 (逐个触发) ──
    const reminders = byType.get('reminder') ?? []
    for (const task of reminders) {
      await this.markTriggered(task.id)
      results.push({
        type: 'reminder',
        tasks: [this.toDto(task)],
        instruction: `【管理系统提醒：你与${ownerAppellation}的约定时间已到，请主动提醒${ownerAppellation}。约定内容：${task.content}】`,
      })
      logger.info(`提醒触发: "${task.content}"`)
    }

    // ── 话题 (合并触发) ──
    const topics = byType.get('topic') ?? []
    if (topics.length > 0) {
      for (const task of topics) {
        await this.markTriggered(task.id)
      }
      const topicList = topics.map((t) => `- ${t.content}`).join('\n')
      results.push({
        type: 'topic',
        tasks: topics.map((t) => this.toDto(t)),
        instruction: `【管理系统提醒：以下是你之前想找${ownerAppellation}聊的话题（已汇总）：\n${topicList}\n\n请将这些话题自然地融合在一起，作为一次主动的聊天开场。】`,
      })
      logger.info(`话题触发: ${topics.length} 项`)
    }

    // ── 反应 (逐个触发) ──
    const reactions = byType.get('reaction') ?? []
    for (const task of reactions) {
      await this.markTriggered(task.id)
      results.push({
        type: 'reaction',
        tasks: [this.toDto(task)],
        instruction: `【管理系统提醒：你之前决定：'${task.content}'。现在触发时间已到，请立刻执行该行为。】`,
      })
      logger.info(`反应触发: "${task.content}"`)
    }

    // ── 定时 Agent 任务（逐个显式派发） ──
    const agentTasks = byType.get('agent_task') ?? []
    for (const task of agentTasks) {
      await this.markTriggered(task.id)
      results.push({
        type: 'agent_task',
        tasks: [this.toDto(task)],
        instruction: task.content,
      })
      logger.info(`定时 Agent 任务到期: agent=${task.agentId}, "${task.content}"`)
    }

    return results
  }

  // ── 内部方法 ──

  /** 标记任务已触发 */
  private async markTriggered(id: number): Promise<void> {
    await this.db.update(scheduledTasks).set({ isTriggered: true }).where(eq(scheduledTasks.id, id))
  }

  /** 数据库行 → DTO */
  private toDto(row: typeof scheduledTasks.$inferSelect): ReminderDto {
    return {
      id: row.id,
      type: row.type as ScheduledTaskType,
      time: row.time,
      content: row.content,
      isTriggered: row.isTriggered ?? false,
      agentId: row.agentId,
      createdAt: row.createdAt ?? null,
    }
  }
}
