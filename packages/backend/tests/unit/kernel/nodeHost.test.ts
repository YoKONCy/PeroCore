import { describe, expect, it, vi } from 'vitest'
import type { KernelCapabilityOffer, KernelNodeId, KernelObjectId } from '@infos/shared'
import type { NodeTransport } from '@infos/node-sdk'
import {
  CapabilityDirectory,
  CapabilityHandleRegistry,
  LifecycleScope,
  NodeCapabilityBridge,
  NodeRegistry,
  PlacementResolver,
} from '@infos/backend/kernel'

const serverId = 'server-node' as KernelNodeId
const hostId = 'host-node' as KernelNodeId

function remoteOffer(): KernelCapabilityOffer {
  return {
    offerId: 'probe.echo@host-node',
    provider: {
      objectType: 'node-provider',
      objectId: 'host-node/echo' as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'system',
      authorityNodeId: hostId,
      authorityEpoch: 1,
    },
    capabilityType: 'probe.echo',
    contractVersion: '1.0',
    operations: ['echo'],
    resourceKinds: ['probe'],
    health: 'available',
    placement: {
      providerNodeId: hostId,
      providerFacet: 'capability',
      executionLocation: 'remote-capability-node',
      resourceAuthorityNodeId: hostId,
      supportsHeadless: true,
      dataResidency: 'node-only',
      latencyClass: 'wan',
      costClass: 'free',
    },
  }
}

describe('NodeCapabilityBridge', () => {
  it('应通过显式 Remote Adapter 完成 Placement、Handle、Envelope、Transport 与 Receipt 闭环', async () => {
    const nodes = new NodeRegistry()
    for (const [nodeId, facets] of [
      [serverId, ['server', 'gateway']],
      [hostId, ['capability', 'compute']],
    ] as const) {
      nodes.registerNode({
        nodeId,
        displayName: nodeId,
        facets,
        trust: nodeId === serverId ? 'local' : 'paired',
        platform: { os: 'linux', runtime: 'node' },
        protocolVersion: 1,
        registeredAt: new Date().toISOString(),
      })
      nodes.connect({
        nodeId,
        carrier: nodeId === serverId ? 'memory' : 'websocket',
        leaseMs: 10_000,
      })
    }
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles, new PlacementResolver(nodes), serverId)
    directory.registerDefinition({
      capabilityType: 'probe.echo',
      contractVersion: '1.0',
      operations: { echo: { risk: 'read', idempotency: 'safe' } },
    })
    const request = vi.fn(async (message) => ({
      invocationId: message.invocationId,
      providerId: message.providerId,
      state: 'completed' as const,
      acceptedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      output: {
        echo: message.envelope.payload.input,
        route: message.envelope.route,
      },
    }))
    const transport: NodeTransport = {
      localNodeId: serverId,
      request,
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }
    const scope = new LifecycleScope('Node Bridge')
    const offer = remoteOffer()
    new NodeCapabilityBridge(serverId, transport).register({
      directory,
      offer,
      providerId: 'infos.probe.echo-asset',
      scope,
    })
    const handle = handles.issue({
      subjectId: 'consumer',
      issuerNodeId: serverId,
      subjectNodeId: serverId,
      providerNodeId: hostId,
      revocationEpoch: 1,
      resource: offer.provider,
      operations: ['echo'],
      revocable: true,
    })
    const port = directory.bind({
      requirement: {
        requirementId: 'echo-consumer',
        capabilityType: 'probe.echo',
        contractVersion: '1.0',
        operations: ['echo'],
        required: true,
        binding: 'eager',
        cardinality: 'one',
        placement: { executionLocations: ['remote-capability-node'] },
      },
      handleId: handle.handleId,
      scope,
      principalId: 'pero',
    })
    const output = await port.invoke<{ value: string }, { echo: { value: string } }>(
      'echo',
      { value: 'hello' },
      { principalId: 'pero', correlationId: 'bridge-test', idempotencyKey: 'echo-1' },
    )
    expect(output.echo.value).toBe('hello')
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceNodeId: serverId,
        targetNodeId: hostId,
        envelope: expect.objectContaining({
          sourceNodeId: serverId,
          targetNodeId: hostId,
          route: expect.objectContaining({ hopLimit: 8 }),
        }),
      }),
    )
    await scope.dispose()
  })

  it('普通本地 Provider 注册远程 Offer 仍必须 fail-closed', async () => {
    const nodes = new NodeRegistry()
    nodes.registerNode({
      nodeId: hostId,
      displayName: '远程节点',
      facets: ['capability'],
      trust: 'paired',
      platform: { os: 'linux', runtime: 'node' },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    })
    nodes.connect({ nodeId: hostId, carrier: 'websocket', leaseMs: 10_000 })
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles, new PlacementResolver(nodes), serverId)
    directory.registerDefinition({
      capabilityType: 'probe.echo',
      contractVersion: '1.0',
      operations: { echo: { risk: 'read', idempotency: 'safe' } },
    })
    const offer = remoteOffer()
    directory.registerProvider(offer, async () => '错误的本地执行')
    const handle = handles.issue({
      subjectId: 'consumer',
      providerNodeId: hostId,
      resource: offer.provider,
      operations: ['echo'],
      revocable: true,
    })
    const scope = new LifecycleScope('Remote Fail Closed')
    const port = directory.bind({
      requirement: {
        requirementId: 'echo',
        capabilityType: 'probe.echo',
        contractVersion: '1.0',
        operations: ['echo'],
        required: true,
        binding: 'eager',
        cardinality: 'one',
      },
      handleId: handle.handleId,
      scope,
    })
    await expect(
      port.invoke('echo', {}, { principalId: 'pero', correlationId: 'denied' }),
    ).rejects.toThrow('NODE_TRANSPORT_UNAVAILABLE')
    await scope.dispose()
  })
})
