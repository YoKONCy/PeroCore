/**
 * BackgroundTaskService — 统一任务中心业务逻辑（M05 §4.2）
 *
 * 职责：
 * - 创建任务：显式绑定 agentId + 创建独立 background_task Thread
 * - 按 Agent 管理执行队列（同一 Agent 串行，不同 Agent 并行，M05 §4.4）
 * - 调用 ConversationTurnService 执行任务（显式传 agentId，禁止读全局活跃角色）
 * - 状态机迁移：queued → running ⇄ paused → completed / failed / cancelled
 * - 保存结果/错误，累计工具调用统计
 * - 服务重启后的中断恢复（标记 crashed → failed，A2 决策的续跑在篇3 实装）
 *
 * 不负责：
 * - Gateway 事件广播（由 router/篇2-3 订阅 onEvent 回调注入）
 * - 记忆写入（Scorer/MemoryGate 按 Thread 独立处理）
 *
 * @module packages/backend/src/services/task/backgroundTaskService
 */

import type {
  BackgroundTaskRepository,
  BackgroundTaskRow,
} from '../../repositories/backgroundTask.repo'
import type {
  BackgroundTaskStatus,
  BackgroundTaskQuery,
  CompletionAction,
  BackgroundTaskSource,
} from '../../repositories/backgroundTask.repo'
import type { ThreadService } from '../thread/threadService'
import type { ConversationTurnService } from '../conversation/conversationTurnService'
import type { ChatMessage, ToolCallRecord } from '../pipeline/types'
import type {
  ApprovalService,
  ApprovalRequest,
  ApprovalDecision,
} from '../execution/approvalService'
import { createLogger } from '../../lib/logger'
import { AppError } from '../../lib/appError'
import { disposeTaskExecution } from '../../tools/productivityRuntimeHolder'

const logger = createLogger('BackgroundTaskService')

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 派发任务输入 */
export interface DispatchTaskInput {
  agentId: string
  instruction: string
  title?: string
  targetThreadId?: string
  priority?: number
  requestedBy?: BackgroundTaskSource
  completionAction?: CompletionAction
}

/** 返回给前端的任务信息 */
export interface BackgroundTaskInfo {
  id: string
  agentId: string
  threadId: string
  targetThreadId: string | null
  title: string
  instruction: string
  status: BackgroundTaskStatus
  progress: number | null
  currentStage: string | null
  result: string | null
  errorMessage: string | null
  toolCallCount: number
  priority: number
  requestedBy: string
  completionAction: string
  category: 'agent_task' | 'resident'
  inputQuestion: string | null
  inputContext: Record<string, unknown> | null
  checkpoint: { messages: ChatMessage[]; toolCalls: ToolCallRecord[]; turn: number } | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  /** 任务记录已读状态 */
  readAt: string | null
  updatedAt: string
}

/** 任务事件（篇2-3 由 router 订阅后广播 Gateway） */
export interface BackgroundTaskEvent {
  type:
    | 'background_task_created'
    | 'background_task_started'
    | 'background_task_progress'
    | 'background_task_waiting_input'
    | 'background_task_paused'
    | 'background_task_completed'
    | 'background_task_failed'
    | 'background_task_cancelled'
  task: BackgroundTaskInfo
}

