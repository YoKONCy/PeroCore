/**
 * MemoryTaskRunner — 长记忆后台任务统一管辖者
 *
 * 职责：
 * 1. 统一管理所有长记忆相关的后台任务（Scorer 提炼、Gate 审核、Maintenance 维护）
 * 2. 控制任务的生命周期（触发、运行、取消、重试）
 * 3. 避免任务之间冲突（如 Scorer 和 Maintenance 不应同时跑）
 *
 * 设计：
 * - 抽象接口 MemoryTaskRunner，第五阶段实现 LocalMemoryTaskRunner
 * - 消费层（ChatRouter/Scheduler）只依赖此接口触发任务
 * - 不再让 ScorerService 自己管理触发逻辑
 *
 * 任务流程：
 *   triggerScorer(threadId) → Scorer 提炼候选
 *   runGate() → Gate 审核候选 → 写入 CanonicalMemory
 *   runMaintenance() → 维护任务（Consolidator/Auditor/...）
 *
 * @module packages/backend/src/services/memory/memoryTaskRunner
 */

// ─────────────────────────────────────────────
// 任务状态
// ─────────────────────────────────────────────

/** 任务类型 */
export type MemoryTaskType = 'scorer' | 'gate' | 'maintenance'

/** 任务状态 */
export type MemoryTaskStatus = 'idle' | 'running' | 'completed' | 'failed'

/** 任务执行结果 */
export interface MemoryTaskResult {
  taskType: MemoryTaskType
  status: MemoryTaskStatus
  /** 处理的候选/记忆数量 */
  processedCount: number
  /** 新写入的 CanonicalMemory 数量 */
  createdCount: number
  /** 耗时（毫秒） */
  durationMs: number
  /** 错误信息（status=failed 时有值） */
  error?: string
}

// ─────────────────────────────────────────────
// MemoryTaskRunner 抽象接口
// ─────────────────────────────────────────────

/**
 * MemoryTaskRunner — 长记忆后台任务统一管辖者
 *
 * 所有长记忆相关的后台任务都通过此接口触发，
 * 避免任务调用逻辑散落在各处导致生命周期混乱。
 */
export interface MemoryTaskRunner {
  /**
   * 触发 Scorer 提炼（异步，不等待）
   *
   * 在对话结束后由 ChatRouter 调用。
   * Scorer 从 Thread 提取候选记忆，写入 memory_candidates 表。
   *
   * @param threadId Thread ID
   * @param agentId Agent ID
   * @param channel 对话通道
   */
  triggerScorer(threadId: string, agentId: string, channel: string): Promise<void>

  /**
   * 运行 Gate 审核（同步等待结果）
   *
   * 审核 pending 状态的 memory_candidates，
   * 决定 accept/reject/merge/skip。
   *
   * @param agentId 限定 Agent（可选，不传则处理所有）
   * @returns 审核结果
   */
  runGate(agentId?: string): Promise<MemoryTaskResult>

  /**
   * 运行维护任务（同步等待结果）
   *
   * 包括 Consolidator（合并）、Auditor（审计）、
   * GraphGardener（图谱修剪）等。
   *
   * @param agentId 限定 Agent（可选）
   * @returns 维护结果
   */
  runMaintenance(agentId?: string): Promise<MemoryTaskResult>

  /**
   * 恢复未完成的 Scorer 任务
   *
   * 在服务启动时调用，处理上次崩溃未完成的批次。
   *
   * @param agentId 限定 Agent（可选）
   */
  recoverPendingTasks(agentId?: string): Promise<void>

  /**
   * 获取当前任务状态
   */
  getTaskStatus(taskType: MemoryTaskType): MemoryTaskStatus

  /**
   * 取消正在运行的任务
   *
   * @param taskType 任务类型
   */
  cancelTask(taskType: MemoryTaskType): Promise<void>
}
