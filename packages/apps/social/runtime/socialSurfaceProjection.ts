/**
 * socialSurfaceProjection — 应用运行时
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { createHash } from 'node:crypto'
import type {
  PanelSurfaceProps,
  SurfaceDescriptor,
  SurfaceId,
  SurfaceNodeId,
  SurfaceProjectionSnapshot,
  TableSurfaceProps,
} from '@infos/shared'
import type { SocialStoragePort } from '@infos/shared'

export async function projectSocialSurface(
  storage: SocialStoragePort,
  agentId: string,
): Promise<SurfaceProjectionSnapshot> {
  const [contacts, channels] = await Promise.all([
    storage.listContactImpressions(agentId),
    storage.getRecentChannels(agentId, 20),
  ])
  const content = JSON.stringify({ contacts, channels })
  const generation = createHash('sha256').update(content).digest('hex')
  const threadId = `social:${agentId}`
  const surfaces: SurfaceDescriptor[] = [
    {
      surfaceId: `social-overview:${agentId}` as SurfaceId,
      generation,
      threadId,
      principalId: agentId,
      revision: 1,
      sequence: 0,
      state: 'committed',
      nodes: [
        {
          nodeId: `social-overview:${agentId}:panel` as SurfaceNodeId,
          kind: 'panel',
          lifecycle: 'stable',
          revision: 1,
          props: {
            title: '社交空间',
            subtitle: '由SocialStorage Authority重建',
            fields: [
              { key: 'contacts', label: '联系人印象', value: String(contacts.length) },
              { key: 'channels', label: '最近会话', value: String(channels.length) },
            ],
          } satisfies PanelSurfaceProps,
        },
      ],
    },
    {
      surfaceId: `social-contacts:${agentId}` as SurfaceId,
      generation,
      threadId,
      principalId: agentId,
      revision: 1,
      sequence: 0,
      state: 'committed',
      nodes: [
        {
          nodeId: `social-contacts:${agentId}:table` as SurfaceNodeId,
          kind: 'table',
          lifecycle: 'stable',
          revision: 1,
          props: {
            columns: [
              { key: 'displayName', label: '联系人' },
              { key: 'identity', label: '身份' },
              { key: 'impression', label: '印象' },
            ],
            rows: contacts.map((contact) => ({
              displayName: contact.displayName || contact.userId,
              identity: contact.identity,
              impression: contact.impression,
            })),
          } satisfies TableSurfaceProps,
        },
      ],
    },
  ]
  return {
    protocolVersion: 1,
    scopeId: `social:${agentId}`,
    principalId: agentId,
    revision: 1,
    generatedAt: new Date().toISOString(),
    surfaces,
  }
}
