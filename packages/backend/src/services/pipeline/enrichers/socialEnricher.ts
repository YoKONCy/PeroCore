/**
 * Social Enricher — 社交模式上下文注入
 *
 * 双重上下文注入:
 * 1. socialContext: 同一会话最近 N 条消息 (短期 session 视野)
 * 2. socialMemoryContext: 从 social.tdb 图谱检索跨会话记忆 (长期记忆)
 *
 * 社交图谱检索走 PEDSA 理性轨道 (RAG-less):
 * - BM25 文本匹配 + AC 自动机关键词激活
 * - 图谱扩散 (Feature→Event 边)
 * - 零向量、零 Embedding 开销
 *
 * 门控: 仅在 source='social' 或 source='group_chat' 时激活。
 *
 * @module packages/backend/src/services/pipeline/enrichers/socialEnricher
 */

import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import type { SocialMessageRepository } from '../../../repositories/socialMessage.repo'
import type { MemoryStoreRegistry } from '../../../repositories/storeRegistry'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('SocialEnricher')

/** 零向量 (social.tdb 不使用向量检索) */
const ZERO_VEC_1536 = new Array(1536).fill(0)

export class SocialEnricher implements Enricher {
  readonly name = 'SocialEnricher'

  constructor(
    private socialMessageRepo: SocialMessageRepository,
    private storeRegistry: MemoryStoreRegistry,
    private contextWindowSize = 30,
    private memoryTopK = 5,
  ) {}

  async enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>> {
    // 门控: 仅社交/群聊来源时注入
    if (input.source !== 'social' && input.source !== 'group_chat') {
      return { socialContext: '', socialMemoryContext: '' }
    }

    // 从 sessionId 提取 channelId
    // sessionId 格式: social_qq_123456
    const parts = input.sessionId.split('_')
    const channelId = parts.length >= 3 ? parts.slice(2).join('_') : input.sessionId

    // 并行执行: 短期上下文 + 长期图谱检索
    const [socialContext, socialMemoryContext] = await Promise.all([
      this.buildSessionContext(channelId),
      this.buildMemoryContext(input.agentId, input.userText),
    ])

    return { socialContext, socialMemoryContext }
  }

  // ── 短期: 同会话最近消息 ──

  private async buildSessionContext(channelId: string): Promise<string> {
    try {
      const recent = await this.socialMessageRepo.getRecent(
        channelId,
        'group',
        this.contextWindowSize,
      )

      if (recent.length === 0) return ''

      const lines = recent.map((msg) => {
        const sender = msg.senderId === 'self' ? '你' : (msg.senderName ?? `User${msg.senderId}`)
        return `[${sender}]: ${msg.content}`
      })

      return [
        `<SOCIAL_CONTEXT channel="${channelId}" count="${recent.length}">`,
        ...lines,
        '</SOCIAL_CONTEXT>',
      ].join('\n')
    } catch (err) {
      return `<!-- 社交上下文加载失败: ${err} -->`
    }
  }

  // ── 长期: social.tdb 图谱检索 (PEDSA 理性轨道) ──

  /**
   * 从 social.tdb 检索跨会话记忆
   *
   * 使用 TriviumDB searchHybrid:
   * - 零向量 (不走向量通道)
   * - BM25 文本匹配 + AC 自动机关键词激活
   * - 图谱扩散 (Feature→Event 边) expand_depth=2
   */
  private async buildMemoryContext(agentId: string, userText: string): Promise<string> {
    try {
      const store = this.storeRegistry.getAgentStore(agentId, 'social')

      // 检查 social.tdb 是否有内容
      if (store.nodeCount() === 0) return ''

      // searchHybrid: 零向量 + 纯文本检索
      const hits = store.searchHybrid(
        ZERO_VEC_1536,
        userText,
        this.memoryTopK,
        2, // expand_depth: 图谱扩散 2 跳
        0.1, // min_score: 低阈值 (BM25 分数通常较低)
      )

      if (!hits || hits.length === 0) return ''

      // 仅取 event 类型节点 (跳过 feature 节点)
      const eventHits = hits.filter((h) => {
        const payload = h.payload as Record<string, unknown> | undefined
        return payload?.type === 'event'
      })

      if (eventHits.length === 0) return ''

      const lines = eventHits.map((h, i) => {
        const payload = h.payload as Record<string, unknown>
        const content = (payload?.content as string) ?? ''
        return `${i + 1}. ${content}`
      })

      return [`<SOCIAL_MEMORY count="${eventHits.length}">`, ...lines, '</SOCIAL_MEMORY>'].join(
        '\n',
      )
    } catch (err) {
      logger.debug(`社交图谱检索失败 (非致命): ${err}`)
      return ''
    }
  }
}
