/**
 * Task Manager — 任务暂停/注入/取消/超时
 *
 * 管理 ReAct 循环的暂停检测、即时指令注入、任务取消、超时保护。
 *
 * B6-4 升级:
 * - 任务超时自动取消 (默认 5 分钟)
 * - Gateway 进度广播集成
 * - 任务状态查询 API
 * - 活跃任务列表
 *
 * 替代 v1 的 task_manager.py (121行 → ~200行)。
 *
 * @module packages/backend/src/services/agent/taskManager
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('TaskManager')

/** 默认任务超时 (ms) — 5 分钟 */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000

/** 任务状态 */
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

/** 任务信息 (给 API 返回) */
export interface TaskInfo {
  sessionId: string
  state: 'running' | 'paused' | 'cancelled'
  startedAt: number
  currentTurn: number
  elapsedMs: number
  agentId?: string
}

/** 进度广播回调 */
export type ProgressBroadcaster = (params: {
  sessionId: string
  turn: number
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  message?: string
}) => Promise<void>

export class TaskManager {
  /** 活跃任务状态 (sessionId → TaskState) */
  private tasks = new Map<string, TaskState>()

  /** 进度广播回调 (Gateway 注入) */
  private broadcaster: ProgressBroadcaster | null = null

  /** 任务超时时间 (ms) */
  private timeoutMs: number

  constructor(timeoutMs: number = DEFAULT_TASK_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  /** 注入进度广播回调 */
  setBroadcaster(broadcaster: ProgressBroadcaster): void {
    this.broadcaster = broadcaster
  }

  /** 注册任务 (ReAct 循环开始时调用) */
  register(sessionId: string, agentId?: string): void {
    // 清理可能的旧任务
    this.cleanupTask(sessionId)

    const state: TaskState = {
      paused: false,
      pendingInstruction: null,
      cancelled: false,
      startedAt: Date.now(),
      currentTurn: 0,
      agentId,
      timeoutTimer: null,
    }

    // 设置超时定时器 (B6-4)
    state.timeoutTimer = setTimeout(() => {
      this.handleTimeout(sessionId)
    }, this.timeoutMs)

    this.tasks.set(sessionId, state)
    logger.debug(`任务注册: ${sessionId}`)

    // 广播进度
    this.broadcastProgress(sessionId, 'running', '任务已开始')
  }

  /** 注销任务 (ReAct 循环结束时调用) */
  unregister(sessionId: string): void {
    const state = this.tasks.get(sessionId)
    if (state) {
      // 清理超时定时器
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer)
      }
      // 广播完成
      this.broadcastProgress(sessionId, 'completed', '任务完成')
    }
    this.tasks.delete(sessionId)
    logger.debug(`任务注销: ${sessionId}`)
  }

  /** 更新当前轮次 */
  updateTurn(sessionId: string, turn: number): void {
    const state = this.tasks.get(sessionId)
    if (!state) return
    state.currentTurn = turn
  }

  /** 检查暂停 (ReAct 每轮开始时调用) */
  async checkPause(sessionId: string): Promise<void> {
    const state = this.tasks.get(sessionId)
    if (!state?.paused) return

    logger.info(`任务暂停中: ${sessionId}`)
    this.broadcastProgress(sessionId, 'paused', '任务已暂停')

    // 等待恢复 (轮询, 每 500ms 检查一次)
    while (state.paused && !state.cancelled) {
      await new Promise((r) => setTimeout(r, 500))
    }
    logger.info(`任务已恢复: ${sessionId}`)
    this.broadcastProgress(sessionId, 'running', '任务已恢复')
  }

  /** 获取并清空待注入的即时指令 */
  getInjectedInstruction(sessionId: string): string | null {
    const state = this.tasks.get(sessionId)
    if (!state?.pendingInstruction) return null
    const instruction = state.pendingInstruction
    state.pendingInstruction = null
    return instruction
  }

  /** 暂停任务 */
  pause(sessionId: string): boolean {
    const state = this.tasks.get(sessionId)
    if (!state) return false
    state.paused = true
    logger.info(`暂停: ${sessionId}`)
    return true
  }

  /** 恢复任务 */
  resume(sessionId: string): boolean {
    const state = this.tasks.get(sessionId)
    if (!state) return false
    state.paused = false
    logger.info(`恢复: ${sessionId}`)
    return true
  }

  /** 注入即时指令 (下一轮 ReAct 开始时注入到消息中) */
  inject(sessionId: string, instruction: string): boolean {
    const state = this.tasks.get(sessionId)
    if (!state) return false
    state.pendingInstruction = instruction
    logger.info(`注入指令: ${sessionId} → "${instruction.slice(0, 30)}..."`)
    return true
  }

  /** 取消任务 */
  cancel(sessionId: string): boolean {
    const state = this.tasks.get(sessionId)
    if (!state) return false
    state.cancelled = true
    state.paused = false // 如果在暂停中则释放
    logger.info(`取消: ${sessionId}`)
    this.broadcastProgress(sessionId, 'cancelled', '任务已取消')
    return true
  }

  /** 检查是否已取消 */
  isCancelled(sessionId: string): boolean {
    return this.tasks.get(sessionId)?.cancelled ?? false
  }

  /** 获取活跃任务数 */
  get activeCount(): number {
    return this.tasks.size
  }

  /** 获取活跃任务列表 (B6-4, 给 API) */
  listActiveTasks(): TaskInfo[] {
    const now = Date.now()
    return [...this.tasks.entries()].map(([sessionId, state]) => ({
      sessionId,
      state: state.cancelled ? 'cancelled' as const : state.paused ? 'paused' as const : 'running' as const,
      startedAt: state.startedAt,
      currentTurn: state.currentTurn,
      elapsedMs: now - state.startedAt,
      agentId: state.agentId,
    }))
  }

  /** 获取单个任务状态 */
  getTaskInfo(sessionId: string): TaskInfo | null {
    const state = this.tasks.get(sessionId)
    if (!state) return null
    return {
      sessionId,
      state: state.cancelled ? 'cancelled' : state.paused ? 'paused' : 'running',
      startedAt: state.startedAt,
      currentTurn: state.currentTurn,
      elapsedMs: Date.now() - state.startedAt,
      agentId: state.agentId,
    }
  }

  // ── 内部方法 ──

  /** 超时处理 (B6-4) */
  private handleTimeout(sessionId: string): void {
    const state = this.tasks.get(sessionId)
    if (!state || state.cancelled) return

    logger.warn(`任务超时: ${sessionId} (${this.timeoutMs / 1000}s)`)
    state.cancelled = true
    state.paused = false
    this.broadcastProgress(sessionId, 'error', `任务超时 (${this.timeoutMs / 1000}s)`)
  }

  /** 清理任务 (释放定时器) */
  private cleanupTask(sessionId: string): void {
    const existing = this.tasks.get(sessionId)
    if (existing?.timeoutTimer) {
      clearTimeout(existing.timeoutTimer)
    }
    this.tasks.delete(sessionId)
  }

  /** 广播进度 */
  private broadcastProgress(
    sessionId: string,
    state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error',
    message?: string,
  ): void {
    if (!this.broadcaster) return
    const taskState = this.tasks.get(sessionId)
    this.broadcaster({
      sessionId,
      turn: taskState?.currentTurn ?? 0,
      state,
      message,
    }).catch((err) => {
      logger.warn(`进度广播失败: ${err}`)
    })
  }
}
