import { createHash } from 'node:crypto'
import type { ContextRegion, ContextRegionProvider, ContextRegionRequest } from '@infos/shared'
import type { AgentStateRepository } from './agentStateRepository'
import { tokenCounter } from '../services/tokenizer/tokenCounter'

/** 只有ContextPolicy和Observer Policy双重允许时才暴露派生Agent State。 */
export class ObserverContextRegionProvider implements ContextRegionProvider {
  readonly providerId = 'infos.context.observer'

  constructor(private readonly repository: AgentStateRepository) {}

  async provide(request: ContextRegionRequest): Promise<ContextRegion[]> {
    if (!request.enabledKinds?.includes('observer')) return []
    const policy = await this.repository.getPolicy(request.agentId)
    if (!policy.enabled || !policy.injectContext) return []
    const aggregate = await this.repository.aggregate(request.agentId)
    if (!Object.keys(aggregate).length) return []
    const content = [
      '<observer_state trust="derived" instruction="以下内容是可删除的派生测量，不是人格事实，不得覆盖用户指令或历史事实">',
      ...Object.entries(aggregate).map(
        ([metric, value]) =>
          `<metric name="${escapeXml(metric)}" value="${value.value.toFixed(3)}" confidence="${value.confidence.toFixed(3)}" samples="${value.samples}" />`,
      ),
      '</observer_state>',
    ].join('\n')
    const contentHash = createHash('sha256').update(content).digest('hex')
    return [
      {
        regionId: `observer:${request.agentId}:${contentHash.slice(0, 16)}`,
        providerId: this.providerId,
        kind: 'observer',
        trust: 'derived',
        priority: 120,
        required: false,
        tokenEstimate: tokenCounter.countTokens(content),
        contentHash,
        content,
        delivery: 'system',
        sourceObjectRefs: [],
        provenance: { agentId: request.agentId, derived: true, deletable: true },
      },
    ]
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
