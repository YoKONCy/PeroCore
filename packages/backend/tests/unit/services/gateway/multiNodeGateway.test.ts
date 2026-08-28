import { describe, expect, it, vi } from 'vitest'
import type { KernelNodeDescriptor, KernelNodeId } from '@infos/shared'
import { NodeRegistry } from '../../../../src/kernel/nodeRegistry'
import { GatewayHub } from '../../../../src/services/gateway/gatewayHub'
import { DurableGatewayStream } from '../../../../src/services/gateway/durableGatewayStream'
import { createEnvelope } from '../../../../src/services/gateway/types'

const nodeId = 'client-stable-1' as KernelNodeId
const descriptor: KernelNodeDescriptor = {
  nodeId,
  displayName: '浏览器客户端',
  facets: ['client', 'device'],
  trust: 'local',
  platform: { os: 'web', runtime: 'browser' },
  protocolVersion: 1,
  registeredAt: '2026-08-28T00:00:00.000Z',
}

function message(type: 'hello' | 'request' | 'heartbeat', payload: Record<string, unknown>) {
  return JSON.stringify({
    protocolVersion: 1,
    id: crypto.randomUUID(),
    type,
    sourceId: nodeId,
    targetId: 'backend',
    timestamp: Date.now(),
    payload,
  })
}

describe('Gateway 多节点闭环', () => {
  it('稳定 Node 重连时应保留 Node ID 并递增 Session Generation', async () => {
    const registry = new NodeRegistry()
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const hub = new GatewayHub(registry)
    hub.registerNode('connection-1', firstSend)
    await hub.handleMessage(
      message('hello', { nodeId, principalId: 'pero', deviceName: descriptor.displayName }),
      'connection-1',
    )
    const first = registry.getActiveSession(nodeId)!
    hub.unregisterNode('connection-1')

    hub.registerNode('connection-2', secondSend)
    await hub.handleMessage(
      message('hello', { nodeId, principalId: 'pero', deviceName: descriptor.displayName }),
      'connection-2',
    )
    const second = registry.getActiveSession(nodeId)!

    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)
    expect(second.connectionId).toBe('connection-2')
    expect(JSON.parse(secondSend.mock.calls[0]![0])).toMatchObject({
      type: 'hello_ack',
      payload: { nodeId, generation: 2 },
    })
  })

  it('Input Seat 应绑定当前 Session 且旧 Session 断开后失效', async () => {
    const registry = new NodeRegistry()
    const send = vi.fn()
    const hub = new GatewayHub(registry)
    hub.registerNode('connection-1', send)
    await hub.handleMessage(message('hello', { nodeId, principalId: 'pero' }), 'connection-1')
    await hub.handleMessage(
      message('request', {
        action: 'input_seat.acquire',
        principalId: 'pero',
        windowId: 'main',
      }),
      'connection-1',
    )

    const seat = registry.getInputSeat('pero', 'approval')
    expect(seat?.nodeId).toBe(nodeId)
    hub.unregisterNode('connection-1')
    expect(registry.getInputSeat('pero')).toBeNull()
  })

  it('Audience 应只把审批投递给 active Input Seat', async () => {
    const registry = new NodeRegistry()
    const sendA = vi.fn()
    const sendB = vi.fn()
    const hub = new GatewayHub(registry)
    for (const [connection, stableNode, send] of [
      ['connection-a', 'client-a', sendA],
      ['connection-b', 'client-b', sendB],
    ] as const) {
      hub.registerNode(connection, send)
      await hub.handleMessage(
        message('hello', { nodeId: stableNode, principalId: 'pero' }),
        connection,
      )
    }
    await hub.handleMessage(
      message('request', { action: 'input_seat.acquire', principalId: 'pero' }),
      'connection-b',
    )
    sendA.mockClear()
    sendB.mockClear()

    await hub.pushBusiness(
      'tool_approval_requested',
      { request: { id: 'approval-1' } },
      { type: 'active_input_seat', principalId: 'pero' },
      'approval:pero',
    )

    expect(sendA).not.toHaveBeenCalled()
    expect(sendB).toHaveBeenCalledOnce()
  })

  it('Durable Stream 应支持 Cursor 补发和 Snapshot Fallback', () => {
    const stream = new DurableGatewayStream(2)
    for (let index = 0; index < 3; index += 1) {
      stream.append('thread:main', createEnvelope('push', { action: 'proactive_message', index }))
    }
    expect(stream.read('thread:main', 1)).toMatchObject({
      retentionFloor: 2,
      latestSequence: 3,
      snapshotRequired: false,
    })
    expect(stream.read('thread:main', 0).events.map((event) => event.sequence)).toEqual([2, 3])
    const snapshotStream = new DurableGatewayStream(1)
    for (let index = 0; index < 3; index += 1) {
      snapshotStream.append(
        'thread:snapshot',
        createEnvelope('push', { action: 'proactive_message', index }),
      )
    }
    expect(snapshotStream.read('thread:snapshot', 1).snapshotRequired).toBe(true)
  })
})
