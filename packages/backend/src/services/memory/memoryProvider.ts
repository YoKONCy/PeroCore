/**
 * MemoryProvider — 长记忆抽象接口
 *
 * 职责：
 * 1. 定义长记忆模块对外的统一接口（search/add/getRecent）
 * 2. 隔离消费层（ContextCompiler）与实现层（SQLite/TriviumDB）
 * 3. 支持未来替换长记忆框架（如 LangChain Memory / Mem0）
 *
 * 设计：
 * - 抽象接口 MemoryProvider，第五阶段实现 LocalMemoryProvider
 * - LocalMemoryProvider 内部包装 MemorySearchService + MemoryService
 * - ContextCompiler 只依赖 MemoryProvider 接口
 * - 未来换框架只需新建 XxxMemoryProvider 实现
 *
 * @module packages/backend/src/services/memory/memoryProvider
 */

// ─────────────────────────────────────────────
// Provenance 类型（来源追溯）
// ─────────────────────────────────────────────

/**
 * 记忆来源追溯
 *
 * 每条 CanonicalMemory 必须记录来源，用于：
 * - 追溯记忆来源
 * - 按 Thread 删除相关记忆
 * - 判断记忆可靠性
 * - 隐私请求时定位
 */
export interface MemoryProvenance {
  /** 来源 Thread ID */
  originThreadId: string
  /** 来源消息 ID 列表 */
  originMessageIds: string[]
  /** 来源 channel（desktop/companion/social/group） */
  originChannel: string
  /** 来源平台（QQ/Discord 等，社交场景） */
  originPlatform?: string
  /** 创建方式（scorer/manual/gate/diary） */
  createdFrom: 'scorer' | 'manual' | 'gate' | 'diary'
  /** 创建时间 */
  createdAt: string
}

// ─────────────────────────────────────────────
// 记忆类型
// ─────────────────────────────────────────────

/** 记忆类型 */
export type MemoryType = 'experience' | 'preference' | 'knowledge' | 'relationship' | 'event'

/** 记忆状态 */
export type MemoryStatus = 'active' | 'archived' | 'superseded'

// ─────────────────────────────────────────────
// CanonicalMemory（已确认的长期记忆）
// ─────────────────────────────────────────────

/** CanonicalMemory — 已确认的长期记忆 */
export interface CanonicalMemory {
  id: string
  agentId: string
  type: MemoryType
  content: string
  summary: string
  importance: number
  confidence: number
  status: MemoryStatus
  provenance: MemoryProvenance
  supersededBy?: string
  supersedes?: string[]
  vectorId?: string
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────
// MemoryCandidate（待确认的记忆候选）
// ─────────────────────────────────────────────

/** MemoryCandidate — 待确认的记忆候选 */
export interface MemoryCandidate {
  id: string
  agentId: string
  source: 'thread' | 'diary' | 'scheduler' | 'manual'
  originThreadId: string
  originMessageIds: string[]
  summary: string
  evidenceRefs: string[]
  importance: number
  confidence: number
  suggestedType: MemoryType
  status: 'pending' | 'accepted' | 'rejected' | 'merged'
  createdAt: string
  processedAt?: string
}

// ─────────────────────────────────────────────
// 检索相关类型
// ─────────────────────────────────────────────

/** 记忆检索结果 */
export interface MemorySearchResultItem {
  id: string
  content: string
  summary: string
  importance: number
  type: MemoryType
  score: number
  provenance?: MemoryProvenance
}

/** 检索参数 */
export interface MemorySearchParams {
  query: string
  agentId: string
  channel: string
  limit?: number
  /** 最低重要性阈值（默认 0） */
  minImportance?: number
}

/** 添加记忆的输入 */
export interface AddMemoryInput {
  agentId: string
  content: string
  summary?: string
  type: MemoryType
  importance?: number
  confidence?: number
  tags?: string[]
  provenance: MemoryProvenance
}

// ─────────────────────────────────────────────
// MemoryProvider 抽象接口
// ─────────────────────────────────────────────

/**
 * MemoryProvider — 长记忆统一接口
 *
 * 消费层（ContextCompiler）只依赖此接口，不依赖具体实现。
 * 第五阶段实现 LocalMemoryProvider（SQLite + TriviumDB）。
 * 未来可替换为 LangChainMemoryProvider / Mem0Provider 等。
 */
export interface MemoryProvider {
  /**
   * 语义检索记忆
   *
   * @param params 检索参数（含 agentId + channel 用于隔离）
   * @returns 检索结果列表
   */
  search(params: MemorySearchParams): Promise<MemorySearchResultItem[]>

  /**
   * 添加长期记忆（直接写入，绕过候选审核）
   *
   * 用于手动添加或 diary 等可信来源。
   * Scorer 提炼的候选应走 addCandidate → Gate 审核 → add。
   */
  add(input: AddMemoryInput): Promise<CanonicalMemory>

  /**
   * 获取最近的记忆（按时间倒序）
   *
   * 用于上下文注入时的快速召回。
   */
  getRecent(agentId: string, limit?: number): Promise<CanonicalMemory[]>

  /**
   * 按来源 Thread 删除记忆
   *
   * 用于 Thread 删除时清理关联记忆（隐私请求场景）。
   */
  deleteByThreadId(threadId: string): Promise<number>
}

// ─────────────────────────────────────────────
// MemoryGate 决策类型
// ─────────────────────────────────────────────

/** Gate 审核决策 */
export type GateDecision = 'accept' | 'reject' | 'merge' | 'skip'

/** Gate 审核结果 */
export interface GateResult {
  decision: GateDecision
  /** 合并目标（decision=merge 时有值） */
  mergeTargetId?: string
  /** 被取代的旧记忆 ID（decision=accept 且新记忆取代旧记忆时） */
  supersededIds?: string[]
  /** 决策原因 */
  reason: string
}
