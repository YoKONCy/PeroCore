import { createHash } from 'node:crypto'
import type {
  PanelSurfaceProps,
  SurfaceId,
  SurfaceNodeId,
  SurfaceProjectionSnapshot,
} from '@infos/shared'

export interface ArcaStatusProjectionInput {
  ownership: string
  hostState: string
  federation: { state: string; lastError?: string }
  managedRuntimeAvailable: boolean
  managedRuntimeReason?: string
  pid?: number
}

export function projectArcaStatusSurface(
  status: ArcaStatusProjectionInput,
): SurfaceProjectionSnapshot {
  const generation = createHash('sha256').update(JSON.stringify(status)).digest('hex')
  return {
    protocolVersion: 1,
    scopeId: 'application:infos.arca',
    principalId: 'system',
    revision: 1,
    generatedAt: new Date().toISOString(),
    surfaces: [
      {
        surfaceId: 'application-status:infos.arca' as SurfaceId,
        generation,
        threadId: 'application:infos.arca',
        principalId: 'system',
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [
          {
            nodeId: 'application-status:infos.arca:panel' as SurfaceNodeId,
            kind: 'panel',
            lifecycle: 'stable',
            revision: 1,
            props: {
              title: 'Arca',
              subtitle: '语义文档工作站',
              fields: [
                { key: 'ownership', label: '宿主归属', value: status.ownership },
                {
                  key: 'hostState',
                  label: 'Host状态',
                  value: status.hostState,
                  tone: status.hostState === 'running' ? 'success' : 'warning',
                },
                {
                  key: 'federation',
                  label: '联邦连接',
                  value: status.federation.state,
                  tone: status.federation.state === 'connected' ? 'success' : 'warning',
                },
                {
                  key: 'runtime',
                  label: '托管Runtime',
                  value: status.managedRuntimeAvailable
                    ? '可用'
                    : (status.managedRuntimeReason ?? '不可用'),
                  tone: status.managedRuntimeAvailable ? 'success' : 'danger',
                },
              ],
            } satisfies PanelSurfaceProps,
          },
        ],
      },
    ],
  }
}
