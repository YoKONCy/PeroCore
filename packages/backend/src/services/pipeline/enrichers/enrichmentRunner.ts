/**
 * Enrichment Runner — 并行上下文注入
 *
 * 并行执行所有注册的 Enricher，合并结果。
 * 替代 v1 的 HistoryPreprocessor + MemoryPreprocessor + StatePreprocessor。
 *
 * @module packages/backend/src/services/pipeline/enrichers/enrichmentRunner
 */

import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('EnrichmentRunner')

/** 默认 EnrichedContext (所有字段初始化) */
function createDefaultContext(): EnrichedContext {
  return {
    flattenedDesktopHistory: '',
    flattenedGroupHistory: '',
    memoryContext: '',
    graphContext: '',
    weeklyReportContext: '',
    currentTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    mood: 'happy',
    vibe: 'active',
    mind: '...',
    ownerName: '主人',
    userPersona: '未设定',
    enableVision: false,
    enableVoice: false,
  }
}

/**
 * 并行执行所有 Enricher
 *
 * 每个 Enricher 返回 Partial<EnrichedContext>，
 * Runner 合并后返回完整的 EnrichedContext。
 *
 * 单个 Enricher 超时不阻断整体流程。
 */
export async function runEnrichment(
  enrichers: Enricher[],
  input: EnrichmentInput,
  timeoutMs = 5000,
): Promise<EnrichedContext> {
  const base = createDefaultContext()

  if (enrichers.length === 0) {
    return base
  }

  // 并行执行 (附超时保护)
  const results = await Promise.allSettled(
    enrichers.map((e) =>
      Promise.race([
        e.enrich(input),
        new Promise<Partial<EnrichedContext>>((_, reject) =>
          setTimeout(() => reject(new Error(`Enricher ${e.name} 超时`)), timeoutMs),
        ),
      ]),
    ),
  )

  // 合并结果
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    const enricher = enrichers[i]!
    if (result.status === 'fulfilled') {
      Object.assign(base, result.value)
      logger.debug(`Enricher ${enricher.name} 完成`)
    } else {
      logger.warn(`Enricher ${enricher.name} 失败: ${result.reason}`)
    }
  }

  return base
}
