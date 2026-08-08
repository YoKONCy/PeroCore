/**
 * LocalMemoryProvider — 第五阶段 MemoryProvider 本地实现
 *
 * 基于 SQLite (canonical_memories) + memory_nodes (向后兼容) + TriviumDB 向量检索。
 *
 * 设计要点：
 * - search() 走 MemorySearchService（向量检索 → enrichResults 通过 memory_nodes 数字 id 查内容）
 * - add() 同时写 memory_nodes（获取数字 id 用于向量索引）和 canonical_memories（携带 provenance）
 *   canonical_memories.vectorId 存数字 id 字符串，建立两表关联
 * - getRecent() 走 canonical_memories（按 createdAt 倒序）
 * - deleteByThreadId() 走 canonical_memories.provenance 匹配（暂不联动 memory_nodes）
 *
 * @module packages/backend/src/services/memory/localMemoryProvider
 */

import { randomUUID } from 'node:crypto'
import type { CanonicalMemoryRepository } from '../../repositories/canonicalMemory.repo'
import type { MemoryCandidateRepository } from '../../repositories/memoryCandidate.repo'
import type { MemoryService } from './memoryService'
import type { MemorySearchService, MemorySearchResult } from './memorySearch'
import type {
  MemoryProvider,
  MemorySearchParams,
  MemorySearchResultItem,
  AddMemoryInput,
  CanonicalMemory,
  MemoryType,
} from './memoryProvider'
import { createLogger } from '../../lib/logger'

const logger = createLogger('LocalMemoryProvider')

/** 合法的 MemoryType 取值（用于校验检索结果类型） */
const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set([
  'experience',
  'preference',
  'knowledge',
  'relationship',
  'event',
])

/**
 * 将 MemorySearchResult（来自 memory_nodes）映射为 MemorySearchResultItem
 *
 * id 转字符串以符合 MemorySearchResultItem 类型；type 校验后回退为 'event'。
 */
function toResultItem(r: MemorySearchResult): MemorySearchResultItem {
  const type: MemoryType = VALID_MEMORY_TYPES.has(r.type)
    ? (r.type as MemoryType)
    : 'event'
  return {
    id: String(r.id),
    content: r.content,
    summary: '',
    importance: r.importance,
    type,
    score: r.score,
  }
}

// ─────────────────────────────────────────────
// LocalMemoryProvider
// ─────────────────────────────────────────────

export class LocalMemoryProvider implements MemoryProvider {
  constructor(
    private canonicalMemoryRepo: CanonicalMemoryRepository,
    // memoryCandidateRepo 注入但 LocalMemoryProvider 不直接使用（保留供未来扩展，如 addCandidate）
    _memoryCandidateRepo: MemoryCandidateRepository,
    private memorySearchService: MemorySearchService,
    private memoryService: MemoryService,
    // vectorRepo/vectorWriteHelper 注入保留供未来扩展（当前 add() 通过 memoryService 间接使用）
    _vectorRepo: unknown,
    _vectorWriteHelper: unknown,
  ) {}

  /**
   * 语义检索记忆
   *
   * 走 MemorySearchService（向量检索 → enrichResults 通过 memory_nodes 数字 id 查内容）。
   * channel 映射为 source（desktop/companion → desktop；social/group → social）。
   */
  async search(params: MemorySearchParams): Promise<MemorySearchResultItem[]> {
    const { query, agentId, channel, limit } = params
    if (!query.trim()) return []

    try {
      // channel 映射到 MemorySource（与 ContextCompiler 旧逻辑保持一致）
      const source = channel === 'social' || channel === 'group' ? 'social' : 'desktop'
      const topK = limit ?? 10

      const results = await this.memorySearchService.search({
        query,
        agentId,
        source,
        topK,
      })

      // 过滤 Entity 节点（结构节点，不适合注入上下文）
      const filtered = results.filter((r) => r.type !== 'entity')
      return filtered.map(toResultItem)
    } catch (err) {
      logger.warn('记忆检索失败', { error: err })
      return []
    }
  }

  /**
   * 添加长期记忆（直接写入，绕过候选审核）
   *
   * 流程：
   * 1. 通过 memoryService.create 写 memory_nodes（获取数字 id，同时建立向量索引 + 时间链）
   * 2. 通过 canonicalMemoryRepo.create 写 canonical_memories（携带 provenance，vectorId 关联数字 id）
   *
   * content 在两表中冗余存储，可接受（向后兼容，向量检索走 memory_nodes）。
   */
  async add(input: AddMemoryInput): Promise<CanonicalMemory> {
    // 1. 写 memory_nodes（含向量写入 + 时间链 + BM25 索引）
    const memoryNode = await this.memoryService.create({
      content: input.content,
      agentId: input.agentId,
      tags: input.tags?.join(','),
      importance: input.importance,
      type: input.type,
      // source 用 provenance.originChannel，让向量检索时能按 channel 过滤
      source: input.provenance.originChannel || 'desktop',
    })

    // 2. 写 canonical_memories（携带 provenance，vectorId 关联 memory_nodes 数字 id）
    const canonicalId = randomUUID()
    const canonical = await this.canonicalMemoryRepo.create({
      id: canonicalId,
      agentId: input.agentId,
      type: input.type,
      content: input.content,
      summary: input.summary,
      importance: input.importance,
      confidence: input.confidence,
      status: 'active',
      provenance: input.provenance,
      vectorId: String(memoryNode.id),
    })

    logger.debug(
      `CanonicalMemory 已创建: id=${canonicalId}, vectorId=${memoryNode.id}, agent=${input.agentId}`,
    )
    return canonical
  }

  /**
   * 获取最近的记忆（按 createdAt 倒序）
   *
   * 走 canonical_memories 表（仅 active 状态）。
   */
  async getRecent(agentId: string, limit?: number): Promise<CanonicalMemory[]> {
    return this.canonicalMemoryRepo.findRecent(agentId, limit ?? 10)
  }

  /**
   * 按来源 Thread 删除记忆
   *
   * 走 canonical_memories.provenance 匹配 originThreadId。
   * 注：暂不联动删除 memory_nodes（向量检索的兜底记忆保留，避免误删共享记忆）。
   */
  async deleteByThreadId(threadId: string): Promise<number> {
    const deleted = await this.canonicalMemoryRepo.deleteByThreadId(threadId)
    logger.info(`按 Thread 删除了 ${deleted} 条 CanonicalMemory (threadId=${threadId})`)
    return deleted
  }
}
