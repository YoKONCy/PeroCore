import { describe, expect, it } from 'vitest'
import { NodeRegistry } from '@infos/backend/kernel'
import type { KernelInputSeatId, KernelNodeDescriptor, KernelNodeId } from '@infos/shared'

function client(nodeId: string): KernelNodeDescriptor {
  return {
    nodeId: nodeId as KernelNodeId,
    name: nodeId,
    facets: ['client'],
    trust: 'trusted',
    health: 'online',
    platform: { os: 'windows', arch: 'x64', runtime: 'electron' },
    publicKeyFingerprint: `fingerprint:${nodeId}`,
    registeredAt: new Date().toISOString(),
  }
}

describe('Node Registry Input Seat归属', () => {
  it('同一Principal只能有一个Seat，转移后Epoch递增且旧Seat立即失效', () => {
    const registry = new NodeRegistry()
    registry.registerNode(client('node-a'))
    registry.registerNode(client('node-b'))
    const a = registry.connect({
      nodeId: 'node-a' as KernelNodeId,
      carrier: 'websocket',
      leaseMs: 60_000,
    })
    const b = registry.connect({
      nodeId: 'node-b' as KernelNodeId,
      carrier: 'websocket',
      leaseMs: 60_000,
    })
    const first = registry.issueInputSeat({
      sessionId: a.sessionId,
      principalId: 'pero',
      windowId: 'window-a',
      capabilities: ['input', 'approval'],
      leaseMs: 60_000,
    })
    const second = registry.issueInputSeat({
      sessionId: b.sessionId,
      principalId: 'pero',
      windowId: 'window-b',
      capabilities: ['input'],
      leaseMs: 60_000,
    })
    expect(second.epoch).toBe(first.epoch + 1)
    expect(registry.listInputSeats()).toEqual([expect.objectContaining({ seatId: second.seatId })])
    expect(() =>
      registry.validateInputSeat({
        seatId: first.seatId,
        sessionId: a.sessionId,
        principalId: 'pero',
        windowId: 'window-a',
        epoch: first.epoch,
        capability: 'input',
      }),
    ).toThrow('INPUT_SEAT_EXPIRED')
  })

  it('输入路由必须匹配Session、Window、Principal、Epoch和Capability', () => {
    const registry = new NodeRegistry()
    registry.registerNode(client('node-a'))
    const session = registry.connect({
      nodeId: 'node-a' as KernelNodeId,
      carrier: 'websocket',
      leaseMs: 60_000,
    })
    const seat = registry.issueInputSeat({
      sessionId: session.sessionId,
      principalId: 'pero',
      windowId: 'window-a',
      capabilities: ['input'],
      leaseMs: 60_000,
    })
    expect(
      registry.validateInputSeat({
        seatId: seat.seatId,
        sessionId: session.sessionId,
        principalId: 'pero',
        windowId: 'window-a',
        epoch: seat.epoch,
        capability: 'input',
      }),
    ).toMatchObject({ windowId: 'window-a' })
    expect(() =>
      registry.validateInputSeat({
        seatId: seat.seatId,
        sessionId: session.sessionId,
        principalId: 'pero',
        windowId: 'window-b',
        epoch: seat.epoch,
        capability: 'input',
      }),
    ).toThrow('INPUT_SEAT_IDENTITY_MISMATCH')
    expect(() =>
      registry.validateInputSeat({
        seatId: seat.seatId,
        sessionId: session.sessionId,
        principalId: 'pero',
        windowId: 'window-a',
        epoch: seat.epoch,
        capability: 'approval',
      }),
    ).toThrow('INPUT_SEAT_CAPABILITY_DENIED')
  })

  it('窗口关闭和Node断线应自动撤销Seat', () => {
    const registry = new NodeRegistry()
    registry.registerNode(client('node-a'))
    const session = registry.connect({
      nodeId: 'node-a' as KernelNodeId,
      carrier: 'websocket',
      leaseMs: 60_000,
    })
    registry.issueInputSeat({
      sessionId: session.sessionId,
      principalId: 'pero',
      windowId: 'window-a',
      capabilities: ['input'],
      leaseMs: 60_000,
    })
    expect(registry.revokeWindow(session.sessionId, 'window-a')).toBe(1)
    const next = registry.issueInputSeat({
      sessionId: session.sessionId,
      principalId: 'pero',
      windowId: 'window-b',
      capabilities: ['input'],
      leaseMs: 60_000,
    })
    registry.disconnect(session.sessionId)
    expect(registry.getInputSeat('pero')).toBeNull()
    expect(registry.revokeInputSeat(next.seatId as KernelInputSeatId)).toBe(false)
  })
})
