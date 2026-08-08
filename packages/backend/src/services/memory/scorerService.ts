/**
 * Scorer Service — 记忆提炼引擎
 *
 * 攒批处理对话，通过 LLM 提炼为结构化记忆。
 * 数据源：ThreadRepository（thread_messages 表，AIOS 架构）。
 * 批次大小可调，设为 1 时退化为逐轮触发。
 *
 * 输出字段:
 * - content, tags, importance, sentiment, memory_type    (基础)
 * - entities, causal_refs, topic_keys, nearest_cluster   (Leiden 边建材)
 *
 * @module packages/backend/src/services/memory/scorerService
 */

import { randomUUID } from 'node:crypto'
import type { ThreadRepository, ThreadChannel } from '../../repositories/thread.repo'
import type { MemoryCandidateRepository } from '../../repositories/memoryCandidate.repo'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'
import type { VectorRepository } from '../../repositories/vector.repo'
import type { EmbeddingProvider } from '../embedding/embeddingService'
import type { MemoryType } from './memoryProvider'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ScorerService')

/** Scorer 待处理的对话对（来自 ThreadRepository.getPendingForScorer） */
type ScorerPendingPair = Awaited<ReturnType<ThreadRepository['getPendingForScorer']>>[number]

/** 合法的 MemoryType 取值（用于校验 LLM 输出） */
const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set([
  'experience',
  'preference',
  'knowledge',
  'relationship',
  'event',
])

// ─────────────────────────────────────────────
// 配置常量 (全部可调)
// ─────────────────────────────────────────────

export interface ScorerConfig {
  /** 攒批阈值：每多少轮对话触发一次 Scorer (设为 1 = 逐轮触发) */
  batchSize: number
  /** 最大等待时间 (毫秒)：超时后即使不满批也触发 */
  maxWaitMs: number
  /** 最大重试次数 */
  maxRetries: number
  /** 最大批次字符数 (防止 Token 溢出) */
  maxBatchChars: number
  /** LLM 温度 (Scorer 需要相对客观) */
  temperature: number
  /** 余弦去重阈值: 与 buffer 中已有对话比较，超过此阈值跳过 */
  dedupThreshold: number
}

const DEFAULT_CONFIG: ScorerConfig = {
  batchSize: 8,
  maxWaitMs: 30 * 60 * 1000, // 30 分钟
  maxRetries: 3,
  maxBatchChars: 20000,
  temperature: 0.3,
  dedupThreshold: 0.92,
}

// ─────────────────────────────────────────────
// Scorer 输出结构
// ─────────────────────────────────────────────

/** LLM 返回的结构化分析结果 */
export interface ScorerOutput {
  /** 提炼后的记忆内容 */
  content: string
  /** 标签列表 */
  tags: string[]
  /** 重要性 1-10 */
  importance: number
  /** 情感极性 */
  sentiment: string
  /** 记忆类型 */
  memory_type: string

  // ── Leiden 边建材 ──

