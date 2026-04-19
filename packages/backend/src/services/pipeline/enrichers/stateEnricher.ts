/**
 * State Enricher — Agent 状态 + 时间注入
 *
 * 读取 PetState + 时间信息注入 EnrichedContext。
 *
 * 替代 v1 的 PetStatePreprocessor + TimeAwarenessPreprocessor。
 *
 * @module packages/backend/src/services/pipeline/enrichers/stateEnricher
 */

import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import type { ConfigRepository } from '../../../repositories/config.repo'

export class StateEnricher implements Enricher {
  readonly name = 'StateEnricher'

  constructor(private configRepo: ConfigRepository) {}

  async enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>> {
    const { agentId } = input

    // 当前时间 (中文友好格式)
    const now = new Date()
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const weekday = weekdays[now.getDay()] ?? '?'
    const currentTime =
      `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
      `星期${weekday} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

    // 从 ConfigRepo 读取 Agent 状态 (PetState)
    const mood = (await this.configRepo.get(`agent.${agentId}.mood`)) ?? 'happy'
    const vibe = (await this.configRepo.get(`agent.${agentId}.vibe`)) ?? 'active'
    const mind = (await this.configRepo.get(`agent.${agentId}.mind`)) ?? '...'
    const ownerName = (await this.configRepo.get('owner.name')) ?? '主人'

    return {
      currentTime,
      mood,
      vibe,
      mind,
      ownerName,
    }
  }
}
