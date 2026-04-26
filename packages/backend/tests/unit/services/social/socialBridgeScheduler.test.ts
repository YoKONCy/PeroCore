import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialBridge } from '@perocore/backend/services/social/socialBridge'
import { SocialScheduler } from '@perocore/backend/services/social/socialScheduler'
import type { InboundMessage } from '@perocore/backend/services/social/types'

class FakeAdapter extends EventEmitter {
  platform = 'napcat'
  connect = vi.fn(() => Promise.resolve())
  disconnect = vi.fn(() => Promise.resolve())
  sendMessage = vi.fn(() => Promise.resolve())
  getStatus = vi.fn(() => Promise.resolve({ platform: 'napcat', connected: true }))
  getContacts = vi.fn(() => Promise.resolve([{ id: 'u1' }]))
  getGroups = vi.fn(() => Promise.resolve([{ id: 'g1' }]))
  getContactInfo = vi.fn((userId: string) => Promise.resolve({ userId }))
  getGroupInfo = vi.fn((groupId: string) => Promise.resolve({ groupId }))
  getGroupMembers = vi.fn((groupId: string) => Promise.resolve([{ groupId, userId: 'u1' }]))
  handleFriendRequest = vi.fn(() => Promise.resolve())
  removeFriend = vi.fn(() => Promise.resolve())
}

function createInbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'napcat',
    channelId: 'group-1',
    channelType: 'group',
    senderId: 'u1',
    senderName: '主人',
    content: '你好',
    agentId: 'pero',
    rawEvent: { message_id: 123 },
    ...overrides,
  }
}

function createBridge(overrides: Record<string, unknown> = {}) {
  const deps = {
    agentService: { chat: vi.fn(() => Promise.resolve('好的主人')) },
    gatewayHub: { broadcast: vi.fn(() => Promise.resolve()) },
    llmService: { chat: vi.fn() },
    getThinkingModel: vi.fn(() =>
      Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
    ),
    socialMessageRepo: {
      insert: vi.fn(() => Promise.resolve()),
      getRecentChannels: vi.fn(() => Promise.resolve([])),
    },
    mdpEngine: { render: vi.fn(() => 'prompt') },
    imageCacheManager: { download: vi.fn(() => Promise.resolve('local-image.png')) },
    stickerService: null,
    ...overrides,
  }
  return { bridge: new SocialBridge(deps as never), deps }
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'napcat',
    channelId: 'group-1',
    channelType: 'group',
    agentId: 'pero',
    state: 'observing',
    buffer: [
      createInbound({ content: '第一条' }),
      createInbound({ content: '第二条' }),
      createInbound({ content: '第三条' }),
    ],
    lastMessageAt: Date.now(),
    nextScanTime: 0,
    ...overrides,
  }
}

