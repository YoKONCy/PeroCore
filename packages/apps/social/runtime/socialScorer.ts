/**
 * Social Scorer Service — 社交记忆图谱引擎
 *
 * 将社交平台高频消息炼化为 TriviumDB 图谱节点，
 * 采用 PEDSA 理性轨道 (RAG-less) 架构：
 * - **不做向量化** (零 Embedding API 开销)
 * - **不走 Reflection 管道** (无 tagger/consolidator)
 * - 检索靠 BM25 + 关键词 AC 自动机 + 图谱扩散
 *
 * 数据写入 social.tdb (物理隔离):
 * - Event 节点: 零向量 + 摘要 payload + BM25 文本索引
 * - Feature 节点: 关键词 + AC 自动机索引
 * - Feature→Event 边: memory_edge
 * - Feature→Feature 边: representation / equality (本体关联)
 *
 * 动态门控 (D50):
 * - 默认 200 条未总结消息触发
 * - 总字符数 >= 50k 时提前触发 (应对长消息场景)
 *
 * @module packages/apps/social/runtime/socialScorer
 */

import type { TriviumDB } from 'triviumdb'
import type { SocialMessageRepository } from './socialMessage.repo'
import type { MemoryStoreRegistry } from '../../../backend/src/repositories/storeRegistry'
import type { LlmService, ModelConfig } from '../../../backend/src/services/llm/llmService'
import type { MdpEngine } from '../../../backend/src/services/prompt/mdpEngine'
import { parseLlmJson } from '../../../backend/src/shared/llmJsonParser'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialScorer')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

export interface SocialScorerConfig {
  /** 默认消息数触发阈值 */
  messageThreshold: number
  /** 字符数触发阈值 (1 中文字 ≈ 1 token) */
  charThreshold: number
  /** 每次拉取的最大消息数 */
  batchLimit: number
  /** 最大重试次数 */
  maxRetries: number
  /** TriviumDB 向量维度 (使用零向量占位) */
  vectorDim: number
}

const DEFAULT_CONFIG: SocialScorerConfig = {
  messageThreshold: 200,
  charThreshold: 50_000,
  batchLimit: 200,
  maxRetries: 3,
  vectorDim: 1536,
}

// ─────────────────────────────────────────────
// LLM 输出结构 (PEDSA 简化格式)
// ─────────────────────────────────────────────

/** 事件节点 */
interface PedsaEvent {
  summary: string
  features: string[]
}

/** 本体关联更新 */
interface OntologyUpdate {
  source: string
  target: string
  relation: 'representation' | 'equality'
  strength: number
}

/** LLM 完整输出 */
interface SocialScorerOutput {
  new_event: PedsaEvent
  ontology_updates: OntologyUpdate[]
}

// ─────────────────────────────────────────────
// ID 生成 (确定性哈希)
// ─────────────────────────────────────────────

/**
 * FNV-1a 哈希函数 → 生成 TriviumDB 节点 ID
 *
 * Feature 节点使用关键词哈希 → 同一关键词总是映射到同一 ID。
 * Event 节点使用时间戳 + 计数器。
 */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5 // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0 // FNV prime, 保持 u32
  }
  // 避免与 Event ID 冲突，Feature ID 固定在高位区间
  return (hash | 0x80000000) >>> 0 // 确保最高位为 1
}

/** Event ID 计数器 (低位区间，不会与 Feature 冲突) */
let eventIdCounter = 0