  /** 实体提取 */
  entities: Array<{ name: string; type: 'person' | 'place' | 'item' | 'concept' }>
  /** 因果引用 */
  causal_refs: number[]
  /** 主题关键词 */
  topic_keys: string[]
  /** 最接近的已有 cluster */
  nearest_cluster?: string
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ScorerService {
  private config: ScorerConfig

  constructor(
    private threadRepo: ThreadRepository,
    private llmService: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private mdpEngine: MdpEngine,
    private memoryCandidateRepo: MemoryCandidateRepository,
    // 第五阶段：vectorRepo 保留参数位以维持调用方签名兼容，但 Scorer 不再写向量（图谱建材改由 Reflection 管道）
    _vectorRepo?: VectorRepository,
    private embeddingService?: EmbeddingProvider,
    config?: Partial<ScorerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 检查并触发攒批处理
   *
   * 由对话循环调用：每次新对话对保存后调用此方法。
   * 当 pending 数量 >= batchSize 时触发 LLM 分析。
   *
   * AIOS(Phase5): 新增 threadId + channel 参数，支持按 Thread 分批提炼。
   * - 传入 threadId 时只处理该 Thread 的对话
   * - 传入 channel 时只处理该 channel 的对话
   */
  async checkAndProcess(
    agentId: string,
    threadId?: string,
    channel?: string,
  ): Promise<void> {
    const channelTyped = channel as ThreadChannel | undefined
    const pending = await this.threadRepo.getPendingForScorer(
      agentId,
      this.config.batchSize,
      threadId,
      channelTyped,
    )

    if (pending.length < this.config.batchSize) {
      logger.debug(
        `待处理对话 ${pending.length}/${this.config.batchSize}，未达到攒批阈值 ` +
          `(threadId=${threadId ?? 'all'}, channel=${channel ?? 'all'})`,
      )
      return
    }

    await this.processBatch(agentId, threadId, channel)
  }

  /**
   * 批量处理待分析的对话对
   *
   * 核心流程:
   * 1. 拉取 pending 对话对
   * 2. 余弦去重 (可选)
   * 3. 拼接对话上下文 (含 Token 预检)
   * 4. 调用 LLM 提炼
   * 5. 保存记忆 + 建时间链/图谱边
   * 6. 处理 entities → 图谱边建材
   * 7. 更新 thread_messages 的 scorerStatus
   *
   * AIOS(Phase5): 新增 threadId + channel 参数，支持按 Thread 分批。
   */
  async processBatch(
    agentId: string,
    threadId?: string,
    channel?: string,
  ): Promise<void> {
    const channelTyped = channel as ThreadChannel | undefined
    const pending = await this.threadRepo.getPendingForScorer(
      agentId,
      this.config.batchSize,
      threadId,
      channelTyped,
    )

    if (pending.length === 0) return

    logger.info(
      `开始批量分析 ${pending.length} 条对话 (Agent: ${agentId}, ` +
        `threadId=${threadId ?? 'all'}, channel=${channel ?? 'all'})`,
    )

    // Token 预检：每对按 user + assistant 两条消息累计字符
    const totalChars = pending.reduce(
      (sum, pair) =>
        sum + (pair.userMessage.content?.length ?? 0) + (pair.assistantMessage.content?.length ?? 0),
      0,
    )
    if (totalChars > this.config.maxBatchChars && pending.length > 1) {
      logger.info(`批次过大 (${totalChars} 字符)，截取前半部分`)
      // 截取一半重新处理
      const halfSize = Math.ceil(pending.length / 2)
      const trimmed = pending.slice(0, halfSize)
      pending.length = 0
      pending.push(...trimmed)
    }

    // 余弦去重
    const dedupedPending = await this.deduplicateByEmbedding(pending)
    if (dedupedPending.length === 0) {
      logger.info('所有对话被余弦去重过滤，跳过')
      return
    }

    // 拼接对话上下文（每对先 user 后 assistant，按 user 消息 id 排序保持时序）
    const contextLines: string[] = []
    for (const pair of [...dedupedPending].sort(
      (a, b) => a.userMessage.id - b.userMessage.id,
    )) {
      contextLines.push(`主人: ${this.cleanText(pair.userMessage.content)}`)
      contextLines.push(`AI: ${this.cleanText(pair.assistantMessage.content)}`)
    }

    const fullContext = contextLines.join('\n')

    // 获取 Scorer 模型配置
    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      logger.warn('未配置 Scorer 模型，跳过分析')
      return
    }

    // 收集 pairIds 用于后续状态更新
    const pairIds = [...new Set(pending.map((p) => p.pairId).filter(Boolean))] as string[]

    try {
      // 调用 LLM
      const result = await this.callLlm(modelConfig, fullContext, dedupedPending.length, agentId)

      if (!result?.content) {
        logger.info('LLM 未返回有效内容')
        for (const pairId of pairIds) {
          await this.threadRepo.updateScorerStatus(pairId, 'analyzed', {})
        }
        return
      }

      // 第五阶段：Scorer 不再直接写入 memory_nodes，改为写入 memory_candidates 待 Gate 审核
      // 数据源为 Thread，故 source='thread'；originThreadId 取首条对话对的 threadId
      const originThreadId = dedupedPending[0]?.userMessage.threadId ?? ''
      const originMessageIds = dedupedPending.flatMap((p) => [
        String(p.userMessage.id),
        String(p.assistantMessage.id),
      ])
      // 证据引用：实体名 + 主题关键词
      const evidenceRefs: string[] = [
        ...(result.entities?.map((e) => e.name) ?? []),
        ...(result.topic_keys ?? []),
      ]
      // 校验 LLM 返回的 memory_type，非法时回退为 'event'
      const suggestedType: MemoryType = VALID_MEMORY_TYPES.has(result.memory_type ?? '')
        ? (result.memory_type as MemoryType)
        : 'event'

      const candidate = await this.memoryCandidateRepo.create({
        id: randomUUID(),
        agentId,
        source: 'thread',
        originThreadId,
        originMessageIds,
        summary: result.content,
        evidenceRefs,
        importance: result.importance ?? 5,
        confidence: 0.5,
        suggestedType,
        status: 'pending',
      })

      // 第五阶段：Scorer 不再调 vectorRepo.indexKeyword（图谱建材改由 Reflection 管道负责）
      // 注意: 图谱构建 (graph_builder) 由 Reflection 管道处理，不在 Scorer 阶段调用

      // 更新对话消息的 Scorer 状态（用 candidateId 关联，替代旧 memoryId）
      for (const pairId of pairIds) {
        await this.threadRepo.updateScorerStatus(pairId, 'analyzed', {
          sentiment: result.sentiment,
          importance: result.importance,
          candidateId: candidate.id,
        })
      }

      logger.info(
        `候选已写入: id=${candidate.id}, "${result.content.slice(0, 50)}..." (待 Gate 审核)`,
      )
    } catch (err) {
      logger.error(`批量处理失败: ${err}`)
      for (const pairId of pairIds) {
        await this.threadRepo.updateScorerStatus(pairId, 'failed', {
          error: String(err).slice(0, 500),
        })
      }
    }
  }

  /**
   * 恢复未完成的任务 (启动时调用)
   *
   * AIOS(Phase5): 新增 threadId + channel 参数，支持恢复指定 Thread 的未完成任务。
   */
  async recoverPendingTasks(
    agentId: string,
    threadId?: string,
    channel?: string,
  ): Promise<void> {
    logger.info(
      `正在检查未完成的记忆任务 (agentId=${agentId}, ` +
        `threadId=${threadId ?? 'all'}, channel=${channel ?? 'all'})...`,
    )
    let hasMore = true
    while (hasMore) {
      const channelTyped = channel as ThreadChannel | undefined
      const pending = await this.threadRepo.getPendingForScorer(
        agentId,
        this.config.batchSize,
        threadId,
        channelTyped,
      )
      if (pending.length === 0) {
        hasMore = false
        break
      }
      await this.processBatch(agentId, threadId, channel)
    }
  }

  // ── 内部方法 ──

  /**
   * 余弦去重
   *
   * 入队前与 buffer 中已有对话比余弦相似度，> dedupThreshold 跳过。
   * 只对 pair 中的 user 消息做去重，assistant 跟随 user。
   * 需要 EmbeddingService 可用，否则跳过去重。
   *
   * AIOS 第八阶段：增加 isAvailable 前置检查，避免不可用时走 try/catch 的网络失败路径。
   */
  private async deduplicateByEmbedding(pairs: ScorerPendingPair[]): Promise<ScorerPendingPair[]> {
    // AIOS 第八阶段：embedding 不可用时直接跳过去重
    if (!this.embeddingService || !this.embeddingService.isAvailable || pairs.length <= 1) {
      return pairs
    }

    try {
      const texts = pairs.map((p) => this.cleanText(p.userMessage.content))
      const embeddings = await this.embeddingService.embed(texts)

      const keepPairIds = new Set<string>()
      const keptEmbeddings: number[][] = []

      for (let i = 0; i < pairs.length; i++) {
        const emb = embeddings[i]!
        let isDuplicate = false

        // 与已保留的做对比
        for (const kept of keptEmbeddings) {
          const sim = this.cosineSimilarity(emb, kept)
          if (sim > this.config.dedupThreshold) {
            isDuplicate = true
            logger.debug(`对话去重: "${texts[i]?.slice(0, 30)}..." (相似度=${sim.toFixed(3)})`)
            break
          }
        }

        if (!isDuplicate) {
          keepPairIds.add(pairs[i]!.pairId)
          keptEmbeddings.push(emb)
        }
      }

      // 保留未被去重的对话对 (user + assistant 整对保留)
      const filtered = pairs.filter((p) => keepPairIds.has(p.pairId))
      if (filtered.length < pairs.length) {
        logger.info(`余弦去重: ${pairs.length} → ${filtered.length} 条`)
      }
      return filtered
    } catch (err) {
      logger.warn(`余弦去重失败，跳过: ${err}`)
      return pairs
    }
  }

  /**
   * 调用 LLM 进行记忆提炼
   */
  private async callLlm(
    modelConfig: ModelConfig,
    context: string,
    _messageCount: number,
    _agentId: string,
  ): Promise<ScorerOutput | null> {
    // 使用 MDP 模板渲染系统提示词
    const systemPrompt = this.mdpEngine.render('tasks/memory/scorer/summary', {
      agent_name: 'AI',
      owner_name: '主人',
    })

    const completion = await this.llmService.chat(
      modelConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      {
        temperature: this.config.temperature,
        responseFormat: { type: 'json_object' },
      },
    )

    const rawContent = completion.choices[0]?.message?.content
    if (!rawContent) return null

    return parseLlmJson<ScorerOutput>(rawContent)
  }

  /**
   * 清洗对话文本
   *
   * 移除系统注入标签、Thinking 块等噪音
   */
  private cleanText(text: string): string {
    if (!text) return ''

    let cleaned = text

    // 移除系统注入标签
    const removeTags = ['FILE_RESULTS', 'SEARCH_RESULTS', 'RETRIEVED_CONTEXT', 'SYSTEM_INJECTION']
    for (const tag of removeTags) {
      cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), `[${tag} Omitted]`)
    }

    // 移除 Thinking / Monologue 块
    cleaned = cleaned.replace(/【(?:Thinking|Monologue)[：:]?\s*[\s\S]*?】/gi, '')
    cleaned = cleaned.replace(/\[(?:Thinking|Monologue)[：:]?\s*[\s\S]*?\]/gi, '')

    return cleaned.trim()
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0
    let normA = 0
    let normB = 0
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i++) {
      dot += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }
}
