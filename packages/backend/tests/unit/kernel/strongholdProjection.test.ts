import { describe, expect, it, vi } from 'vitest'
import { StrongholdProjectionService } from '@infos/backend/projections/strongholdProjectionService'

describe('Stronghold Projection', () => {
  it('应从房间领域事实生成稳定消息 Shell 和 committed Surfaces', async () => {
    const service = new StrongholdProjectionService({
      getRoom: vi.fn(async () => ({ id: 'room-1', name: '大厅' })),
      getRoomMembers: vi.fn(async () => [
        { agentId: 'pero', role: 'member' },
        { agentId: 'user', role: 'owner' },
      ]),
      getHistory: vi.fn(async () => [
        {
          id: 7,
          roomId: 'room-1',
          senderId: 'user',
          content: '你好',
          role: 'user',
          pairId: 'pair-1',
          timestamp: '2026-08-18 00:00:00',
        },
        {
          id: 8,
          roomId: 'room-1',
          senderId: 'pero',
          content: '你好呀',
          role: 'assistant',
          pairId: 'pair-1',
          timestamp: '2026-08-18 00:00:01',
        },
      ]),
    } as never)

    const snapshot = await service.getSnapshot('room-1')
    expect(snapshot.members).toHaveLength(2)
    expect(snapshot.messages[0]).toMatchObject({
      messageId: '7',
      surfaceId: 'stronghold-message:7',
    })
    expect(snapshot.messages[0]?.outputTokens).toBeUndefined()
    expect(snapshot.messages[1]?.outputTokens).toBeGreaterThan(0)
    expect(snapshot.surfaces[0]).toMatchObject({
      surfaceId: 'stronghold-message:7',
      state: 'committed',
      nodes: [{ kind: 'markdown' }],
    })
  })
})
