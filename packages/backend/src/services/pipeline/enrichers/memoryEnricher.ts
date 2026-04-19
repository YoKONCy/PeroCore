/**
 * Memory Enricher — 记忆检索注入
 *
 * 执行 RAG 向量检索 + 图谱闪回，注入 EnrichedContext。
 *
 * 替代 v1 的 MemoryContextPreprocessor + TagCloudPreprocessor。
 *
 * @module packages/backend/src/services/pipeline/enrichers/memoryEnricher
 */

import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import type { MemorySearchService } from '../../memory/memorySearch'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('MemoryEnricher')

export class MemoryEnricher implements Enricher {
  readonly name = 'MemoryEnricher'

  constructor(
    private searchService: MemorySearchService,
    private topK = 10,
  ) {}

  async enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>> {
    const { userText, agentId, source } = input

    if (!userText) {
      return { memoryContext: '', graphContext: '' }
    }

    try {
      // RAG 向量检索
      const results = await this.searchService.search({
        query: userText,
        agentId,
        source,
        topK: this.topK,
      })

      // 格式化检索结果
      const memoryContext = this.formatResults(results)

      // 图谱闪回 (TODO: Phase 3c+ 实装图谱邻居检索)
      const graphContext = ''

      return { memoryContext, graphContext }
    } catch (err) {
      logger.warn('记忆检索失败', { error: err })
      return { memoryContext: '', graphContext: '' }
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
