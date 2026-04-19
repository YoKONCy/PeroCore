/**
 * Scorer Service — 记忆提炼引擎
 *
 * 攒批处理对话日志，通过 LLM 提炼为结构化记忆。
 * 批次大小可调，设为 1 时向下兼容 v1 的逐轮触发行为。
 *
 * 输出字段 (10_MEMORY_SYSTEM.md §14.6.2):
 * - content, tags, importance, sentiment, memory_type    (基础)
 * - entities, causal_refs, topic_keys, nearest_cluster   (Leiden 边建材)
 *
 * @module packages/backend/src/services/memory/scorerService
 */

import type { ConversationLogService } from './conversationLog'
import type { MemoryService } from './memoryService'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { VectorRepository } from '../../repositories/vector.repo'
import type { EmbeddingProvider } from '../embedding/embeddingService'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ScorerService')

// ─────────────────────────────────────────────
// 配置常量 (全部可调)
// ─────────────────────────────────────────────

export interface ScorerConfig {
  /** 攒批阈值：每多少轮对话触发一次 Scorer (设为 1 = v1 逐轮行为) */
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
// Scorer 输出结构 (§14.6.2)
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

  // ── Leiden 边建材 (§14.6.2 新增) ──

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
    private memoryService: MemoryService,
    private logService: ConversationLogService,
    private llmService: LlmService,
    private configRepo: ConfigRepository,
    private vectorRepo?: VectorRepository,
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
   */
  async checkAndProcess(agentId: string): Promise<void> {
    const pending = await this.logService.getPendingForScorer(agentId, this.config.batchSize)

    if (pending.length < this.config.batchSize) {
      logger.debug(`待处理对话 ${pending.length}/${this.config.batchSize}，未达到攒批阈值`)
      return
    }

    await this.processBatch(agentId)
  }

  /**
   * 批量处理待分析的对话日志
   *
   * 核心流程:
   * 1. 拉取 pending 对话对
   * 2. 余弦去重 (§11.1，可选)
   * 3. 拼接对话上下文 (含 Token 预检)
   * 4. 调用 LLM 提炼
   * 5. 保存记忆 + 建时间链/图谱边
   * 6. 处理 entities → 图谱边建材 (§14.6.2)
   * 7. 更新对话日志的 analysisStatus
   */
  async processBatch(agentId: string): Promise<void> {
    const pending = await this.logService.getPendingForScorer(agentId, this.config.batchSize)

    if (pending.length === 0) return

    logger.info(`开始批量分析 ${pending.length} 条对话 (Agent: ${agentId})`)

    // Token 预检
    const totalChars = pending.reduce((sum, log) => sum + (log.content?.length ?? 0), 0)
    if (totalChars > this.config.maxBatchChars && pending.length > 1) {
      logger.info(`批次过大 (${totalChars} 字符)，截取前半部分`)
      // 截取一半重新处理
      const halfSize = Math.ceil(pending.length / 2)
      const trimmed = pending.slice(0, halfSize)
      pending.length = 0
      pending.push(...trimmed)
    }

    // 余弦去重 (§11.1)
    const dedupedPending = await this.deduplicateByEmbedding(pending)
    if (dedupedPending.length === 0) {
      logger.info('所有对话被余弦去重过滤，跳过')
      return
    }

    // 拼接对话上下文
    const contextLines = dedupedPending
      .sort((a, b) => a.id - b.id)
      .map((log) => {
        const label = log.role === 'user' ? '主人' : 'AI'
        return `${label}: ${this.cleanText(log.content)}`
      })

    const fullContext = contextLines.join('\n')

    // 获取 Scorer 模型配置
    const modelConfig = await this.getScorerModelConfig()
    if (!modelConfig) {
      logger.warn('未配置 Scorer 模型，跳过分析')
      return
    }

    // 收集 pairIds 用于后续状态更新
    const pairIds = [...new Set(pending.map((l) => l.pairId).filter(Boolean))] as string[]

    try {
      // 调用 LLM
      const result = await this.callLlm(modelConfig, fullContext, dedupedPending.length, agentId)

      if (!result?.content) {
        logger.info('LLM 未返回有效内容')
        for (const pairId of pairIds) {
          await this.logService.markAnalyzed(pairId, {})
        }
        return
      }

      // 保存记忆
      const memory = await this.memoryService.create({
        content: result.content,
        agentId,
        tags: result.tags?.join(',') ?? '',
        importance: result.importance ?? 5,
        sentiment: result.sentiment ?? 'neutral',
        type: result.memory_type ?? 'event',
        source: pending[0]?.source ?? 'desktop',
      })

      // 处理 Leiden 边建材 (§14.6.2)
      await this.processEdgeMaterials(result, memory.id, agentId, pending[0]?.source ?? 'desktop')

      // 更新对话日志状态
      for (const pairId of pairIds) {
        await this.logService.markAnalyzed(pairId, {
          sentiment: result.sentiment,
          importance: result.importance,
          memoryId: memory.id,
        })
      }

      logger.info(`记忆已提炼: id=${memory.id}, "${result.content.slice(0, 50)}..."`)
    } catch (err) {
      logger.error(`批量处理失败: ${err}`)
      for (const pairId of pairIds) {
        await this.logService.markFailed(pairId, String(err).slice(0, 500))
      }
    }
  }

