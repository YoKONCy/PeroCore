import { describe, expect, it, vi } from 'vitest'
import { projectSocialSurface } from '@infos/social/runtime/socialSurfaceProjection'
import { projectArcaStatusSurface } from '@infos/backend/projections/arcaStatusProjection'

describe('跨领域Surface Projection', () => {
  it('Social应从Storage Authority重建概览与联系人Surface', async () => {
    const snapshot = await projectSocialSurface(
      {
        listContactImpressions: vi.fn(async () => [
          {
            id: 1,
            agentId: 'pero',
            platform: 'qq',
            userId: 'u1',
            displayName: '主人',
            identity: 'owner',
            impression: '可靠',
            sourceChannelId: null,
            updatedAt: '2026-01-01',
          },
        ]),
        getRecentChannels: vi.fn(async () => [
          { channelId: 'g1', channelType: 'group', lastTimestamp: '2026-01-01' },
        ]),
      } as never,
      'pero',
    )
    expect(snapshot).toMatchObject({ scopeId: 'social:pero', principalId: 'pero' })
    expect(snapshot.surfaces.map((surface) => surface.surfaceId)).toEqual([
      'social-overview:pero',
      'social-contacts:pero',
    ])
    expect(snapshot.surfaces[1]?.nodes[0]).toMatchObject({ kind: 'table' })
  })

  it('Arca状态应投影为稳定Panel Surface', () => {
    const snapshot = projectArcaStatusSurface({
      ownership: 'managed',
      hostState: 'running',
      federation: { state: 'connected' },
      managedRuntimeAvailable: true,
      pid: 42,
    })
    expect(snapshot.scopeId).toBe('application:infos.arca')
    expect(snapshot.surfaces[0]?.nodes[0]).toMatchObject({
      kind: 'panel',
      props: expect.objectContaining({ title: 'Arca' }),
    })
  })
})
