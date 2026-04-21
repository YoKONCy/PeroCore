/**
 * Memory Enricher — 记忆检索注入
 *
 * 执行 RAG 向量检索 + 图谱闪回，注入 EnrichedContext。
 *
 * 增强功能:
 * - 加权向量融合: user(0.5) + assistant(0.35) + tool(0.15)
 * - 图谱闪回: 沿时间链展开关联思绪
 * - 检索访问强化: 命中后自动 markAccessed
 * - Entity 节点过滤: 排除 type='entity' 的结构节点
 *
 * 统一记忆上下文增强与图谱闪回。
 *
 * @module packages/backend/src/services/pipeline/enrichers/memoryEnricher
 */

import type { Enricher, EnrichmentInput, EnrichedContext, ChatMessage } from '../types'
import type { MemorySearchService, MemorySearchResult } from '../../memory/memorySearch'
import type { MemoryService } from '../../memory/memoryService'
import type { EmbeddingProvider } from '../../embedding/embeddingService'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('MemoryEnricher')

/** 扩展输入: 支持从 pipeline 传入完整消息列表 (用于加权向量融合) */
export interface MemoryEnrichmentInput extends EnrichmentInput {
  /** 当前对话的完整消息列表 (用于多角色加权向量融合) */
  recentMessages?: ChatMessage[]
}

export class MemoryEnricher implements Enricher {
  readonly name = 'MemoryEnricher'

  constructor(
    private searchService: MemorySearchService,
    private memoryService: MemoryService,
    private embeddingService: EmbeddingProvider,
    private topK = 10,
  ) {}

  async enrich(input: MemoryEnrichmentInput): Promise<Partial<EnrichedContext>> {
    const { userText, agentId, source } = input

    if (!userText) {
      return { memoryContext: '', graphContext: '' }
    }

    try {
      // ── 1. 加权向量融合 ──
      const queryOverride = await this.buildWeightedQuery(input)

      // ── 2. RAG 向量检索 ──
      let results = await this.searchService.search({
        query: queryOverride ?? userText,
        agentId,
        source,
        topK: this.topK,
      })

      // ── 3. Entity 节点过滤 ──
      results = results.filter((r) => r.type !== 'entity')

      // ── 4. 检索访问强化 ──
      await this.markAccessed(results)

      // ── 5. 格式化检索结果 ──
      const memoryContext = this.formatResults(results)

      // ── 6. 图谱闪回 ──
      const graphContext = await this.buildGraphFlashback(results, agentId)

      return { memoryContext, graphContext }
    } catch (err) {
      logger.warn('记忆检索失败', { error: err })
      return { memoryContext: '', graphContext: '' }
    }
  }

  /**
   * 加权向量融合
   *
   * 从最近消息中提取 user/assistant/tool 三个角色的最后一条消息，
   * 分别编码后按 0.5:0.35:0.15 加权合成查询向量。
   *
   * 比单纯用 userText 检索能更准确地捕捉对话上下文。
   */
  private async buildWeightedQuery(input: MemoryEnrichmentInput): Promise<string | null> {
    const { recentMessages } = input
    if (!recentMessages || recentMessages.length < 2) return null

    // 从最近消息中提取各角色的最后一条
    let lastUser = ''
    let lastAssistant = ''
    let lastTool = ''

    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i]!
      const content = typeof msg.content === 'string' ? msg.content : ''
      if (!content) continue

      const cleaned = this.purifyContent(content)
      if (!cleaned) continue

      if (msg.role === 'user' && !lastUser) lastUser = cleaned
      else if (msg.role === 'assistant' && !lastAssistant) lastAssistant = cleaned
      else if (msg.role === 'tool' && !lastTool) lastTool = cleaned