  /**
   * 恢复未完成的任务 (启动时调用)
   */
  async recoverPendingTasks(agentId: string): Promise<void> {
    logger.info('正在检查未完成的记忆任务...')
    let hasMore = true
    while (hasMore) {
      const pending = await this.logService.getPendingForScorer(agentId, this.config.batchSize)
      if (pending.length === 0) {
        hasMore = false
        break
      }
      await this.processBatch(agentId)
    }
  }

  // ── 内部方法 ──

  /**
   * 余弦去重 (§11.1)
   *
   * 入队前与 buffer 中已有对话比余弦相似度，> dedupThreshold 跳过。
   * 需要 EmbeddingService 可用，否则跳过去重。
   */
  private async deduplicateByEmbedding(
    logs: Array<{ id: number; role: string; content: string; pairId: string | null; source: string }>,
  ): Promise<typeof logs> {
    if (!this.embeddingService || logs.length <= 1) return logs

    // 只对用户消息去重 (助手消息跟随用户消息)
    const userLogs = logs.filter((l) => l.role === 'user')
    if (userLogs.length <= 1) return logs

    try {
      const texts = userLogs.map((l) => this.cleanText(l.content))
      const embeddings = await this.embeddingService.embed(texts)

      const keepPairIds = new Set<string | null>()
      const keptEmbeddings: number[][] = []

      for (let i = 0; i < userLogs.length; i++) {
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
          keepPairIds.add(userLogs[i]!.pairId)
          keptEmbeddings.push(emb)
        }
      }

      // 保留未被去重的对话对 (用户+助手都保留)
      const filtered = logs.filter((l) => keepPairIds.has(l.pairId))
      if (filtered.length < logs.length) {
        logger.info(`余弦去重: ${logs.length} → ${filtered.length} 条`)
      }
      return filtered
    } catch (err) {
      logger.warn(`余弦去重失败，跳过: ${err}`)
      return logs
    }
  }

  /**
   * 处理 Leiden 边建材 (§14.6.2)
   *
   * 将 Scorer 输出的 entities 和 causal_refs 写入图谱。
   */
  private async processEdgeMaterials(
    result: ScorerOutput,
    memoryId: number,
    agentId: string,
    source: string,
  ): Promise<void> {
    if (!this.vectorRepo) return

    // 1. Entity 关键词索引 (支持后续 entity 边检索)
    if (result.entities?.length) {
      for (const entity of result.entities) {
        try {
          await this.vectorRepo.indexKeyword(
            memoryId,
            `entity_${entity.name}`,
            agentId,
            source,
          )
        } catch (err) {
          logger.debug(`Entity 索引失败: ${entity.name}: ${err}`)
        }
      }
    }

    // 2. Topic 关键词索引
    if (result.topic_keys?.length) {
      for (const topic of result.topic_keys) {
        try {
          await this.vectorRepo.indexKeyword(memoryId, `topic_${topic}`, agentId, source)
        } catch (err) {
          logger.debug(`Topic 索引失败: ${topic}: ${err}`)
        }
      }
    }

    // 3. Causal 边 (因果引用)
    if (result.causal_refs?.length) {
      for (const refId of result.causal_refs) {
        try {
          await this.vectorRepo.link(refId, memoryId, 'causal', 0.6, agentId, source)
        } catch (err) {
          logger.debug(`Causal 边建立失败: ${refId} → ${memoryId}: ${err}`)
        }
      }
    }
  }

  /**
   * 调用 LLM 进行记忆提炼
   */
  private async callLlm(
    modelConfig: ModelConfig,
    context: string,
    messageCount: number,
    _agentId: string,
  ): Promise<ScorerOutput | null> {
    // 构建 System Prompt
    // TODO: 后续接入 MDP TemplateEngine 渲染
    const systemPrompt = [
      `你是一个专业的记忆提炼助手。`,
      `请分析以下 ${messageCount} 条对话记录，提取核心记忆。`,
      `输出严格 JSON 格式（不要使用 markdown 代码块）:`,
      `{`,
      `  "content": "提炼后的简洁记忆（一两句话）",`,
      `  "tags": ["标签1", "标签2"],`,
      `  "importance": 1-10,`,
      `  "sentiment": "positive/negative/neutral",`,
      `  "memory_type": "event/preference/knowledge/emotion",`,
      `  "entities": [{"name": "实体名", "type": "person/place/item/concept"}],`,
      `  "causal_refs": [],`,
      `  "topic_keys": ["关键词1", "关键词2"]`,
      `}`,
    ].join('\n')

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
   * 获取 Scorer 专用模型配置
   *
   * 优先级: 秘书专用配置 > 主模型配置 > 兜底
   */
  private async getScorerModelConfig(): Promise<ModelConfig | null> {
    const apiKey = await this.configRepo.get('global_llm_api_key')
    if (!apiKey) return null

    const apiBase = await this.configRepo.get('global_llm_api_base')
    const scorerModel = await this.configRepo.get('scorer_model_id')

    return {
      provider: 'openai',
      modelId: scorerModel ?? 'gpt-4o-mini',
      apiKey,
      apiBase: apiBase ?? undefined,
      temperature: this.config.temperature,
    }
  }

  /**
   * 清洗对话文本
   *
   * 移除系统注入标签、Thinking 块等噪音 (继承 v1 _smart_clean_text)
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