function nextEventId(): number {
  // 使用 timestamp (秒) * 1000 + 计数器，保证唯一
  const base = Math.floor(Date.now() / 1000)
  return (base * 1000 + (eventIdCounter++ % 1000)) >>> 0
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class SocialScorerService {
  private config: SocialScorerConfig
  /** 零向量缓存 (避免每次分配) */
  private zeroVector: number[]

  constructor(
    private socialMessageRepo: SocialMessageRepository,
    private storeRegistry: MemoryStoreRegistry,
    private llmService: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private mdpEngine: MdpEngine,
    /** Agent 管理器（可选注入，用于按 agentId 读取该角色的称呼） */
    private agentManager?: { getOwnerAppellation(agentId: string): string },
    config?: Partial<SocialScorerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.zeroVector = new Array(this.config.vectorDim).fill(0)
  }

  /**
   * 检查动态门控并触发炼化
   *
   * 条件 (OR):
   * - 消息数 >= messageThreshold (默认 200)
   * - 总字符数 >= charThreshold (默认 50k)
   */
  async checkAndProcess(agentId: string): Promise<void> {
    const stats = await this.socialMessageRepo.getUnsummarizedStats(agentId)

    const messageTriggered = stats.count >= this.config.messageThreshold
    const tokenTriggered = stats.totalChars >= this.config.charThreshold

    if (!messageTriggered && !tokenTriggered) {
      logger.debug(
        `[${agentId}] 社交记忆未达门控: ` +
          `${stats.count}/${this.config.messageThreshold} 条, ` +
          `${stats.totalChars}/${this.config.charThreshold} 字符`,
      )
      return
    }

    const reason = tokenTriggered
      ? `字符数溢出 (${stats.totalChars} >= ${this.config.charThreshold})`
      : `消息数达标 (${stats.count} >= ${this.config.messageThreshold})`

    logger.info(`[${agentId}] 触发社交记忆炼化: ${reason}`)
    await this.processBatch(agentId)
  }

  /**
   * 执行一批社交消息的图谱炼化
   *
   * 流程:
   * 1. 拉取 batchLimit 条未总结消息
   * 2. LLM → PEDSA 简化格式 (new_event + ontology_updates)
   * 3. 写入 social.tdb:
   *    - Event 节点 (零向量 + payload)
   *    - Feature 节点 (indexKeyword)
   *    - Feature→Event 边 + Feature→Feature 边
   *    - BM25 文本索引
   * 4. 标记原始消息为已总结
   */
  async processBatch(agentId: string): Promise<void> {
    const messages = await this.socialMessageRepo.getUnsummarized(agentId, this.config.batchLimit)

    if (messages.length === 0) {
      logger.debug(`[${agentId}] 无未总结社交消息`)
      return
    }

    logger.info(`[${agentId}] 开始炼化 ${messages.length} 条社交消息`)

    // 格式化对话上下文
    const chatText = messages.map((m) => `${m.senderName ?? '未知'}: ${m.content}`).join('\n')

    const channelType = messages[0]?.channelType ?? 'group'
    const channelId = messages[0]?.channelId ?? '未知'
    const sessionName = channelType === 'private' ? '私聊' : `群${channelId}`

    // 获取反思模型配置
    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      logger.warn('未配置反思模型，跳过社交记忆炼化')
      return
    }

    try {
      // 用户称呼：取该 Agent 的 agent.json owner_appellation（兜底"主人"），注入模板生成带称呼的示例/摘要
      const ownerAppellation = this.agentManager?.getOwnerAppellation(agentId) ?? '主人'
      // 渲染 MDP 模板（AIOS 第八阶段：模板已迁移到 apps/social/prompts/）
      const prompt = this.mdpEngine.render('apps/social/tasks/social_segment_summarizer', {
        session_type: channelType,
        session_name: sessionName,
        chat_text: chatText,
        agent_name: agentId,
        owner_appellation: ownerAppellation,
      })

      // LLM 调用
      const result = await this.callLlmWithRetry(modelConfig, prompt)

      if (!result?.new_event?.summary) {
        logger.warn(`[${agentId}] LLM 未返回有效事件`)
        await this.socialMessageRepo.markSummarized(messages.map((m) => m.id))
        return
      }

      // 写入图谱
      const store = this.storeRegistry.getAgentStore(agentId, 'social')
      await this.writeToGraph(store, result, agentId)

      // 标记原始消息已总结
      await this.socialMessageRepo.markSummarized(messages.map((m) => m.id))

      logger.info(
        `[${agentId}] 社交图谱已更新: ` +
          `"${result.new_event.summary.slice(0, 50)}" | ` +
          `features: [${result.new_event.features.join(', ')}] | ` +
          `ontology: ${result.ontology_updates?.length ?? 0} 条边`,
      )
    } catch (err) {
      logger.error(`[${agentId}] 社交记忆炼化失败: ${err}`)
    }
  }

  // ── 图谱写入 ──

  /**
   * 将 PEDSA 格式的 LLM 输出写入 TriviumDB (social.tdb)
   */
  private async writeToGraph(
    store: TriviumDB,
    output: SocialScorerOutput,
    agentId: string,
  ): Promise<void> {
    const { new_event, ontology_updates } = output

    // 1. 写入 Event 节点
    const eventId = nextEventId()
    store.insertWithId(eventId, this.zeroVector, {
      type: 'event',
      content: new_event.summary,
      agentId,
      timestamp: Math.floor(Date.now() / 1000),
      features: new_event.features,
    })

    // BM25 文本索引
    store.indexText(eventId, new_event.summary)

    // 2. 注册 Feature 节点 + 建 Feature→Event 边
    for (const keyword of new_event.features) {
      const featureId = this.getOrCreateFeature(store, keyword)
      if (featureId < 0) continue // 停用词跳过

      // Feature → Event 边
      store.link(featureId, eventId, 'memory_edge', 1.0)
    }

    // 3. 写入本体关联 (Feature → Feature)
    if (ontology_updates?.length) {
      for (const update of ontology_updates) {
        const srcId = this.getOrCreateFeature(store, update.source)
        const tgtId = this.getOrCreateFeature(store, update.target)
        if (srcId < 0 || tgtId < 0) continue

        const strength = Math.max(0.1, Math.min(1.0, update.strength ?? 0.5))
        store.link(srcId, tgtId, update.relation ?? 'representation', strength)

        // equality 是双向的
        if (update.relation === 'equality') {
          store.link(tgtId, srcId, 'equality', 1.0)
        }
      }
    }

    // 4. 重编译 BM25 索引 (使 searchHybrid 生效)
    store.buildTextIndex()
  }

  /**
   * 获取或创建 Feature 节点
   *
   * 使用 FNV-1a 哈希生成确定性 ID:
   * 同一关键词始终映射到同一节点 → 自动聚合多次出现的关键词。
   */
  private getOrCreateFeature(store: TriviumDB, keyword: string): number {
    const normalized = keyword.toLowerCase().trim()
    if (normalized.length < 2) return -1 // 太短的词跳过

    const featureId = fnv1aHash(normalized)
    const existing = store.get(featureId)

    if (!existing) {
      // 首次出现：创建 Feature 节点
      store.insertWithId(featureId, this.zeroVector, {
        type: 'feature',
        content: normalized,
      })
      // AC 自动机关键词索引
      store.indexKeyword(featureId, normalized)
    }

    return featureId
  }

  // ── LLM 调用 ──

  /**
   * LLM 调用 (带重试)
   */
  private async callLlmWithRetry(
    modelConfig: ModelConfig,
    prompt: string,
  ): Promise<SocialScorerOutput | null> {
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.llmService.chat(
          modelConfig,
          [{ role: 'user', content: prompt }],
          {
            responseFormat: { type: 'json_object' },
          },
        )

        const rawContent = response.choices?.[0]?.message?.content ?? ''
        const parsed = parseLlmJson<SocialScorerOutput>(rawContent)

        if (parsed?.new_event?.summary) return parsed

        logger.warn(`[尝试 ${attempt + 1}] LLM 返回无效 JSON，重试`)
      } catch (err) {
        if (attempt < this.config.maxRetries - 1) {
          logger.warn(`[尝试 ${attempt + 1}] LLM 调用失败: ${err}，2 秒后重试`)
          await new Promise((r) => setTimeout(r, 2000))
        } else {
          throw err
        }
      }
    }
    return null
  }
}
