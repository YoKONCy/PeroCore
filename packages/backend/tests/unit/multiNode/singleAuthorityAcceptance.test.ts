import { describe, expect, it, vi } from 'vitest'
import type {
  KernelCapabilityOffer,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelObjectId,
} from '@infos/shared'
import {
  CapabilityDirectory,
  CapabilityHandleRegistry,
  LifecycleScope,
  NodeRegistry,
  PlacementResolver,
} from '../../../src/kernel'
import { ApprovalService } from '../../../src/services/execution/approvalService'
import { AgentInputService } from '../../../src/services/execution/agentInputService'
import { DurableGatewayStream } from '../../../src/services/gateway/durableGatewayStream'
import { GatewayHub } from '../../../src/services/gateway/gatewayHub'
import { createEnvelope } from '../../../src/services/gateway/types'

const authorityId = 'authority-server' as KernelNodeId
const electronId = 'electron-client-a' as KernelNodeId
const webId = 'web-client-b' as KernelNodeId
const capabilityId = 'capability-node-c' as KernelNodeId

function descriptor(
  nodeId: KernelNodeId,
  facets: KernelNodeDescriptor['facets'],
): KernelNodeDescriptor {
  return {
    nodeId,
    displayName: nodeId,
    facets,
    trust: nodeId === authorityId ? 'local' : 'paired',
    platform: {
      os: nodeId === webId ? 'web' : 'linux',
      runtime: nodeId === electronId ? 'electron' : nodeId === webId ? 'browser' : 'node',
    },
    protocolVersion: 1,
    registeredAt: new Date().toISOString(),
  }
}

function audioOffer(nodeId: KernelNodeId): KernelCapabilityOffer {
  return {
    offerId: `audio.output@${nodeId}`,
    provider: {
      objectType: 'capability-provider',
      objectId: `${nodeId}/audio-output` as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'pero',
      authorityNodeId: nodeId,
      authorityEpoch: 1,
    },
    capabilityType: 'audio.output',
    contractVersion: '1.0',
    operations: ['play', 'stop', 'status'],
    resourceKinds: ['audio'],
    health: 'available',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    placement: {
      providerNodeId: nodeId,
      providerFacet: 'capability',
      executionLocation: 'client-local',
      resourceAuthorityNodeId: nodeId,
      requiresClientPresence: true,
      supportsHeadless: false,
      dataResidency: 'device-only',
      latencyClass: 'local',
      costClass: 'free',
    },
  }
}

