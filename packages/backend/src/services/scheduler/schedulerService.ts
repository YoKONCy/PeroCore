import { randomUUID } from 'node:crypto'
import type { DrizzleDb } from '../../database'
import type { GatewayHub } from '../gateway/gatewayHub'
import { createEnvelope } from '../gateway/types'
import {
  ProactiveWorkRepository,
  type ScheduledWorkRow,
} from '../../repositories/proactiveWork.repo'
import type { BackgroundTaskInfo, DispatchTaskInput } from '../task/backgroundTaskService'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'
import type { TaskPlanService } from '../task/taskPlanService'

const logger = createLogger('SchedulerService')
export type ScheduledTaskType = 'reminder' | 'topic' | 'reaction' | 'agent_task' | 'follow_up'
export interface CreateReminderParams {
  time: string
  content: string
  type?: ScheduledTaskType
  agentId?: string
  threadId?: string
  reason?: string
  sourceExecutionId?: string
  planId?: string
  planStepId?: string
}
export type ReminderDto = ScheduledWorkRow & { type: ScheduledTaskType }

/** 计划和建议的业务编排；实际工作仍由统一后台任务与 KernelScheduler 执行。 */
export class SchedulerService {
  private repo: ProactiveWorkRepository
  private dispatchTask?: (input: DispatchTaskInput) => Promise<BackgroundTaskInfo>

  constructor(
    db: DrizzleDb,
    private gatewayHub: GatewayHub,
    private agentManager?: { getOwnerAppellation(agentId: string): string },
    private validateThread?: (agentId: string, threadId: string) => Promise<void>,
    private plans?: TaskPlanService,
  ) {
    this.repo = new ProactiveWorkRepository(db)
  }

  setTaskDispatcher(dispatch: (input: DispatchTaskInput) => Promise<BackgroundTaskInfo>): void {
    this.dispatchTask = dispatch
  }

  private async changed(agentId: string): Promise<void> {
    // 推送仅使投影失效；连接异常不能回滚已经提交的业务记录。
    try {
      await this.gatewayHub.broadcast(
        createEnvelope('push', { action: 'proactive_work_changed', agentId }),
      )
    } catch (error) {
      logger.warn(`工作状态刷新通知失败: ${error}`)
    }
  }

  async create(params: CreateReminderParams): Promise<ReminderDto> {
    if (
      (params.planId || params.planStepId) &&
      !['follow_up', 'agent_task'].includes(params.type ?? 'reminder')
    )
      throw new AppError('INVALID_PARAMETER', { message: '只有跟进与定时任务可以关联行动步骤' })
    const create = () => this.createReminder(params)
    return this.plans
      ? this.plans.withLink(
          params.agentId ?? 'pero',
          params.planId,
          params.planStepId,
          params.threadId,
          create,
        )
      : create()
  }

  private async createReminder(params: CreateReminderParams): Promise<ReminderDto> {
    const type = params.type ?? 'reminder'
    const agentId = params.agentId ?? 'pero'
    const time = Date.parse(params.time)
    const content = params.content?.trim()
    if (
      !['reminder', 'topic', 'reaction', 'agent_task', 'follow_up'].includes(type) ||
      !Number.isFinite(time) ||
      time <= Date.now() ||
      !content ||
      content.length > 4000
    ) {
      throw new AppError('INVALID_PARAMETER', {
        message: '请提供有效的未来时间、类型和内容（最多 4000 字）',
      })
    }
    if (
      type === 'follow_up' &&
      (time < Date.now() + 60_000 ||
        time > Date.now() + 7 * 86_400_000 ||
        !params.threadId ||
        !params.reason?.trim() ||
        params.reason.length > 500)
    ) {
      throw new AppError('INVALID_PARAMETER', {
        message: '跟进需要来源对话和原因，时间须在一分钟至七天内',
      })
    }
    if (params.threadId) await this.validateThread?.(agentId, params.threadId)
    let row: ScheduledWorkRow
    try {
      row = this.repo.createSchedule(
        {
          type,
          agentId,
          time: new Date(time).toISOString(),
          content,
          threadId: params.threadId,
          reason: params.reason?.trim(),
          sourceExecutionId: params.sourceExecutionId,
          planId: params.planId,
          planStepId: params.planStepId,
          createdAt: new Date().toISOString(),
        },
        type === 'follow_up',
      )
    } catch (error) {
      throw new AppError('INVALID_PARAMETER', {
        message: error instanceof Error ? error.message : '创建计划失败',
      })
    }
    await this.changed(agentId)
    return this.toDto(row)
  }

  async listPending(agentId?: string): Promise<ReminderDto[]> {
    return this.repo.schedules(agentId).map((row) => this.toDto(row))
  }

  async cancel(id: number, agentId: string): Promise<boolean> {
    const result = this.repo.cancel(id, agentId)
    if (result) await this.changed(agentId)
    return result
  }

  async retry(id: number, agentId: string): Promise<boolean> {
    const result = this.repo.retry(id, agentId)
    if (result) await this.changed(agentId)
    return result
  }

