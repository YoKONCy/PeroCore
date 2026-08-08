/**
 * Runtime State Service — 运行时状态管理
 *
 * 后端持久资源权威服务（不含全局活跃 Agent）。
 *
 * 三大职责：
 * 1. LLM 调用状态管理（整合旧 TaskManager）
 *    - 按 threadId 索引正在进行的 LLM 调用
 *    - 支持暂停/恢复/取消/指令注入/超时保护
 *    - 进度广播（Gateway 集成）
 *
 * 2. 窗口级活跃 Agent（替代旧 AgentManager.activeAgentId）
 *    - 前端窗口 → AgentId 映射
 *    - 不维护全局单一活跃 Agent（前端窗口级状态）
 *
 * 3. Thread 运行时状态
 *    - 正在打字的 Thread 标记
 *    - 最后活跃时间
 *
 * 设计原则：
 * - 不维护全局活跃 Agent（那是前端窗口级状态）
 * - 不持久化 Thread 状态（那是 ThreadService 的事）
 * - 不管理 Agent 定义（那是 AgentManager 的事）
 *
 * @module packages/backend/src/services/runtime/runtimeStateService
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('RuntimeStateService')

/** 默认任务超时（ms）— 5 分钟 */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** LLM 调用任务状态 */
interface TaskState {
  /** 是否暂停 */
  paused: boolean
  /** 待注入的即时指令 */
  pendingInstruction: string | null
  /** 是否已请求取消 */
  cancelled: boolean
  /** 任务开始时间 */
  startedAt: number
  /** 当前轮次 */
  currentTurn: number
  /** Agent ID */
  agentId?: string
  /** 超时定时器 */
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

/** 任务信息（给 API 返回） */
export interface TaskInfo {
  threadId: string
  state: 'running' | 'paused' | 'cancelled'
  startedAt: number
  currentTurn: number
  elapsedMs: number
  agentId?: string
}

/** 进度广播回调 */
export type ProgressBroadcaster = (params: {
  threadId: string
  turn: number
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  message?: string
}) => Promise<void>

/** Thread 运行时状态 */
interface ThreadRuntimeState {
  /** 是否正在生成回复（打字中） */
  isTyping: boolean
  /** 最后活跃时间戳 */
  lastActiveAt: number
}

// ─────────────────────────────────────────────
// RuntimeStateService
// ─────────────────────────────────────────────

export class RuntimeStateService {
  // ── LLM 调用状态（按 threadId 索引） ──
  private tasks = new Map<string, TaskState>()

  // ── 窗口级活跃 Agent（前端窗口 → AgentId） ──
  private windowAgents = new Map<string, string>()

  // ── Thread 运行时状态（按 threadId 索引） ──
  private threadStates = new Map<string, ThreadRuntimeState>()

  /** 进度广播回调（Gateway 注入） */
  private broadcaster: ProgressBroadcaster | null = null

  /** 任务超时时间（ms） */
  private timeoutMs: number

  constructor(timeoutMs: number = DEFAULT_TASK_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  // ─────────────────────────────────────────
  // 1. LLM 调用状态管理（整合旧 TaskManager）
  // ─────────────────────────────────────────

  /** 注入进度广播回调 */
  setBroadcaster(broadcaster: ProgressBroadcaster): void {
    this.broadcaster = broadcaster
  }

  /**
   * 注册任务（LLM 调用开始时调用）
   * @param threadId  Thread ID
   * @param agentId   执行任务的 Agent ID
   */
  registerTask(threadId: string, agentId?: string): void {
    // 清理可能的旧任务
    this.cleanupTask(threadId)

    const state: TaskState = {
      paused: false,
      pendingInstruction: null,
      cancelled: false,
      startedAt: Date.now(),
      currentTurn: 0,
      agentId,
      timeoutTimer: null,
    }

    // 设置超时定时器
    state.timeoutTimer = setTimeout(() => {
      this.handleTimeout(threadId)
    }, this.timeoutMs)

    this.tasks.set(threadId, state)
    logger.debug(`任务注册: thread=${threadId}, agent=${agentId ?? 'default'}`)

    // 标记 Thread 为打字中
    this.setThreadTyping(threadId, true)

    // 广播进度
    this.broadcastProgress(threadId, 'running', '任务已开始')
  }

  /**
   * 注销任务（LLM 调用时调用）
   * @param threadId  Thread ID
   */
  unregisterTask(threadId: string): void {
    const state = this.tasks.get(threadId)
    if (state) {
      // 清理超时定时器
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer)
      }
      // 广播完成
      this.broadcastProgress(threadId, 'completed', '任务完成')
    }
    this.tasks.delete(threadId)
    logger.debug(`任务注销: thread=${threadId}`)

