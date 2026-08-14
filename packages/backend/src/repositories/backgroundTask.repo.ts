/**
 * BackgroundTask Repository（M05 §4.1）
 *
 * background_tasks 表的数据访问层。
 * 职责：
 * - 创建和更新任务
 * - 分页查询（按 Agent / 状态 / 时间 / 关键字筛选）
 * - 原子状态迁移（带来源状态守卫，防止乱序覆盖）
 * - 获取指定 Agent 的执行队列
 * - 服务重启后的未完成任务恢复查询
 *
 * @module packages/backend/src/repositories/backgroundTask.repo
 */

import { eq, desc, and, inArray, like, gte, lte, sql } from 'drizzle-orm'
import { backgroundTasks } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 任务状态机（M05 §4） */
export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 任务来源 */
export type BackgroundTaskSource = 'user' | 'agent' | 'scheduler' | 'runtime'

/** 完成后行为 */
export type CompletionAction = 'notify' | 'open_result' | 'send_to_chat'

/** 任务类别；常驻任务不会进入普通执行队列。 */
export type BackgroundTaskCategory = 'agent_task' | 'resident'

/** 创建任务输入 */
export interface CreateBackgroundTaskInput {
  id: string
  agentId: string
  threadId: string
  targetThreadId?: string | null
  title: string
  instruction: string
  priority?: number
  parentTaskId?: string | null
  requestedBy?: BackgroundTaskSource
  completionAction?: CompletionAction
  category?: BackgroundTaskCategory
  status?: BackgroundTaskStatus
  metadataJson?: string
}

/** 分页查询参数 */
export interface BackgroundTaskQuery {
  agentId?: string
  status?: BackgroundTaskStatus | BackgroundTaskStatus[]
  keyword?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

/** 分页结果 */
export interface BackgroundTaskPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// Drizzle 推导行类型
export type BackgroundTaskRow = typeof backgroundTasks.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class BackgroundTaskRepository {
  constructor(private db: DrizzleDb) {}

  /** 当前本地时间（与 schema 默认一致格式） */
  private now(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19)
  }