  /** 领取不是完成；派发成功后结算，失败退避重试，崩溃后租约到期重新领取。 */
  async dispatchDueTasks(): Promise<void> {
    if (!this.dispatchTask) return
    for (const row of this.repo.claimDue(new Date().toISOString())) {
      try {
        if (row.threadId) await this.validateThread?.(row.agentId, row.threadId)
        let taskId: string | undefined
        if (row.type === 'agent_task' || row.type === 'follow_up') {
          const task = await this.dispatchTask({
            agentId: row.agentId,
            instruction:
              row.type === 'follow_up'
                ? `【到期跟进】\n原因：${row.reason}\n来源对话：${row.threadId}\n需要检查：${row.content}\n请重新读取现状；如需修改、发送或执行命令，请提出行动建议等待用户采纳。`
                : row.content,
            title:
              `${row.type === 'follow_up' ? '跟进' : '定时任务'}：${row.reason || row.content}`.slice(
                0,
                100,
              ),
            requestedBy: 'scheduler',
            idempotencyKey: `schedule:${row.id}`,
            metadata: {
              trigger: row.type,
              scheduleId: row.id,
              ...(row.planId ? { planId: row.planId, planStepId: row.planStepId } : {}),
              originThreadId: row.threadId,
              sourceExecutionId: row.sourceExecutionId,
              reason: row.reason,
              ...(row.type === 'follow_up' ? { capabilityScope: 'follow_up' } : {}),
            },
          })
          taskId = task.id
        } else {
          const owner = this.agentManager?.getOwnerAppellation(row.agentId) ?? '主人'
          await this.gatewayHub.pushNotification({
            title: `${owner}，${row.type === 'reminder' ? '提醒' : row.type === 'topic' ? '话题' : '约定'}到时间啦`,
            body: row.content,
            principalId: row.agentId,
            important: true,
            notificationId: `schedule:${row.id}`,
          })
        }
        this.repo.settle(row, taskId)
      } catch (error) {
        this.repo.settle(row, undefined, error instanceof Error ? error.message : String(error))
        logger.warn(`计划派发失败，已保存重试状态: #${row.id}, ${error}`)
      }
      await this.changed(row.agentId)
    }
    // 采纳已持久化后即使进程中断，下次扫描仍会完成唯一任务的派发。
    for (const suggestion of this.repo.suggestions(undefined, 'accepting')) {
      try {
        await this.acceptSuggestion(suggestion.id, suggestion.agentId)
      } catch (error) {
        logger.warn(`采纳建议派发失败，稍后重试: ${suggestion.id}, ${error}`)
      }
    }
  }

  async suggest(input: {
    agentId: string
    threadId: string
    title: string
    instruction: string
    reason: string
    sourceExecutionId?: string
  }) {
    if (
      !input.title?.trim() ||
      input.title.length > 160 ||
      !input.instruction?.trim() ||
      input.instruction.length > 4000 ||
      !input.reason?.trim() ||
      input.reason.length > 1000
    ) {
      throw new AppError('INVALID_PARAMETER', {
        message: '建议需要标题、行动内容和依据，并符合长度限制',
      })
    }
    await this.validateThread?.(input.agentId, input.threadId)
    let row
    try {
      row = this.repo.createSuggestion({
        ...input,
        title: input.title.trim(),
        instruction: input.instruction.trim(),
        reason: input.reason.trim(),
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      throw new AppError('INVALID_PARAMETER', {
        message: error instanceof Error ? error.message : '保存建议失败',
      })
    }
    await this.changed(input.agentId)
    return row
  }

  async listSuggestions(agentId: string) {
    return this.repo.suggestions(agentId)
  }

  async dismissSuggestion(id: string, agentId: string) {
    const row = this.repo.transitionSuggestion(id, agentId, ['open'], 'dismissed')
    if (!row) throw new AppError('INVALID_PARAMETER', { message: '建议不存在或已经处理' })
    await this.changed(agentId)
    return row
  }

  async acceptSuggestion(id: string, agentId: string) {
    let row = this.repo.suggestion(id, agentId)
    if (!row || row.status === 'dismissed')
      throw new AppError('NOT_FOUND', { message: '建议不存在或已忽略' })
    if (row.status === 'accepted') return row
    if (!this.dispatchTask)
      throw new AppError('SERVICE_UNAVAILABLE', { message: '任务服务尚未准备好' })
    try {
      await this.validateThread?.(agentId, row.threadId)
    } catch (error) {
      this.repo.transitionSuggestion(id, agentId, ['accepting'], 'open')
      await this.changed(agentId)
      throw error
    }
    row = this.repo.transitionSuggestion(id, agentId, ['open', 'accepting'], 'accepting')
    if (!row) throw new AppError('INVALID_PARAMETER', { message: '建议状态已变化，请刷新' })
    let task: BackgroundTaskInfo
    try {
      task = await this.dispatchTask({
        agentId,
        instruction: row.instruction,
        title: row.title,
        requestedBy: 'user',
        idempotencyKey: `suggestion:${id}`,
        metadata: {
          trigger: 'accepted_suggestion',
          suggestionId: id,
          originThreadId: row.threadId,
          sourceExecutionId: row.sourceExecutionId,
          reason: row.reason,
        },
      })
    } catch (error) {
      this.repo.transitionSuggestion(id, agentId, ['accepting'], 'open')
      await this.changed(agentId)
      if (error instanceof AppError) throw error
      throw new AppError('SERVICE_UNAVAILABLE', { message: '任务暂时无法派发，请稍后重试' })
    }
    const accepted =
      this.repo.transitionSuggestion(id, agentId, ['accepting'], 'accepted', task.id) ??
      this.repo.suggestion(id, agentId)!
    await this.changed(agentId)
    return accepted
  }

  private toDto(row: ScheduledWorkRow): ReminderDto {
    return { ...row, type: row.type as ScheduledTaskType }
  }
}