describe('SocialBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当注册、替换、启动和停止社交适配器', async () => {
    const { bridge, deps } = createBridge()
    const first = new FakeAdapter()
    const second = new FakeAdapter()

    bridge.registerAdapter(first as never)
    bridge.registerAdapter(second as never)
    await bridge.start()
    await bridge.stop()

    expect(bridge.getAdapter('napcat')).toBe(second)
    expect(first.listenerCount('message')).toBe(0)
    expect(second.connect).toHaveBeenCalled()
    expect(second.disconnect).toHaveBeenCalled()
    expect(deps.socialMessageRepo.getRecentChannels).toHaveBeenCalledWith('', 20)
  })

  it('应当持久化入站消息、下载图片并通知前端', async () => {
    const { bridge, deps } = createBridge()
    const adapter = new FakeAdapter()
    const inbound = createInbound({
      attachments: [{ type: 'image', url: 'https://example.com/a.png' }],
    })
    bridge.registerAdapter(adapter as never)
    await bridge.start()

    adapter.emit('message', inbound)
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.socialMessageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ msgId: '123', content: '你好' }),
    )
    expect(deps.imageCacheManager.download).toHaveBeenCalledWith('https://example.com/a.png')
    expect(deps.gatewayHub.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'push',
        payload: expect.objectContaining({ action: 'social_message', direction: 'inbound' }),
      }),
    )
    expect(inbound.attachments![0]!.localPath).toBe('local-image.png')
  })

  it('应当执行 AI 回复、发送消息、持久化并桥接工具 Provider', async () => {
    const { bridge, deps } = createBridge()
    const adapter = new FakeAdapter()
    bridge.registerAdapter(adapter as never)
    const session = createSession({ buffer: [] })
    const messages = [createInbound({ content: '第一条' }), createInbound({ content: '第二条' })]

    await (
      bridge as unknown as {
        executeReply: (session: unknown, messages: InboundMessage[]) => Promise<void>
      }
    ).executeReply(session, messages)
    const provider = bridge.createMessagingProvider()!
    await provider.sendMessage('group-2', '工具消息', 'group')
    await provider.notifyOwner('提醒主人', 'high')

    expect(deps.agentService.chat).toHaveBeenCalledWith({
      agentId: 'pero',
      source: 'social',
      sessionId: 'social_napcat_group-1',
      messages: [{ role: 'user', content: '[主人]: 第一条\n[主人]: 第二条' }],
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'group-1',
      channelType: 'group',
      content: '好的主人',
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'group-2',
      channelType: 'group',
      content: '工具消息',
    })
    expect(deps.socialMessageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'self', content: '好的主人' }),
    )
    expect(provider.platform).toBe('napcat')
    expect(deps.gatewayHub.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'social_owner_notification',
          importance: 'high',
        }),
      }),
    )
  })

  it('应当在适配器缺失或状态读取失败时安全降级', async () => {
    const { bridge } = createBridge()
    const bad = new FakeAdapter()
    bad.getStatus.mockRejectedValueOnce(new Error('失败'))
    bridge.registerAdapter(bad as never)

    await expect(
      bridge.sendReply('missing', { channelId: 'g1', channelType: 'group', content: '消息' }),
    ).resolves.toBeUndefined()
    await expect(bridge.getAllStatus()).resolves.toEqual([
      { platform: 'napcat', connected: false, error: '获取状态失败' },
    ])
    bridge.unregisterAdapter('napcat')
    expect(bridge.hasActiveAdapter()).toBe(false)
    expect(bridge.createMessagingProvider()).toBeNull()
  })
})

