import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayHub } from '@infos/backend/services/gateway/gatewayHub'
import type { GatewayEnvelope } from '@infos/backend/services/gateway/types'

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
    it('应当注册和注销节点并维护在线数量', () => {
      hub.registerNode('node-a', sendA)
      hub.registerNode('node-b', sendB)

      expect(hub.connectedCount).toBe(2)

      hub.unregisterNode('node-a')

      expect(hub.connectedCount).toBe(1)
    })
  })

  describe('handleMessage', () => {
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
      hub.on('abort', listener)
      hub.off('abort', listener)
      const envelope = createEnvelope('abort', { sessionId: 's1' })

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
