import { createHash } from 'node:crypto'
import type {
  PanelSurfaceProps,
  SurfaceId,
  SurfaceNodeId,
  SurfaceProjectionSnapshot,
  TableSurfaceProps,
} from '@infos/shared'
import type { AgentStateRepository } from './agentStateRepository'

export async function projectAgentStateSurface(
  repository: AgentStateRepository,
  agentId: string,
): Promise<SurfaceProjectionSnapshot> {
  const [aggregate, measurements] = await Promise.all([
    repository.aggregate(agentId),
    repository.latest(agentId, 100),
  ])
  const generation = createHash('sha256')
    .update(JSON.stringify({ aggregate, measurements }))
    .digest('hex')
  return {
    protocolVersion: 1,
    scopeId: `observer:${agentId}`,
    principalId: agentId,
    revision: 1,
    generatedAt: new Date().toISOString(),
    surfaces: [
      {
        surfaceId: `observer-state:${agentId}` as SurfaceId,
        generation,
        threadId: `observer:${agentId}`,
        principalId: agentId,
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [
          {
            nodeId: `observer-state:${agentId}:summary` as SurfaceNodeId,
            kind: 'panel',
            lifecycle: 'stable',
            revision: 1,
            props: {
              title: 'Agent State',
              subtitle: '可删除的派生测量，不是人格事实',
              fields: Object.entries(aggregate).map(([metric, value]) => ({
                key: metric,
                label: metric,
                value: `${value.value.toFixed(3)} (${value.samples})`,
              })),
            } satisfies PanelSurfaceProps,
          },
          {
            nodeId: `observer-state:${agentId}:audit` as SurfaceNodeId,
            kind: 'table',
            lifecycle: 'stable',
            revision: 1,
            props: {
              columns: [
                { key: 'metric', label: '指标' },
                { key: 'value', label: '值' },
                { key: 'confidence', label: '置信度' },
                { key: 'source', label: '来源事件' },
                { key: 'observedAt', label: '观测时间' },
              ],
              rows: measurements.map((item) => ({
                metric: item.metric,
                value: item.value,
                confidence: item.confidence,
                source: item.sourceEventType,
                observedAt: item.observedAt,
              })),
            } satisfies TableSurfaceProps,
          },
        ],
      },
    ],
  }
}