      if (lastUser && lastAssistant && lastTool) break
    }

    // 至少需要两个角色的消息才值得融合
    const parts: Array<{ text: string; weight: number }> = []
    if (lastUser) parts.push({ text: lastUser, weight: 0.5 })
    if (lastAssistant) parts.push({ text: lastAssistant, weight: 0.35 })
    if (lastTool) parts.push({ text: lastTool, weight: 0.15 })

    if (parts.length < 2) return null

    // 编码各部分
    const embeddings: Array<{ vec: number[]; weight: number }> = []
    for (const part of parts) {
      const vec = await this.embeddingService.embedOne(part.text)
      if (vec.length > 0) {
        embeddings.push({ vec, weight: part.weight })
      }
    }

    if (embeddings.length < 2) return null

    // 加权融合
    const totalWeight = embeddings.reduce((s, e) => s + e.weight, 0)
    const dim = embeddings[0]!.vec.length
    const merged = new Array<number>(dim).fill(0)

    for (const { vec, weight } of embeddings) {
      const normalizedWeight = weight / totalWeight
      for (let d = 0; d < dim; d++) {
        merged[d]! += vec[d]! * normalizedWeight
      }
    }

    // 将融合向量传递给 searchService — 目前 search 接口只接受 query text，
    // 所以我们构造一个包含多角色上下文的合成文本作为替代方案
    // (当 PEDSA 的 ContextualRetriever 完全替代 MemorySearchService 时，
    //  可以直接传递融合向量)
    const contextParts: string[] = []
    if (lastUser) contextParts.push(lastUser)
    if (lastAssistant) contextParts.push(lastAssistant.slice(0, 200))
    if (lastTool) contextParts.push(lastTool.slice(0, 100))
    return contextParts.join(' ')
  }

  /**
   * 清理内容文本
   *
   * 移除 base64 图片、XML 标签等噪声数据。
   */
  private purifyContent(text: string): string {
    if (!text) return ''
    // 移除 base64 图片数据
    let cleaned = text.replace(/data:image\/[^;]+;base64,[^"'\s>]+/g, '[IMAGE]')
    // 移除 XML 包裹的大块内容
    cleaned = cleaned.replace(/<([A-Z_]+)>[\s\S]*?<\/\1>/g, '')
    // 移除 HTML 标签
    cleaned = cleaned.replace(/<[^>]+>/g, '')
    // 移除 RAG 注释块
    cleaned = cleaned.replace(
      /<!-- PERO_RAG_BLOCK_START[\s\S]*?-->[\s\S]*?<!-- PERO_RAG_BLOCK_END -->/g,
      '',
    )
    // 移除 Thinking/Monologue
    cleaned = cleaned.replace(/【\s*(?:Thinking|Monologue)\s*:[\s\S]*?】/g, '')
    return cleaned.slice(0, 2000).trim()
  }

  /**
   * 检索后自动标记访问
   *
   * 增加访问计数，形成正反馈循环：被频繁检索的记忆会逐渐提升重要性。
   */
  private async markAccessed(results: MemorySearchResult[]): Promise<void> {
    // 并行标记，不阻塞主流程
    const markPromises = results.map((r) =>
      this.memoryService.markAccessed(r.id).catch((err) => {
        logger.debug(`标记访问失败: id=${r.id}, ${err}`)
      }),
    )
    await Promise.all(markPromises)
  }

  /**
   * 图谱闪回
   *
   * 对检索命中的 top-3 记忆执行时间链闪回，
   * 沿 prevId/nextId 展开前后文作为关联思绪注入。
   */
  private async buildGraphFlashback(
    results: MemorySearchResult[],
    agentId: string,
  ): Promise<string> {
    if (results.length === 0) return ''

    try {
      // 对 top-3 记忆做闪回
      const anchors = results.slice(0, 3)
      const flashbackResults: MemorySearchResult[] = []

      for (const anchor of anchors) {
        const fbResults = await this.searchService.flashback(anchor.id, agentId, 2)
        flashbackResults.push(...fbResults)
      }

      if (flashbackResults.length === 0) return ''

      // 去重 (排除已命中的记忆)
      const hitIds = new Set(results.map((r) => r.id))
      const unique = flashbackResults.filter((r) => !hitIds.has(r.id))

      if (unique.length === 0) return ''

      // 格式化为关联思绪
      const fragments = unique
        .slice(0, 5) // 最多 5 个碎片
        .map((r) => r.content.slice(0, 60))
      return `关联思绪: ${fragments.join(', ')}`
    } catch (err) {
      logger.debug(`图谱闪回失败: ${err}`)
      return ''
    }
  }

  /** 格式化记忆检索结果为注入文本 */
  private formatResults(
    results: Array<{
      id: number
      content: string
      score: number
      importance: number
      type: string
    }>,
  ): string {
    if (results.length === 0) {
      return '<!-- 未检索到相关记忆 -->'
    }

    const lines: string[] = ['<memory_context>']
    for (const r of results) {
      lines.push(
        `<memory id="${r.id}" type="${r.type}" importance="${r.importance}" score="${r.score.toFixed(3)}">` +
          r.content +
          '</memory>',
      )
    }
    lines.push('</memory_context>')
    return lines.join('\n')
  }
}