  /** 创建任务（初始状态 queued） */
  async create(data: CreateBackgroundTaskInput): Promise<BackgroundTaskRow> {
    const rows = await this.db
      .insert(backgroundTasks)
      .values({
        id: data.id,
        agentId: data.agentId,
        threadId: data.threadId,
        targetThreadId: data.targetThreadId ?? null,
        title: data.title,
        instruction: data.instruction,
        priority: data.priority ?? 5,
        parentTaskId: data.parentTaskId ?? null,
        requestedBy: data.requestedBy ?? 'user',
        completionAction: data.completionAction ?? 'notify',
        category: data.category ?? 'agent_task',
        status: data.status ?? 'queued',
        metadataJson: data.metadataJson ?? '{}',
      })
      .returning()
    return rows[0]!
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<BackgroundTaskRow | null> {
    const rows = await this.db
      .select()
      .from(backgroundTasks)
      .where(eq(backgroundTasks.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  /** 分页查询（默认按创建时间倒序） */
  async query(params: BackgroundTaskQuery): Promise<BackgroundTaskPage<BackgroundTaskRow>> {
    const conditions = []
    if (params.agentId) conditions.push(eq(backgroundTasks.agentId, params.agentId))
    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      conditions.push(
        statuses.length === 1
          ? eq(backgroundTasks.status, statuses[0]!)
          : inArray(backgroundTasks.status, statuses),
      )
    }
    if (params.keyword) {
      // 标题或指令包含关键字
      conditions.push(
        sql`(${backgroundTasks.title} LIKE ${'%' + params.keyword + '%'} OR ${backgroundTasks.instruction} LIKE ${'%' + params.keyword + '%'})`,
      )
    }
    if (params.from) conditions.push(gte(backgroundTasks.createdAt, params.from))
    if (params.to) conditions.push(lte(backgroundTasks.createdAt, params.to))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const page = Math.max(1, params.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(backgroundTasks)
      .where(where)
    const total = totalRows[0]?.count ?? 0

    const items = await this.db
      .select()
      .from(backgroundTasks)
      .where(where)
      .orderBy(desc(backgroundTasks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return { items, total, page, pageSize }
  }

  /**
   * 原子状态迁移（带来源状态守卫）
   *
   * @param id 任务 ID
   * @param from 期望的当前状态（不匹配则不更新，返回 false）
   * @param to 目标状态
   * @param patch 随迁移一并写入的字段（如 startedAt / completedAt / errorMessage）
   */
  async transition(
    id: string,
    from: BackgroundTaskStatus | BackgroundTaskStatus[],
    to: BackgroundTaskStatus,
    patch: Partial<
      Pick<
        BackgroundTaskRow,
        | 'startedAt'
        | 'completedAt'
        | 'errorMessage'
        | 'result'
        | 'progress'
        | 'currentStage'
        | 'checkpointJson'
        | 'updatedAt'
      >
    > = {},
  ): Promise<boolean> {
    const fromStatuses = Array.isArray(from) ? from : [from]
    const rows = await this.db
      .update(backgroundTasks)
      .set({ status: to, updatedAt: this.now(), ...patch })
      .where(
        fromStatuses.length === 1
          ? and(eq(backgroundTasks.id, id), eq(backgroundTasks.status, fromStatuses[0]!))
          : and(eq(backgroundTasks.id, id), inArray(backgroundTasks.status, fromStatuses)),
      )
      .returning({ id: backgroundTasks.id })
    return rows.length > 0
  }

  /** 通用字段更新（进度/阶段/工具计数/检查点/错误信息等，不改状态） */
  async update(
    id: string,
    patch: Partial<
      Pick<
        BackgroundTaskRow,
        | 'title'
        | 'progress'
        | 'currentStage'
        | 'toolCallCount'
        | 'checkpointJson'
        | 'metadataJson'
        | 'inputQuestion'
        | 'inputContextJson'
        | 'errorMessage'
        | 'result'
        | 'updatedAt'
      >
    >,
  ): Promise<void> {
    await this.db
      .update(backgroundTasks)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(backgroundTasks.id, id))
  }

  /** 获取指定 Agent 的执行队列（排队 + 运行中，按优先级 + 创建时间排序） */
  async listQueueByAgent(agentId: string): Promise<BackgroundTaskRow[]> {
    return await this.db
      .select()
      .from(backgroundTasks)
      .where(
        and(
          eq(backgroundTasks.agentId, agentId),
          eq(backgroundTasks.category, 'agent_task'),
          inArray(backgroundTasks.status, ['queued', 'running', 'paused', 'waiting_input']),
        ),
      )
      .orderBy(backgroundTasks.priority, backgroundTasks.createdAt)
  }

  /** 统计各 Agent 活跃任务数（用于任务中心概览/聊天徽章） */
  async countActiveByAgent(): Promise<Array<{ agentId: string; count: number }>> {
    return await this.db
      .select({
        agentId: backgroundTasks.agentId,
        count: sql<number>`count(*)`,
      })
      .from(backgroundTasks)
      .where(inArray(backgroundTasks.status, ['queued', 'running', 'paused', 'waiting_input']))
      .groupBy(backgroundTasks.agentId)
  }

  /** 判断 Thread 或 Agent 是否存在会阻止危险操作的任务。 */
  async hasActiveWork(input: { threadId?: string; agentId?: string }): Promise<boolean> {
    const identity = input.threadId
      ? eq(backgroundTasks.threadId, input.threadId)
      : eq(backgroundTasks.agentId, input.agentId!)
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(backgroundTasks)
      .where(
        and(
          identity,
          eq(backgroundTasks.category, 'agent_task'),
          inArray(backgroundTasks.status, ['queued', 'running', 'waiting_input']),
        ),
      )
    return (rows[0]?.count ?? 0) > 0
  }

  /** 按固定 ID 幂等注册常驻任务。 */
  async ensureResident(data: CreateBackgroundTaskInput): Promise<BackgroundTaskRow> {
    const existing = await this.findById(data.id)
    if (existing) return existing
    return this.create({ ...data, category: 'resident', status: 'running', requestedBy: 'runtime' })
  }

  /** 服务重启后的未完成任务恢复查询
   *
   * 返回所有 running / waiting_input 状态的任务（重启后这些任务的
   * 执行现场已丢失，需要由 Service 决定标记 crashed 还是续跑）。
   */
  async listInterrupted(): Promise<BackgroundTaskRow[]> {
    return await this.db
      .select()
      .from(backgroundTasks)
      .where(inArray(backgroundTasks.status, ['running', 'waiting_input']))
  }

  /** 标记历史记录已读，重复调用保持幂等。 */
  async markRead(id: string): Promise<boolean> {
    const rows = await this.db
      .update(backgroundTasks)
      .set({ readAt: this.now(), updatedAt: this.now() })
      .where(eq(backgroundTasks.id, id))
      .returning({ id: backgroundTasks.id })
    return rows.length > 0
  }

  /** 批量标记历史记录已读。 */
  async markAllRead(): Promise<number> {
    const rows = await this.db
      .update(backgroundTasks)
      .set({ readAt: this.now(), updatedAt: this.now() })
      .where(
        and(
          inArray(backgroundTasks.status, ['completed', 'failed', 'cancelled']),
          sql`${backgroundTasks.readAt} IS NULL`,
        ),
      )
      .returning({ id: backgroundTasks.id })
    return rows.length
  }

  /** 删除一条任务记录。 */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(backgroundTasks)
      .where(eq(backgroundTasks.id, id))
      .returning({ id: backgroundTasks.id })
    return rows.length > 0
  }

  /** LIKE 筛选辅助（保留给未来按 title 精确过滤扩展） */
  protected likeTitle(keyword: string) {
    return like(backgroundTasks.title, `%${keyword}%`)
  }
}
