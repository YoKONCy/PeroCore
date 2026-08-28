import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialBridge } from '@infos/social/runtime/socialBridge'
import type { InboundMessage } from '@infos/social/runtime/types'

class FakeAdapter extends EventEmitter {
  platform = 'napcat'
  connect = vi.fn(() => Promise.resolve())
  disconnect = vi.fn(() => Promise.resolve())
  sendMessage = vi.fn(() => Promise.resolve())
  getStatus = vi.fn(() => Promise.resolve({ platform: 'napcat', connected: true }))
  getConnectedAccountIds = vi.fn(() => [])
  getContacts = vi.fn(() => Promise.resolve([]))
  getGroups = vi.fn(() => Promise.resolve([]))
  getContactInfo = vi.fn(() => Promise.resolve({}))
  getGroupInfo = vi.fn(() => Promise.resolve({}))
  getGroupMembers = vi.fn(() => Promise.resolve([]))
  handleFriendRequest = vi.fn(() => Promise.resolve())
  removeFriend = vi.fn(() => Promise.resolve())
}

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'napcat',
    channelId: 'group-1',
    channelType: 'group',
    senderId: 'u1',
    senderName: '群友',
    content: '你好',
    agentId: 'pero',
    rawEvent: { message_id: 123 },
    ...overrides,
  }
}

function createBridge(overrides: Record<string, unknown> = {}) {
  const deps = {
    generateReply: vi.fn(() => Promise.resolve({ type: 'reply' as const, content: '好的' })),
    socialEvents: { publish: vi.fn(() => Promise.resolve()) },
    socialMessageRepo: {
      insert: vi.fn(() => Promise.resolve()),
      getRecentChannels: vi.fn(() => Promise.resolve([])),
      getRecentChannelsForPlatform: vi.fn(() => Promise.resolve([])),
    },
    ...overrides,
  }
  return { bridge: new SocialBridge(deps as never), deps }
}

describe('SocialBridge 单 Agent 社交链路', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('注册、替换、启动和停止适配器', async () => {
    const { bridge } = createBridge()
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
  })

  it('入站消息先持久化，再进入状态机并发布事件', async () => {
    const { bridge, deps } = createBridge()
    const adapter = new FakeAdapter()
    bridge.registerAdapter(adapter as never)
    await bridge.start()
    adapter.emit('message', inbound())
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.socialMessageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ msgId: '123', content: '你好' }),
    )
    expect(deps.socialEvents.publish).toHaveBeenCalledWith(
      'social_message',
      expect.objectContaining({ direction: 'inbound' }),
    )
  })

  it('唯一角色 Agent 的 reply 结果会发送并持久化', async () => {
    const { bridge, deps } = createBridge()
    const adapter = new FakeAdapter()
    bridge.registerAdapter(adapter as never)
    const session = {
      channelId: 'group-1',
      channelType: 'group',
      agentId: 'pero',
      participation: 'idle',
      phase: 'running',
    }
    const outcome = await (
      bridge as unknown as {
        executeReply: (
          session: unknown,
          messages: InboundMessage[],
          reason: 'proactive_review',
        ) => Promise<unknown>
      }
    ).executeReply(session, [inbound()], 'proactive_review')

    expect(outcome).toEqual({ type: 'reply', content: '好的' })
    expect(deps.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'proactive_review',
        participation: 'idle',
        deferredIntent: undefined,
      }),
    )
    expect(adapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'group-1',
      channelType: 'group',
      content: '好的',
      replyTo: undefined,
    })
    expect(deps.socialMessageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'self', content: '好的' }),
    )
  })

  it('PASS、WAIT、DEFER 不产生平台发送', async () => {
    for (const outcome of [
      { type: 'pass' as const },
      {
        type: 'wait' as const,
        wait: { reason: 'continuation_expected' as const, duration: 'short' as const },
      },
      {
        type: 'defer' as const,
        intent: { intention: '稍后再问', timing: 'soon' as const, expires: 'today' as const },
      },
    ]) {
      const { bridge } = createBridge({ generateReply: vi.fn().mockResolvedValue(outcome) })
      const adapter = new FakeAdapter()
      bridge.registerAdapter(adapter as never)
      const result = await (
        bridge as unknown as {
          executeReply: (
            session: unknown,
            messages: InboundMessage[],
            reason: 'proactive_review',
          ) => Promise<unknown>
        }
      ).executeReply(
        {
          channelId: 'group-1',
          channelType: 'group',
          agentId: 'pero',
          participation: 'idle',
        },
        [inbound()],
        'proactive_review',
      )
      expect(result).toEqual(outcome)
      expect(adapter.sendMessage).not.toHaveBeenCalled()
    }
  })

  it('适配器缺失会抛错，让批次进入可靠重试路径', async () => {
    const { bridge } = createBridge()
    await expect(
      bridge.sendReply('missing', { channelId: 'g1', channelType: 'group', content: '消息' }),
    ).rejects.toThrow('社交适配器 missing 未连接')
  })
})