    // 取消 Thread 打字状态
    this.setThreadTyping(threadId, false)
  }

  /** 更新当前轮次 */
  updateTurn(threadId: string, turn: number): void {
    const state = this.tasks.get(threadId)
    if (!state) return
    state.currentTurn = turn
  }

  /** 检查暂停（ReAct 每轮开始时调用） */
  async checkPause(threadId: string): Promise<void> {
    const state = this.tasks.get(threadId)
    if (!state?.paused) return

    logger.info(`任务暂停中: thread=${threadId}`)
    this.broadcastProgress(threadId, 'paused', '任务已暂停')

    // 等待恢复（轮询，每 500ms 检查一次）
    while (state.paused && !state.cancelled) {
      await new Promise((r) => setTimeout(r, 500))
    }
    logger.info(`任务已恢复: thread=${threadId}`)
    this.broadcastProgress(threadId, 'running', '任务已恢复')
  }

  /** 获取并清空待注入的即时指令 */
  getInjectedInstruction(threadId: string): string | null {
    const state = this.tasks.get(threadId)
    if (!state?.pendingInstruction) return null
    const instruction = state.pendingInstruction
    state.pendingInstruction = null
    return instruction
  }

  /** 暂停任务 */
  pauseTask(threadId: string): boolean {
    const state = this.tasks.get(threadId)
    if (!state) return false
    state.paused = true
    logger.info(`暂停: thread=${threadId}`)
    return true
  }

  /** 恢复任务 */
  resumeTask(threadId: string): boolean {
    const state = this.tasks.get(threadId)
    if (!state) return false
    state.paused = false
    logger.info(`恢复: thread=${threadId}`)
    return true
  }

  /** 注入即时指令（下一轮 ReAct 开始时注入到消息中） */
  injectInstruction(threadId: string, instruction: string): boolean {
    const state = this.tasks.get(threadId)
    if (!state) return false
    state.pendingInstruction = instruction
    logger.info(`注入指令: thread=${threadId} → "${instruction.slice(0, 30)}..."`)
    return true
  }

  /** 取消任务 */
  cancelTask(threadId: string): boolean {
    const state = this.tasks.get(threadId)
    if (!state) return false
    state.cancelled = true
    state.paused = false // 如果在暂停中则释放
    logger.info(`取消: thread=${threadId}`)
    this.broadcastProgress(threadId, 'cancelled', '任务已取消')
    return true
  }

  /** 检查是否已取消 */
  isCancelled(threadId: string): boolean {
    return this.tasks.get(threadId)?.cancelled ?? false
  }

  /** 获取活跃任务数 */
  get activeTaskCount(): number {
    return this.tasks.size
  }

  /** 获取活跃任务列表（给 API） */
  listActiveTasks(): TaskInfo[] {
    const now = Date.now()
    return [...this.tasks.entries()].map(([threadId, state]) => ({
      threadId,
      state: state.cancelled
        ? ('cancelled' as const)
        : state.paused
          ? ('paused' as const)
          : ('running' as const),
      startedAt: state.startedAt,
      currentTurn: state.currentTurn,
      elapsedMs: now - state.startedAt,
      agentId: state.agentId,
    }))
  }

  /** 获取单个任务状态 */
  getTaskInfo(threadId: string): TaskInfo | null {
    const state = this.tasks.get(threadId)
    if (!state) return null
    return {
      threadId,
      state: state.cancelled ? 'cancelled' : state.paused ? 'paused' : 'running',
      startedAt: state.startedAt,
      currentTurn: state.currentTurn,
      elapsedMs: Date.now() - state.startedAt,
      agentId: state.agentId,
    }
  }