describe('SocialScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createScheduler(
    sessions: ReturnType<typeof createSession>[],
    overrides: Record<string, unknown> = {},
  ) {
    const deps = {
      sessionManager: {
        getActiveSessions: vi.fn((type?: string) =>
          sessions.filter((session) => !type || session.channelType === type),
        ),
        checkActiveExpiry: vi.fn(),
      },
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    shouldReply: true,
                    reason: '应该加入',
                    style: 'brief',
                  }),
                },
              },
            ],
          }),
        ),
      },
      mdpEngine: { render: vi.fn((key: string) => `prompt:${key}`) },
      getThinkingModel: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      onDecideReply: vi.fn(() => Promise.resolve()),
      ...overrides,
    }
    const scheduler = new SocialScheduler(deps as never, {
      minMessagesForReview: 3,
      nightSilenceStart: 0,
      nightSilenceEnd: 1,
    })
    return { scheduler, deps }
  }

  it('应当启动停止扫描循环并避免重复启动', () => {
    const { scheduler } = createScheduler([])

    scheduler.start()
    scheduler.start()
    scheduler.stop()

    expect((scheduler as unknown as { running: boolean }).running).toBe(false)
  })

  it('应当在群聊缓冲足够时调用思考状态机并触发回复', async () => {
    const session = createSession({ channelType: 'group', state: 'observing' })
    const { scheduler, deps } = createScheduler([session])
    ;(scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0

    await (scheduler as unknown as { scanGroupSessions: () => Promise<void> }).scanGroupSessions()

    expect(deps.llmService.chat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      { temperature: 0.3 },
    )
    expect(deps.onDecideReply).toHaveBeenCalledWith(
      session,
      expect.arrayContaining([expect.objectContaining({ content: '第一条' })]),
    )
    expect(session.buffer).toEqual([])
  })

  it('应当处理群聊无会话、缓冲不足、无模型和解析失败分支', async () => {
    const noSession = createScheduler([])
    ;(noSession.scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0
    await (
      noSession.scheduler as unknown as { scanGroupSessions: () => Promise<void> }
    ).scanGroupSessions()

    const smallSession = createSession({ buffer: [createInbound()] })
    const small = createScheduler([smallSession])
    ;(small.scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0
    await (
      small.scheduler as unknown as { scanGroupSessions: () => Promise<void> }
    ).scanGroupSessions()

    const noModelSession = createSession()
    const noModel = createScheduler([noModelSession], {
      getThinkingModel: vi.fn(() => Promise.resolve(null)),
    })
    ;(noModel.scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0
    await (
      noModel.scheduler as unknown as { scanGroupSessions: () => Promise<void> }
    ).scanGroupSessions()

    const invalidSession = createSession()
    const invalid = createScheduler([invalidSession], {
      llmService: {
        chat: vi.fn(() => Promise.resolve({ choices: [{ message: { content: 'not json' } }] })),
      },
    })
    ;(invalid.scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0
    await (
      invalid.scheduler as unknown as { scanGroupSessions: () => Promise<void> }
    ).scanGroupSessions()

    expect(noSession.deps.sessionManager.getActiveSessions).toHaveBeenCalledWith('group', 5)
    expect(small.deps.onDecideReply).not.toHaveBeenCalled()
    expect(noModel.deps.onDecideReply).not.toHaveBeenCalled()
    expect(invalid.deps.onDecideReply).not.toHaveBeenCalled()
  })

  it('应当扫描私聊会话并按状态更新下一次扫描时间', async () => {
    const active = createSession({
      channelId: 'p1',
      channelType: 'private',
      state: 'active',
      buffer: [createInbound()],
    })
    const empty = createSession({
      channelId: 'p2',
      channelType: 'private',
      state: 'observing',
      buffer: [],
    })
    const pending = createSession({
      channelId: 'p3',
      channelType: 'private',
      state: 'observing',
      buffer: [createInbound()],
    })
    const { scheduler, deps } = createScheduler([active, empty, pending])

    await (
      scheduler as unknown as { scanPrivateSessions: () => Promise<void> }
    ).scanPrivateSessions()

    expect(active.nextScanTime).toBe(Date.now() + 60_000)
    expect(empty.nextScanTime).toBeGreaterThan(Date.now() + 14_000_000)
    expect(pending.buffer).toEqual([])
    expect(deps.onDecideReply).toHaveBeenCalledWith(
      pending,
      expect.arrayContaining([expect.objectContaining({ content: '你好' })]),
    )
  })

  it('应当在夜间静音时跳过扫描', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'))
    const session = createSession()
    const { scheduler, deps } = createScheduler([session])
    ;(
      scheduler as unknown as {
        config: { nightSilenceStart: number; nightSilenceEnd: number }
        nextGroupThoughtTime: number
      }
    ).config = {
      nightSilenceStart: 0,
      nightSilenceEnd: 23,
    }
    ;(scheduler as unknown as { nextGroupThoughtTime: number }).nextGroupThoughtTime = 0

    await (scheduler as unknown as { scanGroupSessions: () => Promise<void> }).scanGroupSessions()
    await (
      scheduler as unknown as { scanPrivateSessions: () => Promise<void> }
    ).scanPrivateSessions()

    expect(deps.sessionManager.getActiveSessions).not.toHaveBeenCalled()
  })
})
