import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSocialModeControlProvider, socialSetOwnerPrivateOnlyTool } from '@infos/social/tools'
import { SocialSessionManager } from '@infos/social/runtime/socialSessionManager'
import type { InboundMessage } from '@infos/social/runtime/types'

const context = {
  agentId: 'pero',
  sessionId: 'social-realm',
  threadId: 'social-realm',
  source: 'application',
  channel: 'application',
} as const

function message(
  channelId: string,
  channelType: 'private' | 'group',
  agentId = 'pero',
): InboundMessage {
  return {
    platform: 'qq',
    channelId,
    channelType,
    senderId: channelId,
    senderName: '联系人',
    content: '消息',
    agentId,
    rawEvent: {},
  }
}

describe('仅主人私聊激活工具', () => {
  afterEach(() => setSocialModeControlProvider(null))

  it('按当前角色切换锁定并返回清理数量', async () => {
    const setOwnerPrivateOnly = vi.fn().mockResolvedValue({ enabled: true, closedSessions: 3 })
    setSocialModeControlProvider({ setOwnerPrivateOnly })

    const result = JSON.parse(
      String(await socialSetOwnerPrivateOnlyTool.execute({ enabled: true }, context)),
    ) as Record<string, unknown>

    expect(setOwnerPrivateOnly).toHaveBeenCalledWith('pero', true)
    expect(result).toMatchObject({ success: true, enabled: true, closed_sessions: 3 })
  })

  it('拒绝非布尔参数且 Provider 未初始化时安全失败', async () => {
    setSocialModeControlProvider({ setOwnerPrivateOnly: vi.fn() })
    await expect(
      socialSetOwnerPrivateOnlyTool.execute({ enabled: 'true' }, context),
    ).resolves.toContain('enabled 必须是布尔值')
    setSocialModeControlProvider(null)
    await expect(
      socialSetOwnerPrivateOnlyTool.execute({ enabled: true }, context),
    ).resolves.toContain('社交模式控制服务未初始化')
  })

  it('启用时可立即清理目标角色全部群聊和非主人私聊会话', () => {
    const manager = new SocialSessionManager(vi.fn())
    manager.getOrCreate(message('owner-qq', 'private'))
    manager.getOrCreate(message('stranger-qq', 'private'))
    manager.getOrCreate(message('group-1', 'group'))
    manager.getOrCreate(message('nana-group', 'group', 'nana'))

    const closed = manager.closeSessionsExcept(
      (session) =>
        session.agentId !== 'pero' ||
        (session.channelType === 'private' && session.channelId === 'owner-qq'),
    )

    expect(closed).toBe(2)
    expect(
      manager
        .listSessions()
        .map((session) => `${session.agentId}:${session.channelId}`)
        .sort(),
    ).toEqual(['nana:nana-group', 'pero:owner-qq'])
  })
})
