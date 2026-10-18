import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayHub } from '@infos/backend/services/gateway/gatewayHub'
import type { GatewayEnvelope } from '@infos/backend/services/gateway/types'
import type { DurableNotificationRepository } from '@infos/backend/repositories/durableNotification.repo'
import type { NodeRegistry } from '@infos/backend/kernel/nodeRegistry'

type SendMock = ReturnType<typeof vi.fn<(data: string) => void>>

vi.mock('@infos/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createEnvelope(type: GatewayEnvelope['type'], payload: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1 as const,
    id: `${type}-id`,
    type,
    sourceId: 'client',
    targetId: 'backend',
    timestamp: 1,
    payload,
  } satisfies GatewayEnvelope
}

describe('GatewayHub', () => {
  let hub: GatewayHub
  let sendA: SendMock
  let sendB: SendMock

  beforeEach(() => {
    hub = new GatewayHub()
    sendA = vi.fn<(data: string) => void>()
    sendB = vi.fn<(data: string) => void>()
  })

  describe('连接管理', () => {
    it('口语提示只跟随当前角色的显示状态，隐藏、切换角色和断线均使状态失效', async () => {
      hub.registerNode('node-a', sendA)
      const send = (type: GatewayEnvelope['type'], payload: Record<string, unknown>) =>
        hub.handleMessage(JSON.stringify(createEnvelope(type, payload)), 'node-a')
      await send('hello', { principalId: 'pero', supportedVersions: [1] })
      expect(hub.hasVisiblePet('pero')).toBe(false)
      await send('request', { action: 'gateway.pet_presence', agentId: 'pero', visible: true })
      expect(hub.hasVisiblePet('pero')).toBe(true)
      expect(hub.hasVisiblePet('nana')).toBe(false)
      await send('request', { action: 'gateway.pet_presence', agentId: 'pero', visible: false })
      expect(hub.hasVisiblePet('pero')).toBe(false)
      await send('request', { action: 'gateway.pet_presence', agentId: 'pero', visible: true })
      await send('request', { action: 'gateway.select_principal', principalId: 'nana' })
      expect(hub.hasVisiblePet('pero')).toBe(false)
      expect(hub.hasVisiblePet('nana')).toBe(false)
      await send('request', { action: 'gateway.pet_presence', agentId: 'nana', visible: true })
      expect(hub.hasVisiblePet('nana')).toBe(true)
      hub.unregisterNode('node-a')
      expect(hub.hasVisiblePet('nana')).toBe(false)
    })

    it('普通心跳不能延长过期的桌宠显示声明', async () => {
      let now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        hub.registerNode('node-a', sendA)
        await hub.handleMessage(
          JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
          'node-a',
        )
        await hub.handleMessage(
          JSON.stringify(
            createEnvelope('request', {
              action: 'gateway.pet_presence',
              agentId: 'pero',
              visible: true,
            }),
          ),
          'node-a',
        )
        expect(hub.hasVisiblePet('pero')).toBe(true)
        now += 91_000
        await hub.handleMessage(JSON.stringify(createEnvelope('heartbeat')), 'node-a')
        expect(hub.hasVisiblePet('pero')).toBe(false)
      } finally {
        clock.mockRestore()
      }
    })
    it('应当注册和注销节点并维护在线数量', () => {
      hub.registerNode('node-a', sendA)
      hub.registerNode('node-b', sendB)

      expect(hub.connectedCount).toBe(2)

      hub.unregisterNode('node-a')

      expect(hub.connectedCount).toBe(1)
    })
  })

  describe('handleMessage', () => {
    it('画布已移除通知在启动与游标补送均被过滤，只确认通知不删除任务', async () => {
      const records = ['removed', 'visible'].map((notificationId) => ({
        notificationId,
        principalId: 'pero',
        title: '图像编辑',
        revision: 1,
        level: 'error',
      }))
      const notifications = {
        list: vi.fn().mockReturnValue(records),
        acknowledge: vi.fn(),
        unreadIds: vi.fn().mockReturnValue(new Set(['removed', 'visible'])),
      }
      hub = new GatewayHub(undefined, notifications as unknown as DurableNotificationRepository)
      hub.addNotificationSuppression(async (principal, notices) =>
        principal === 'pero'
          ? notices
              .filter((notice) => notice.notificationId === 'removed')
              .map((notice) => notice.notificationId)
          : [],
      )
      hub.registerNode('node-a', sendA)
      await hub.handleMessage(
        JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
        'node-a',
      )
      expect(
        sendA.mock.calls
          .map(([raw]) => JSON.parse(raw))
          .filter((message) => message.payload.action === 'durable_notification')
          .map((message) => message.payload.notificationId),
      ).toEqual(['visible'])
      expect(notifications.acknowledge).toHaveBeenCalledWith('pero', [
        { notificationId: 'removed', revision: 1 },
      ])
      for (const notificationId of ['removed', 'visible'])
        await hub.pushBusiness(
          'durable_notification',
          { notificationId, revision: 1 },
          { type: 'all_principal_clients', principalId: 'pero' },
          'notification:pero',
        )
      await hub.handleMessage(
        JSON.stringify(
          createEnvelope('request', {
            action: 'gateway.subscribe',
            streamId: 'notification:pero',
            lastSequence: 0,
          }),
        ),
        'node-a',
      )
      const response = sendA.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .find((message) => message.type === 'response' && message.payload.events)
      expect(
        response.payload.events.map((event: GatewayEnvelope) => event.payload.notificationId),
      ).toEqual(['visible'])
      expect(response.payload.latestSequence).toBe(2)
    })

    it('新通知推送前也过滤已移除任务，过滤器释放后恢复正常', async () => {
      const notifications = { create: vi.fn().mockReturnValue(true), acknowledge: vi.fn() }
      hub = new GatewayHub(
        {} as NodeRegistry,
        notifications as unknown as DurableNotificationRepository,
      )
      const release = hub.addNotificationSuppression(async () => ['removed'])
      const push = vi.spyOn(hub, 'pushBusiness')
      await hub.pushNotification({
        notificationId: 'removed',
        principalId: 'pero',
        title: '图像编辑',
        important: true,
      })
      expect(push).not.toHaveBeenCalled()
      expect(notifications.acknowledge).toHaveBeenCalledWith('pero', [
        { notificationId: 'removed', revision: 1 },
      ])
      release()
      await hub.pushNotification({
        notificationId: 'fresh',
        principalId: 'pero',
        title: '新任务',
        important: true,
      })
      expect(push).toHaveBeenCalledOnce()
    })

    it('移除通知回执保存失败时仍过滤旧结果，不阻断其他通知', async () => {
      const notifications = {
        create: vi.fn().mockReturnValue(true),
        acknowledge: vi.fn(() => {
          throw new Error('临时写盘失败')
        }),
      }
      hub = new GatewayHub(
        {} as NodeRegistry,
        notifications as unknown as DurableNotificationRepository,
      )
      hub.addNotificationSuppression(async () => ['removed'])
      const push = vi.spyOn(hub, 'pushBusiness')
      await expect(
        hub.pushNotification({
          notificationId: 'removed',
          principalId: 'pero',
          title: '旧结果',
          important: true,
        }),
      ).resolves.toBeUndefined()
      expect(push).not.toHaveBeenCalled()
      await hub.pushNotification({
        notificationId: 'new-result',
        principalId: 'pero',
        title: '新结果',
        important: true,
      })
      expect(push).toHaveBeenCalledOnce()
    })

    it('历史通知确认后重连不再回放，并拒绝越过角色范围的回执', async () => {
      let unread = true
      const record = {
        notificationId: 'old-image-edit',
        principalId: 'pero',
        title: '任务失败 · 图像编辑',
        body: '旧任务失败',
        level: 'error',
        revision: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      const notifications = {
        list: vi.fn((principal: string) => (unread && principal === 'pero' ? [record] : [])),
        acknowledge: vi.fn((principal: string) => {
          if (principal === 'pero') unread = false
          return 1
        }),
      }
      hub = new GatewayHub(undefined, notifications as unknown as DurableNotificationRepository)
      hub.registerNode('node-a', sendA)
      await hub.handleMessage(
        JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
        'node-a',
      )
      const replay = sendA.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .find((message) => message.payload.action === 'durable_notification')
      expect(replay.payload).toMatchObject({
        notificationId: record.notificationId,
        principalId: 'pero',
        replayed: true,
        revision: 1,
        createdAt: record.createdAt,
      })
      await hub.handleMessage(
        JSON.stringify(
          createEnvelope('request', {
            action: 'gateway.notifications.ack',
            principalId: 'nana',
            receipts: [{ notificationId: record.notificationId, revision: 1 }],
          }),
        ),
        'node-a',
      )
      expect(notifications.acknowledge).not.toHaveBeenCalled()
      await hub.handleMessage(
        JSON.stringify(
          createEnvelope('request', {
            action: 'gateway.notifications.ack',
            principalId: 'pero',
            receipts: [{ notificationId: record.notificationId, revision: 1 }],
          }),
        ),
        'node-a',
      )
      expect(notifications.acknowledge).toHaveBeenCalledWith('pero', [
        { notificationId: record.notificationId, revision: 1 },
      ])
      hub.registerNode('node-b', sendB)
      await hub.handleMessage(
        JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
        'node-b',
      )
      expect(
        sendB.mock.calls
          .map(([raw]) => JSON.parse(raw))
          .filter((message) => message.payload.action === 'durable_notification'),
      ).toHaveLength(0)
    })

    it('订阅补游标的历史通知携带补送标记', async () => {
      hub.registerNode('node-a', sendA)
      await hub.handleMessage(
        JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
        'node-a',
      )
      await hub.pushBusiness(
        'durable_notification',
        { notificationId: 'cached-notice' },
        { type: 'all_principal_clients', principalId: 'pero' },
        'notification:pero',
      )
      await hub.handleMessage(
        JSON.stringify(
          createEnvelope('request', {
            action: 'gateway.subscribe',
            streamId: 'notification:pero',
            lastSequence: 0,
          }),
        ),
        'node-a',
      )
      const response = sendA.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .find((message) => message.type === 'response' && message.payload.events)
      expect(response.payload.events[0].payload.replayed).toBe(true)
    })

    it('游标恢复跳过已经确认的通知，仍保留最新序号', async () => {
      const notifications = {
        list: vi.fn().mockReturnValue([]),
        unreadIds: vi.fn().mockReturnValue(new Set(['unread-notice'])),
      }
      hub = new GatewayHub(undefined, notifications as unknown as DurableNotificationRepository)
      hub.registerNode('node-a', sendA)
      await hub.handleMessage(
        JSON.stringify(createEnvelope('hello', { principalId: 'pero', supportedVersions: [1] })),
        'node-a',
      )
      for (const notificationId of ['read-notice', 'unread-notice']) {
        await hub.pushBusiness(
          'durable_notification',
          { notificationId },
          { type: 'all_principal_clients', principalId: 'pero' },
          'notification:pero',
        )
      }
      await hub.handleMessage(
        JSON.stringify(
          createEnvelope('request', {
            action: 'gateway.subscribe',
            streamId: 'notification:pero',
            lastSequence: 0,
          }),
        ),
        'node-a',
      )
      const response = sendA.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .find((message) => message.type === 'response' && message.payload.events)
      expect(notifications.unreadIds).toHaveBeenCalledWith('pero', ['read-notice', 'unread-notice'])
      expect(response.payload.latestSequence).toBe(2)
      expect(response.payload.events).toHaveLength(1)
      expect(response.payload.events[0].payload).toMatchObject({
        notificationId: 'unread-notice',
        replayed: true,
      })
    })

    it('同一持久通知重复投递不再次推送，保留真实完成时间', async () => {
      const notifications = { create: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) }
      hub = new GatewayHub(
        {} as NodeRegistry,
        notifications as unknown as DurableNotificationRepository,
      )
      const push = vi.spyOn(hub, 'pushBusiness')
      const notice = {
        notificationId: 'stable-task-notice',
        principalId: 'pero',
        title: '图像编辑',
        important: true,
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      await hub.pushNotification(notice)
      await hub.pushNotification(notice)
      expect(push).toHaveBeenCalledOnce()
      expect(push.mock.calls[0]![1]).toMatchObject({
        createdAt: notice.createdAt,
        revision: 1,
        principalId: 'pero',
      })
    })
    it('收到 hello 时应当记录设备名并回送 hello_ack', async () => {
      hub.registerNode('node-a', sendA)
      const envelope = createEnvelope('hello', {
        token: 'token-a',
        deviceName: '主人的浏览器',
        supportedVersions: [1],
      })

      await hub.handleMessage(JSON.stringify(envelope), 'node-a')

      expect(sendA).toHaveBeenCalledOnce()
      expect(JSON.parse(sendA.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        type: 'hello_ack',
        targetId: 'node-a',
        payload: { nodeId: 'node-a', agreedVersion: 1 },
      })
    })

    it('收到 heartbeat 或 ping 时应当回送 heartbeat_ack', async () => {
      hub.registerNode('node-a', sendA)
      const heartbeat = createEnvelope('heartbeat')
      const ping = createEnvelope('ping')

      await hub.handleMessage(JSON.stringify(heartbeat), 'node-a')
      await hub.handleMessage(JSON.stringify(ping), 'node-a')

      expect(sendA).toHaveBeenCalledTimes(2)
      expect(sendA.mock.calls.map((call) => JSON.parse(call[0]).type)).toEqual([
        'heartbeat_ack',
        'heartbeat_ack',
      ])
    })

    it('收到无效 JSON 时应当静默忽略且不发送消息', async () => {
      hub.registerNode('node-a', sendA)

      await hub.handleMessage('{不是合法 JSON', 'node-a')

      expect(sendA).not.toHaveBeenCalled()
    })

    it('收到 request 时应当注入发送节点并触发通用事件和 action 事件', async () => {
      const requestListener = vi.fn()
      const actionListener = vi.fn()
      hub.on('request', requestListener)
      hub.on('action:chat', actionListener)
      hub.registerNode('node-a', sendA)
      const envelope = createEnvelope('request', { action: 'chat', text: '你好' })

      await hub.handleMessage(JSON.stringify(envelope), 'node-a')

      expect(requestListener).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'node-a' }))
      expect(actionListener).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'node-a' }))
    })

    it('收到 broadcast request 时应当排除发送者并广播给其他节点', async () => {
      hub.registerNode('node-a', sendA)
      hub.registerNode('node-b', sendB)
      const envelope = {
        ...createEnvelope('request', { action: 'sync' }),
        targetId: 'broadcast',
      }

      await hub.handleMessage(JSON.stringify(envelope), 'node-a')

      expect(sendA).not.toHaveBeenCalled()
      expect(sendB).toHaveBeenCalledOnce()
      expect(JSON.parse(sendB.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        type: 'request',
        sourceId: 'node-a',
        targetId: 'broadcast',
      })
    })

    it('收到目标节点消息时应当单播到目标节点', async () => {
      hub.registerNode('node-a', sendA)
      hub.registerNode('node-b', sendB)
      const envelope = {
        ...createEnvelope('push', { action: 'notice' }),
        targetId: 'node-b',
      }

      await hub.handleMessage(JSON.stringify(envelope), 'node-a')

      expect(sendA).not.toHaveBeenCalled()
      expect(sendB).toHaveBeenCalledOnce()
      expect(JSON.parse(sendB.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ targetId: 'node-b' })
    })
  })

  describe('事件系统', () => {
    it('off 应当移除已注册事件监听器', async () => {
      const listener = vi.fn()
      hub.registerNode('node-a', sendA)
      hub.on('abort', listener)
      const envelope = createEnvelope('abort', { sessionId: 's1' })

      await hub.handleMessage(JSON.stringify(envelope), 'node-a')

      expect(listener).toHaveBeenCalledOnce()
      listener.mockClear()
      hub.off('abort', listener)
      await hub.handleMessage(JSON.stringify(envelope), 'node-a')
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('推送与响应', () => {
    it('便捷推送方法应当创建 push 信封并广播给所有节点', async () => {
      hub.registerNode('node-a', sendA)
      hub.registerNode('node-b', sendB)

      await hub.pushNotification({ title: '你好', body: '通知正文' })

      expect(sendA).toHaveBeenCalledOnce()
      expect(sendB).toHaveBeenCalledOnce()
      const pushed = JSON.parse(sendA.mock.calls[0]?.[0] ?? '{}')

      expect(pushed).toMatchObject({
        type: 'push',
        targetId: 'broadcast',
        payload: {
          action: 'notification',
          title: '你好',
          body: '通知正文',
        },
      })
    })

    it('应当原样广播 Internal SurfaceFrame', async () => {
      hub.registerNode('node-a', sendA)
      await hub.pushSurface({
        protocolVersion: 1,
        surfaceId: 'surface-1' as import('@infos/shared').SurfaceId,
        generation: 'generation-1',
        revision: 1,
        sequence: 1,
        operationId: 'operation-1',
        operation: {
          type: 'surface.open',
          threadId: 'thread-1',
          principalId: 'pero',
        },
      })

      expect(JSON.parse(sendA.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        type: 'push',
        payload: {
          action: 'surface',
          frame: {
            surfaceId: 'surface-1',
            generation: 'generation-1',
            sequence: 1,
            operation: { type: 'surface.open', threadId: 'thread-1' },
          },
        },
      })
    })

    it('旧 audio_chunk 广播应 fail-closed', async () => {
      hub.registerNode('node-a', sendA)
      const buffer = Uint8Array.from([1, 2, 3]).buffer

      await expect(hub.pushAudioChunk(buffer, 'session-1')).rejects.toThrow('AUDIO_CHUNK_RETIRED')
      expect(sendA).not.toHaveBeenCalled()
    })

    it('sendResponse 和 sendError 应当保持原请求 ID 并单播给目标节点', async () => {
      hub.registerNode('node-a', sendA)

      await hub.sendResponse('request-1', 'node-a', { ok: true })
      await hub.sendError('request-2', 'node-a', '失败了')

      expect(JSON.parse(sendA.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        id: 'request-1',
        type: 'response',
        targetId: 'node-a',
        payload: { ok: true },
      })
      expect(JSON.parse(sendA.mock.calls[1]?.[0] ?? '{}')).toMatchObject({
        id: 'request-2',
        type: 'error',
        targetId: 'node-a',
        payload: { message: '失败了' },
      })
    })
  })
})
