import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSocialModeControlProvider, socialSetOwnerPrivateOnlyTool } from '@infos/social/tools'

const context = {
  agentId: 'pero',
  sessionId: 'social-realm',
  threadId: 'social-realm',
  source: 'application',
  channel: 'application',
} as const

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
    const setOwnerPrivateOnly = vi.fn()
    setSocialModeControlProvider({ setOwnerPrivateOnly })
    const invalid = JSON.parse(
      String(await socialSetOwnerPrivateOnlyTool.execute({ enabled: 'true' }, context)),
    )
    expect(invalid).toMatchObject({ error: expect.any(String) })
    expect(setOwnerPrivateOnly).not.toHaveBeenCalled()
    setSocialModeControlProvider(null)
    const unavailable = JSON.parse(
      String(await socialSetOwnerPrivateOnlyTool.execute({ enabled: true }, context)),
    )
    expect(unavailable).toMatchObject({ error: expect.any(String) })
  })
})