  // ─────────────────────────────────────────
  // 2. 窗口级活跃 Agent（替代全局 activeAgentId）
  // ─────────────────────────────────────────

  /**
   * 设置窗口的活跃 Agent
   * @param windowId  前端窗口 ID（前端自行生成，如 uuid）
   * @param agentId   Agent ID
   */
  setWindowAgent(windowId: string, agentId: string): void {
    this.windowAgents.set(windowId, agentId)
    logger.debug(`窗口活跃 Agent: window=${windowId}, agent=${agentId}`)
  }

  /**
   * 获取窗口的活跃 Agent
   * @returns Agent ID，如果窗口不存在返回 undefined
   */
  getWindowAgent(windowId: string): string | undefined {
    return this.windowAgents.get(windowId)
  }

  /**
   * 移除窗口（窗口关闭时调用）
   */
  removeWindow(windowId: string): void {
    this.windowAgents.delete(windowId)
    logger.debug(`窗口已移除: ${windowId}`)
  }

  /**
   * 获取所有窗口的活跃 Agent 映射
   * @returns Map<windowId, agentId>
   */
  getAllWindowAgents(): Map<string, string> {
    return new Map(this.windowAgents)
  }

  /**
   * 获取使用指定 Agent 的窗口列表
   * @param agentId Agent ID
   * @returns 使用该 Agent 的窗口 ID 列表
   */
  getWindowsByAgent(agentId: string): string[] {
    const windows: string[] = []
    for (const [windowId, id] of this.windowAgents) {
      if (id === agentId) windows.push(windowId)
    }
    return windows
  }

  // ─────────────────────────────────────────
  // 3. Thread 运行时状态
  // ─────────────────────────────────────────

  /**
   * 设置 Thread 的打字状态
   * @param threadId  Thread ID
   * @param isTyping  是否正在生成回复
   */
  setThreadTyping(threadId: string, isTyping: boolean): void {
    const state = this.threadStates.get(threadId) ?? {
      isTyping: false,
      lastActiveAt: Date.now(),
    }
    state.isTyping = isTyping
    state.lastActiveAt = Date.now()
    this.threadStates.set(threadId, state)
  }

  /**
   * 检查 Thread 是否正在打字
   */
  isThreadTyping(threadId: string): boolean {
    return this.threadStates.get(threadId)?.isTyping ?? false
  }

  /**
   * 获取 Thread 最后活跃时间
   */
  getThreadLastActiveAt(threadId: string): number | undefined {
    return this.threadStates.get(threadId)?.lastActiveAt
  }

  /**
   * 清理 Thread 运行时状态（Thread 被删除时调用）
   */
  clearThreadState(threadId: string): void {
    this.threadStates.delete(threadId)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /** 超时处理 */
  private handleTimeout(threadId: string): void {
    const state = this.tasks.get(threadId)
    if (!state || state.cancelled) return

    logger.warn(`任务超时: thread=${threadId} (${this.timeoutMs / 1000}s)`)
    state.cancelled = true
    state.paused = false
    this.setThreadTyping(threadId, false)
    this.broadcastProgress(threadId, 'error', `任务超时 (${this.timeoutMs / 1000}s)`)
  }

  /** 清理任务（释放定时器） */
  private cleanupTask(threadId: string): void {
    const existing = this.tasks.get(threadId)
    if (existing?.timeoutTimer) {
      clearTimeout(existing.timeoutTimer)
    }
    this.tasks.delete(threadId)
  }

  /** 广播进度 */
  private broadcastProgress(
    threadId: string,
    state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error',
    message?: string,
  ): void {
    if (!this.broadcaster) return
    const taskState = this.tasks.get(threadId)
    this.broadcaster({
      threadId,
      turn: taskState?.currentTurn ?? 0,
      state,
      message,
    }).catch((err) => {
      logger.warn(`进度广播失败: ${err}`)
    })
  }
}