function gatewayMessage(
  nodeId: KernelNodeId,
  type: 'hello' | 'request',
  payload: Record<string, unknown>,
): string {
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

describe('P8 单 Authority 多端总验收', () => {
  it('应在单 Authority 下完成多 Client、Seat 转移、等待态与恢复语义', async () => {
    const nodes = new NodeRegistry()
    for (const [nodeId, facets] of [
      [authorityId, ['server', 'gateway', 'storage']],
      [electronId, ['client', 'device', 'capability']],
      [webId, ['client', 'device']],
      [capabilityId, ['capability', 'compute']],
    ] as const) {
      nodes.registerNode(descriptor(nodeId, facets))
      nodes.connect({ nodeId, carrier: 'memory', leaseMs: 60_000 })
    }

    const hub = new GatewayHub(nodes)
    const electronSend = vi.fn()
    const webSend = vi.fn()
    hub.registerNode('connection-electron', electronSend)
    hub.registerNode('connection-web', webSend)
    await hub.handleMessage(
      gatewayMessage(electronId, 'hello', { nodeId: electronId, principalId: 'pero' }),
      'connection-electron',
    )
    await hub.handleMessage(
      gatewayMessage(webId, 'hello', { nodeId: webId, principalId: 'pero' }),
      'connection-web',
    )
    await hub.handleMessage(
      gatewayMessage(electronId, 'request', {
        action: 'input_seat.acquire',
        principalId: 'pero',
        windowId: 'pet',
      }),
      'connection-electron',
    )
    expect(nodes.getInputSeat('pero', 'audio-output')?.nodeId).toBe(electronId)

    const approvals = new ApprovalService()
    const approval = approvals.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-p8',
      threadId: 'thread-p8',
      toolName: 'delete_file',
      args: { path: '受控路径' },
      reason: '需要主人确认',
    })
    const inputs = new AgentInputService()
    const input = inputs.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-p8',
      threadId: 'thread-p8',
      question: '请补充信息',
    })
    await Promise.resolve()
    expect(approvals.get(approval.id)?.status).toBe('pending')
    expect(inputs.get(input.id)?.status).toBe('pending')

    await hub.handleMessage(
      gatewayMessage(webId, 'request', {
        action: 'input_seat.acquire',
        principalId: 'pero',
        windowId: 'browser',
      }),
      'connection-web',
    )
    expect(nodes.getInputSeat('pero')?.nodeId).toBe(webId)
    expect(approvals.get(approval.id)?.status).toBe('pending')
    expect(inputs.get(input.id)?.status).toBe('pending')

    electronSend.mockClear()
    webSend.mockClear()
    await hub.pushBusiness(
      'notification',
      { notificationId: 'notification-p8', revision: 1, unread: true },
      { type: 'active_input_seat', principalId: 'pero' },
      'notification:pero',
    )
    expect(electronSend).not.toHaveBeenCalled()
    expect(webSend).toHaveBeenCalledOnce()

    const stream = new DurableGatewayStream(2)
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      stream.append('thread:p8', createEnvelope('push', { action: 'surface', sequence }))
    }
    expect(stream.read('thread:p8', 2).events.map((event) => event.sequence)).toEqual([3, 4])
    expect(stream.read('thread:p8', 1).snapshotRequired).toBe(true)

    const currentWebSession = nodes.getActiveSession(webId)!
    nodes.disconnect(currentWebSession.sessionId)
    expect(() =>
      nodes.validateInputSeat({
        seatId: nodes.listInputSeats()[0]?.seatId ?? ('stale-seat' as never),
        sessionId: currentWebSession.sessionId,
        principalId: 'pero',
        windowId: 'browser',
        epoch: 2,
        capability: 'input',
      }),
    ).toThrow('INPUT_SEAT_EXPIRED')
  })

  it('应只调用目标 Audio Output，并在 Seat 迁移与 Offer 离线后 fail-closed', async () => {
    const nodes = new NodeRegistry()
    for (const nodeId of [authorityId, electronId, capabilityId]) {
      const facets =
        nodeId === authorityId
          ? (['server', 'capability'] as const)
          : (['client', 'device', 'capability'] as const)
      nodes.registerNode(descriptor(nodeId, facets))
      nodes.connect({ nodeId, carrier: 'memory', leaseMs: 60_000 })
    }
    const electronSession = nodes.getActiveSession(electronId)!
    nodes.issueInputSeat({
      sessionId: electronSession.sessionId,
      principalId: 'pero',
      windowId: 'pet',
      capabilities: ['input', 'audio-output'],
      leaseMs: 60_000,
    })

    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles, new PlacementResolver(nodes), authorityId)
    directory.registerDefinition({
      capabilityType: 'audio.output',
      contractVersion: '1.0',
      operations: {
        play: { risk: 'interact', idempotency: 'keyed' },
        stop: { risk: 'interact', idempotency: 'safe' },
        status: { risk: 'read', idempotency: 'safe' },
      },
    })
    const electronInvoke = vi.fn(async () => ({ playbackId: 'play-p8', state: 'completed' }))
    const otherInvoke = vi.fn(async () => ({ playbackId: 'wrong', state: 'completed' }))
    const electronOffer = audioOffer(electronId)
    const unregisterElectron = directory.registerRemoteProvider(electronOffer, electronInvoke)
    directory.registerRemoteProvider(audioOffer(capabilityId), otherInvoke)
    const handle = handles.issue({
      subjectId: 'kernel.audio-delivery',
      issuerNodeId: authorityId,
      subjectNodeId: authorityId,
      providerNodeId: electronId,
      revocationEpoch: 1,
      resource: electronOffer.provider,
      operations: ['play', 'stop', 'status'],
      revocable: true,
    })
    const scope = new LifecycleScope('p8-audio')
    const port = directory.bind({
      requirement: {
        requirementId: 'p8-audio-output',
        capabilityType: 'audio.output',
        contractVersion: '1.0',
        operations: ['play', 'stop', 'status'],
        required: true,
        binding: 'lazy',
        cardinality: 'one',
        placement: { preferredNodeId: electronId },
      },
      handleId: handle.handleId,
      scope,
      principalId: 'pero',
    })
    await expect(
      port.invoke(
        'play',
        { assetUrl: '/api/assets/audio/one-use-handle' },
        { principalId: 'pero', correlationId: 'p8-play', idempotencyKey: 'p8-play' },
      ),
    ).resolves.toMatchObject({ playbackId: 'play-p8' })
    expect(electronInvoke).toHaveBeenCalledOnce()
    expect(otherInvoke).not.toHaveBeenCalled()

    unregisterElectron()
    await expect(
      port.invoke(
        'stop',
        { playbackId: 'play-p8' },
        { principalId: 'pero', correlationId: 'stop' },
      ),
    ).rejects.toThrow('CAPABILITY_PROVIDER_UNAVAILABLE')
    await scope.dispose()
  })
})