/** 事件监听器 */
export type BackgroundTaskListener = (event: BackgroundTaskEvent) => void

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class BackgroundTaskService {
  /** 事件订阅者（篇2-3 router 注册，用于 Gateway 广播） */
  private listeners: BackgroundTaskListener[] = []

  /**
   * 每个 Agent 的串行执行链（M05 §4.4：同 Agent 串行、跨 Agent 并行）
   * key = agentId，value = 当前执行 Promise（无任务时为 null）
   */
  private agentChains = new Map<string, Promise<void>>()

  /** 运行中任务的 AbortController（取消/安全暂停用） */
  private runningAborts = new Map<string, AbortController>()
  private pauseRequests = new Set<string>()

  constructor(
    private readonly repo: BackgroundTaskRepository,
    private readonly threadService: ThreadService,
    private readonly conversationTurnService: ConversationTurnService,
    private readonly approvalService?: ApprovalService,
  ) {
    this.approvalService?.onRequested((request) => void this.handleApprovalRequested(request))
    this.approvalService?.onResolved((request) => void this.handleApprovalResolved(request))
  }

  /** 订阅任务事件 */
  onEvent(listener: BackgroundTaskListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  /** 广播事件给所有订阅者 */
  private emit(type: BackgroundTaskEvent['type'], task: BackgroundTaskRow): void {
    const info = this.toInfo(task)
    for (const listener of this.listeners) {
      try {
        listener({ type, task: info })
      } catch (err) {
        // 单个订阅者失败不影响其他订阅者与主流程
        logger.warn(`任务事件订阅者异常 (${type}): ${err}`)
      }
    }
  }

  // ── 创建与查询 ──

  /**
   * 派发后台任务
   *
   * 流程：创建 background_task Thread → 入库 queued → 触发该 Agent 的执行链
   */
  async dispatch(input: DispatchTaskInput): Promise<BackgroundTaskInfo> {
    const title = input.title?.trim() || input.instruction.slice(0, 24)
    const completionAction = input.completionAction ?? 'notify'
    let targetThreadId: string | null = null
    if (completionAction === 'send_to_chat') {
      if (!input.targetThreadId) {
        throw new AppError('INVALID_PARAMETER', { message: '发送到对话时必须提供目标 Thread' })
      }
      const targetThread = await this.threadService.getThread(input.targetThreadId)
      if (!targetThread || targetThread.purpose !== 'conversation') {
        throw new AppError('INVALID_PARAMETER', { message: '目标 Thread 不存在或不是普通对话' })
      }
      targetThreadId = targetThread.id
    }

    // 1. 创建任务专属 Thread（purpose=background_task，与普通聊天历史隔离，M05 §3.2）
    //    channel 用 desktop：复用主 Agent 的桌面通道能力矩阵与上下文策略
    const thread = await this.threadService.createThread({
      agentId: input.agentId,
      channel: 'desktop',
      title: `[任务] ${title}`,
      purpose: 'background_task',
    })

    // 2. 入库（queued）
    const taskId = `bgtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const task = await this.repo.create({
      id: taskId,
      agentId: input.agentId,
      threadId: thread.id,
      targetThreadId,
      title,
      instruction: input.instruction,
      priority: input.priority,
      requestedBy: input.requestedBy ?? 'user',
      completionAction,
    })

    logger.info(`后台任务已派发: id=${taskId}, agent=${input.agentId}, title="${title}"`)
    this.emit('background_task_created', task)

    // 3. 触发执行链（不阻塞调用方，queued 任务排队执行）
    void this.pumpAgent(input.agentId)

    return this.toInfo(task)
  }

  /** 已读状态：历史记录进入详情前调用。 */
  async markRead(id: string): Promise<void> {
    const ok = await this.repo.markRead(id)
    if (!ok) throw new AppError('NOT_FOUND', { message: '任务不存在' })
  }

  /** 批量标记历史记录已读。 */
  async markAllRead(): Promise<number> {
    return this.repo.markAllRead()
  }

  /** 任务详情 */
  async getTask(id: string): Promise<BackgroundTaskInfo | null> {
    const task = await this.repo.findById(id)
    return task ? this.toInfo(task) : null
  }

  /** 分页查询 */
  async query(params: BackgroundTaskQuery) {
    const page = await this.repo.query(params)
    return {
      ...page,
      items: page.items.map((t) => this.toInfo(t)),
    }
  }

  /** 各 Agent 活跃任务数（聊天徽章/任务中心概览） */
  async countActiveByAgent(): Promise<Array<{ agentId: string; count: number }>> {
    return await this.repo.countActiveByAgent()
  }

  // ── 执行队列 ──

  /**
   * 驱动某 Agent 的执行链：取下一个 queued 任务执行，直到队列耗尽。
   * 并发保护：同一 Agent 同时只有一条链在跑。
   */
  private async pumpAgent(agentId: string): Promise<void> {
    const existing = this.agentChains.get(agentId)
    if (existing) return // 已有执行链在跑，新任务会在链尾被自然捡起

    const chain = (async () => {
      try {
        for (;;) {
          const queue = await this.repo.listQueueByAgent(agentId)
          const next = queue.find((t) => t.status === 'queued')
          if (!next) break
          await this.runTask(next.id)
        }
      } finally {
        this.agentChains.delete(agentId)
      }
    })()

    this.agentChains.set(agentId, chain)
    // 链的异常在 runTask 内部已兜底，这里仅防止未处理拒绝
    chain.catch((err) => logger.error(`Agent ${agentId} 任务执行链异常: ${err}`))
  }

  /**
   * 执行单个任务：queued → running → completed/failed
   *
   * 通过 ConversationTurnService 执行，显式传 agentId（M05 §4.3）；
   * TODO(M05-篇3): 接入 ReAct 级 checkpoint，支持中断半程续跑与运行中暂停
   */
  private async runTask(taskId: string): Promise<void> {
    const task = await this.repo.findById(taskId)
    if (!task || task.status !== 'queued') return

    const now = this.localNow()
    // 1. 原子迁移 queued → running（允许从 paused/failed 中断图中恢复）
    const started = await this.repo.transition(taskId, ['queued', 'paused'], 'running', {
      startedAt: now,
    })
    if (!started) return
    task.status = 'running'
    task.startedAt = now
    this.emit('background_task_started', task)

    // 2. 准备取消控制器
    const abort = new AbortController()
    this.runningAborts.set(taskId, abort)

    try {
      // 3. 执行任务：优先 checkpoint 恢复续跑，无则从头开始
      const checkpointRaw = task.checkpointJson
      let initialMessages: ChatMessage[] = []
      let resumedToolCount = 0
      if (checkpointRaw) {
        try {
          const checkpoint = JSON.parse(checkpointRaw) as {
            messages?: ChatMessage[]
            toolCalls?: ToolCallRecord[]
            toolCallCount?: number
            turn?: number
          }
          initialMessages = checkpoint.messages ?? []
          resumedToolCount = checkpoint.toolCalls?.length ?? checkpoint.toolCallCount ?? 0
          logger.info(
            `后台任务 ${taskId} 从 checkpoint 恢复：${initialMessages.length} 条消息，${resumedToolCount} 次工具调用`,
          )
        } catch (parseErr) {
          logger.warn(`后台任务 checkpoint 解析失败，从头开始: ${parseErr}`)
          initialMessages = []
        }
      }

      // KPI：追加上轮已执行的工具调用入全局统计
      if (resumedToolCount > 0) {
        await this.repo.update(taskId, { toolCallCount: resumedToolCount })
      }

      // 执行任务：使用 ConversationTurn（内部持有完整消息链，含 checkpoint 恢复后的 messages）
      const turn = await this.conversationTurnService.executeTurn({
        threadId: task.threadId,
        agentId: task.agentId,
        content: task.instruction,
        signal: abort.signal,
        taskId,
        resumeMessages: initialMessages,
        onCheckpoint: async (checkpoint) => {
          await this.saveCheckpoint(taskId, checkpoint)
        },
      })

      // 执行完成后清理 checkpoint（成功或已尝试恢复后仅保留本论新状态）
      await this.repo.update(taskId, { checkpointJson: null })

      // 4. 成功：写结果 + 工具统计
      const finishedAt = this.localNow()
      await this.repo.transition(taskId, 'running', 'completed', {
        completedAt: finishedAt,
        result: (turn.reply ?? '').slice(0, 2000), // 摘要截断，完整结果留在 Thread 消息里
        progress: 100,
      })
      // 工具统计：若使用了恢复，使用 checkpoint 中更多值
      const finalToolCount = Math.max(
        resumedToolCount + (turn.toolCalls?.length ?? 0),
        turn.toolCalls?.length ?? 0,
      )
      await this.repo.update(taskId, { toolCallCount: finalToolCount })
      logger.info(
        `后台任务完成: id=${taskId}, 工具调用 ${finalToolCount} 次 (含恢复 ${resumedToolCount})`,
      )

      const done = await this.repo.findById(taskId)
      if (done?.completionAction === 'send_to_chat' && done.targetThreadId) {
        try {
          const result = done.result ?? ''
          await this.threadService.appendSystemMessage({
            threadId: done.targetThreadId,
            content: `后台任务「${done.title}」已由 ${done.agentId} 完成。\n\n结果：\n${result}`,
            metadataJson: JSON.stringify({
              kind: 'background_task_result',
              taskId: done.id,
              taskThreadId: done.threadId,
              agentId: done.agentId,
              title: done.title,
            }),
          })
        } catch (deliveryError) {
          logger.warn(`后台任务结果投递失败: id=${taskId}, 原因: ${deliveryError}`)
        }
      }
      if (done) this.emit('background_task_completed', done)
    } catch (err) {
      const finishedAt = this.localNow()
      const isCancelled = err instanceof Error && err.name === 'AbortError'
      const message = err instanceof Error ? err.message : String(err)

      // 失败时保留现状态 checkpoint（供下次重启恢复）
      const runningTask = await this.repo.findById(taskId)
      if (runningTask && !runningTask.checkpointJson) {
        logger.warn(`后台任务 ${taskId} 在首个工具检查点前中断，将无法半程续跑`)
      }

      if (isCancelled && this.pauseRequests.delete(taskId)) {
        await this.repo.transition(taskId, 'running', 'paused', {
          currentStage: '已安全暂停，可从检查点恢复',
        })
        logger.info(`后台任务已安全暂停: id=${taskId}`)
        const paused = await this.repo.findById(taskId)
        if (paused) this.emit('background_task_paused', paused)
      } else if (isCancelled) {
        await this.repo.transition(taskId, 'running', 'cancelled', { completedAt: finishedAt })
        logger.info(`后台任务已取消: id=${taskId}`)
        const cancelled = await this.repo.findById(taskId)
        if (cancelled) this.emit('background_task_cancelled', cancelled)
      } else {
        await this.repo.transition(taskId, 'running', 'failed', {
          completedAt: finishedAt,
          errorMessage: message.slice(0, 1000),
        })
        logger.error(`后台任务失败: id=${taskId}, 原因: ${message}`)
        const failed = await this.repo.findById(taskId)
        if (failed) this.emit('background_task_failed', failed)
      }
    } finally {
      this.runningAborts.delete(taskId)
      // Task 生命周期结束时终止并回收其全部受管终端，避免后台幽灵进程。
      await disposeTaskExecution(taskId).catch((error) => {
        logger.warn(`后台任务执行会话清理失败: id=${taskId}, 原因=${error}`)
      })
    }
  }

  /** 运行中的任务因服务重启而中断 → 重新排队并保留 checkpoint 继续执行 */
  async resumeInterrupted(taskId: string): Promise<BackgroundTaskInfo> {
    const task = await this.mustGet(taskId)
    const ok = await this.repo.transition(taskId, 'failed', 'queued', {
      completedAt: null,
      errorMessage: null,
    })
    if (!ok) throw new AppError('INVALID_PARAMETER', { message: '只有中断失败的任务可以续跑' })
    logger.info(`中断任务 ${taskId} 已重新入队恢复`)
    void this.pumpAgent(task.agentId)
    return this.mustGet(taskId)
  }

  /** 提交 waiting_input 的审批决定与附言，原工具调用将在原地续行。 */
  async submitInput(
    id: string,
    input: { decision: ApprovalDecision; message?: string },
  ): Promise<BackgroundTaskInfo> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    if (task.status !== 'waiting_input') {
      throw new AppError('CONFLICT', { message: '任务当前不在等待输入状态' })
    }
    const context = this.parseJson<Record<string, unknown>>(task.inputContextJson)
    const approvalId = typeof context?.approvalId === 'string' ? context.approvalId : ''
    if (!approvalId || !this.approvalService) {
      throw new AppError('CONFLICT', { message: '任务缺少可恢复的审批上下文' })
    }
    this.approvalService.resolve(approvalId, input.decision, input.message)
    return this.mustGet(id)
  }

  /** 基于历史任务重新派发，保留执行者与完成行为。 */
  async retry(id: string): Promise<BackgroundTaskInfo> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new AppError('CONFLICT', { message: '只有历史任务可以重新派发' })
    }
    return this.dispatch({
      agentId: task.agentId,
      instruction: task.instruction,
      title: task.title,
      targetThreadId: task.targetThreadId ?? undefined,
      priority: task.priority,
      requestedBy: 'user',
      completionAction: task.completionAction as CompletionAction,
    })
  }

  /** 对危险 Thread 操作提供权威占用判断。 */
  async hasActiveWork(input: { threadId?: string; agentId?: string }): Promise<boolean> {
    return this.repo.hasActiveWork(input)
  }

  private async saveCheckpoint(
    taskId: string,
    checkpoint: { messages: ChatMessage[]; toolCalls: ToolCallRecord[]; turn: number },
  ): Promise<void> {
    await this.repo.update(taskId, {
      checkpointJson: JSON.stringify({
        ...checkpoint,
        toolCallCount: checkpoint.toolCalls.length,
        savedAt: this.localNow(),
      }),
      toolCallCount: checkpoint.toolCalls.length,
      progress: Math.min(95, Math.max(1, checkpoint.turn * 5)),
      currentStage: `ReAct 第 ${checkpoint.turn} 轮 · 已完成 ${checkpoint.toolCalls.length} 次工具调用`,
    })
    const task = await this.repo.findById(taskId)
    if (task) this.emit('background_task_progress', task)
  }

  private async handleApprovalRequested(request: ApprovalRequest): Promise<void> {
    if (!request.taskId) return
    const context = {
      approvalId: request.id,
      toolName: request.toolName,
      argsSummary: request.argsSummary,
      channel: request.channel,
      origin: 'tool_approval',
    }
    const ok = await this.repo.transition(request.taskId, 'running', 'waiting_input', {
      currentStage: `等待确认工具：${request.toolName}`,
    })
    if (!ok) return
    await this.repo.update(request.taskId, {
      inputQuestion: request.reason || `是否允许执行工具 ${request.toolName}？`,
      inputContextJson: JSON.stringify(context),
    })
    const task = await this.repo.findById(request.taskId)
    if (task) this.emit('background_task_waiting_input', task)
  }

  private async handleApprovalResolved(request: ApprovalRequest): Promise<void> {
    if (!request.taskId) return
    const ok = await this.repo.transition(request.taskId, 'waiting_input', 'running', {
      currentStage: request.status === 'approved' ? '已批准，继续执行' : '已拒绝，调整方案',
    })
    await this.repo.update(request.taskId, { inputQuestion: null, inputContextJson: null })
    if (!ok) return
    const task = await this.repo.findById(request.taskId)
    if (task) this.emit('background_task_progress', task)
  }

  // ── 控制操作 ──

  /** 暂停：排队任务直接暂停，运行中任务 Abort 后保留最近工具检查点。 */
  async pause(id: string): Promise<BackgroundTaskInfo> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    if (task.status === 'running') {
      this.pauseRequests.add(id)
      this.runningAborts.get(id)?.abort()
      return this.mustGet(id)
    }
    const ok = await this.repo.transition(id, 'queued', 'paused')
    if (!ok) {
      throw new AppError('INVALID_PARAMETER', { message: '只有排队中或运行中的任务可以暂停' })
    }
    const paused = await this.repo.findById(id)
    if (paused) this.emit('background_task_paused', paused)
    logger.info(`后台任务已暂停: id=${id}`)
    return this.mustGet(id)
  }

  /** 恢复：paused → queued，重新进入执行链 */
  async resume(id: string): Promise<BackgroundTaskInfo> {
    const ok = await this.repo.transition(id, 'paused', 'queued')
    if (!ok) {
      throw new AppError('INVALID_PARAMETER', { message: '只有已暂停的任务可以恢复' })
    }
    const task = await this.mustGet(id)
    void this.pumpAgent(task.agentId)
    logger.info(`后台任务已恢复: id=${id}`)
    return task
  }

  /** 取消：queued/paused 直接迁移；running 通过 AbortController 中断 */
  async cancel(id: string): Promise<BackgroundTaskInfo> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })

    if (task.status === 'running') {
      // 运行中：发中断信号，状态迁移由 runTask 的异常分支完成
      this.runningAborts.get(id)?.abort()
    } else {
      const ok = await this.repo.transition(id, ['queued', 'paused'], 'cancelled', {
        completedAt: this.localNow(),
      })
      if (!ok) {
        throw new AppError('INVALID_PARAMETER', { message: '该状态的任务不可取消' })
      }
      const cancelled = await this.repo.findById(id)
      if (cancelled) this.emit('background_task_cancelled', cancelled)
    }
    logger.info(`后台任务取消请求: id=${id}`)
    return this.mustGet(id)
  }

  /** 删除任务记录（运行中任务拒绝） */
  async deleteTask(id: string): Promise<void> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    if (task.status === 'running') {
      throw new AppError('INVALID_PARAMETER', { message: '运行中的任务不可删除，请先取消' })
    }
    await this.repo.delete(id)
    logger.info(`后台任务已删除: id=${id}`)
  }

  /**
   * 服务重启后的中断恢复
   *
   * 运行中/waiting_input 的任务现场已丢失：保留 checkpoint 供手动 resumeInterrupted 恢复，
   * 状态标记为 failed（合并 crashed 语义），不自动重启避免重启闭环。
   * 若用户需要续跑，调用 resumeInterrupted(id) 重新入队。
   */
  async recoverInterruptedTasks(): Promise<number> {
    const interrupted = await this.repo.listInterrupted()
    for (const task of interrupted) {
      if (task.status === 'waiting_input') continue
      // 已有工具级 checkpoint 直接保留，绝不覆盖成空消息。
      await this.repo.transition(task.id, ['running', 'waiting_input'], 'failed', {
        completedAt: this.localNow(),
        errorMessage: '服务重启导致任务中断，可调用 resume-interrupted 续跑',
      })
    }
    return interrupted.length
  }

  // ── 内部工具 ──

  /** 必须取到任务信息 */
  private async mustGet(id: string): Promise<BackgroundTaskInfo> {
    const task = await this.repo.findById(id)
    if (!task) throw new AppError('NOT_FOUND', { message: '任务不存在' })
    return this.toInfo(task)
  }

  private parseJson<T>(value: string | null): T | null {
    if (!value) return null
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  /** 本地时间（与 schema 默认格式一致） */
  private localNow(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19)
  }

  /** Row → Info 映射 */
  private toInfo(row: BackgroundTaskRow): BackgroundTaskInfo {
    return {
      id: row.id,
      agentId: row.agentId,
      threadId: row.threadId,
      targetThreadId: row.targetThreadId,
      title: row.title,
      instruction: row.instruction,
      status: row.status as BackgroundTaskStatus,
      progress: row.progress,
      currentStage: row.currentStage,
      result: row.result,
      errorMessage: row.errorMessage,
      toolCallCount: row.toolCallCount ?? 0,
      priority: row.priority ?? 5,
      requestedBy: row.requestedBy ?? 'user',
      completionAction: row.completionAction ?? 'notify',
      category: (row.category ?? 'agent_task') as 'agent_task' | 'resident',
      inputQuestion: row.inputQuestion,
      inputContext: this.parseJson<Record<string, unknown>>(row.inputContextJson),
      checkpoint: this.parseJson<{
        messages: ChatMessage[]
        toolCalls: ToolCallRecord[]
        turn: number
      }>(row.checkpointJson),
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      readAt: row.readAt,
      updatedAt: row.updatedAt,
    }
  }
}
