import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type {
  KernelCapabilityOffer,
  KernelCapabilityRequirement,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelObjectId,
  KernelObjectRef,
} from '@infos/shared'
import {
  CapabilityDirectory,
  CapabilityHandleRegistry,
  FileNodeRegistryStore,
  LifecycleScope,
  NodeRegistry,
  PlacementResolver,
  ResourceAuthorityDirectory,
} from '@infos/backend/kernel'

const serverId = 'node-server' as KernelNodeId
const clientId = 'node-client' as KernelNodeId
const remoteId = 'node-remote' as KernelNodeId

function descriptor(
  nodeId: KernelNodeId,
  facets: KernelNodeDescriptor['facets'],
  trust: KernelNodeDescriptor['trust'] = 'managed',
): KernelNodeDescriptor {
  return {
    nodeId,
    displayName: nodeId,
    facets,
    trust,
    platform: { os: 'linux', runtime: 'node' },
    protocolVersion: 1,
    registeredAt: new Date().toISOString(),
  }
}

function object(nodeId = serverId): KernelObjectRef {
  return {
    objectType: 'test-resource',
    objectId: 'resource-1' as KernelObjectId,
    generation: 1,
    ownerPrincipalId: 'pero',
    authorityNodeId: nodeId,
    authorityEpoch: 1,
  }
}

function offer(
  nodeId: KernelNodeId,
  location: 'server-local' | 'client-local' | 'remote-capability-node',
): KernelCapabilityOffer {
  return {
    offerId: `offer:${nodeId}`,
    provider: object(nodeId),
    capabilityType: 'test.capability',
    contractVersion: '1.0',
    operations: ['run'],
    resourceKinds: ['test-resource'],
    health: 'available',
    placement: {
      providerNodeId: nodeId,
      providerFacet: location === 'client-local' ? 'client' : 'capability',
      executionLocation: location,
      resourceAuthorityNodeId: nodeId,
      requiresClientPresence: location === 'client-local',
      requiresInputSeat: location === 'client-local',
      supportsHeadless: location !== 'client-local',
      dataResidency: location === 'client-local' ? 'device-only' : 'server-authority',
      latencyClass: location === 'remote-capability-node' ? 'wan' : 'local',
      costClass: 'free',
    },
  }
}

const requirement: KernelCapabilityRequirement = {
  requirementId: 'consumer',
  capabilityType: 'test.capability',
  contractVersion: '1.0',
  operations: ['run'],
  required: true,
  binding: 'eager',
  cardinality: 'one',
}

describe('Node Foundation', () => {
  it('Node Registry重启后应保留Identity和Generation，但不得复活旧Session', () => {
    const root = path.join(tmpdir(), `infos-node-registry-${randomUUID()}`)
    mkdirSync(root, { recursive: true })
    try {
      const store = new FileNodeRegistryStore(path.join(root, 'nodes.json'))
      const first = new NodeRegistry(store)
      first.registerNode(descriptor(remoteId, ['capability'], 'paired'))
      const session = first.connect({ nodeId: remoteId, carrier: 'websocket', leaseMs: 10_000 })
      expect(session.connectionGeneration).toBe(1)

      const restarted = new NodeRegistry(store)
      expect(restarted.getNode(remoteId)?.trust).toBe('paired')
      expect(restarted.getActiveSession(remoteId)).toBeNull()
      const next = restarted.connect({ nodeId: remoteId, carrier: 'websocket', leaseMs: 10_000 })
      expect(next.connectionGeneration).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Authority Node不可达时写入必须fail-closed', () => {
    const nodes = new NodeRegistry()
    nodes.registerNode(descriptor(remoteId, ['storage'], 'managed'))
    const directory = new ResourceAuthorityDirectory(nodes)
    directory.register({
      object: object(remoteId),
      authorityNodeId: remoteId,
      authorityEpoch: 1,
      writable: true,
      updatedAt: new Date().toISOString(),
    })
    expect(() => directory.resolve(object(remoteId), true)).toThrow('AUTHORITY_NODE_UNREACHABLE')
    nodes.connect({ nodeId: remoteId, carrier: 'websocket', leaseMs: 10_000 })
    expect(directory.resolve(object(remoteId), true).writable).toBe(true)
  })

  it('稳定 Node Identity 与连接 Session Generation 应分离', () => {
    const registry = new NodeRegistry()
    registry.registerNode(descriptor(serverId, ['server', 'capability']))
    const first = registry.connect({ nodeId: serverId, carrier: 'memory', leaseMs: 10_000 })
    registry.disconnect(first.sessionId)
    const second = registry.connect({ nodeId: serverId, carrier: 'websocket', leaseMs: 10_000 })
    expect(second.nodeId).toBe(first.nodeId)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.connectionGeneration).toBe(2)
  })

  it('只有在线 Client Facet 可以持有 Input Seat', () => {
    const registry = new NodeRegistry()
    registry.registerNode(descriptor(serverId, ['server']))
    registry.registerNode(descriptor(clientId, ['client', 'device']))
    const server = registry.connect({ nodeId: serverId, carrier: 'memory', leaseMs: 10_000 })
    expect(() =>
      registry.issueInputSeat({
        sessionId: server.sessionId,
        principalId: 'pero',
        capabilities: ['input'],
        leaseMs: 1_000,
      }),
    ).toThrow('INPUT_SEAT_CLIENT_REQUIRED')
    const client = registry.connect({ nodeId: clientId, carrier: 'websocket', leaseMs: 10_000 })
    const seat = registry.issueInputSeat({
      sessionId: client.sessionId,
      principalId: 'pero',
      capabilities: ['input', 'approval'],
      leaseMs: 1_000,
    })
    expect(registry.getInputSeat('pero', 'approval')?.seatId).toBe(seat.seatId)
    registry.disconnect(client.sessionId)
    expect(registry.getInputSeat('pero')).toBeNull()
  })

  it('Authority Directory 应拒绝 split-brain 并通过迁移提升 Epoch', () => {
    const directory = new ResourceAuthorityDirectory()
    directory.register({
      object: object(),
      authorityNodeId: serverId,
      authorityEpoch: 1,
      writable: true,
      updatedAt: new Date().toISOString(),
    })
    expect(() =>
      directory.register({
        object: object(),
        authorityNodeId: remoteId,
        authorityEpoch: 1,
        writable: true,
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow('AUTHORITY_SPLIT_BRAIN')
    const moved = directory.transfer({
      object: object(),
      fromNodeId: serverId,
      toNodeId: remoteId,
      expectedEpoch: 1,
    })
    expect(moved).toMatchObject({ authorityNodeId: remoteId, authorityEpoch: 2 })
  })

  it('Placement 应校验 Facet、Input Seat 与数据驻留', () => {
    const registry = new NodeRegistry()
    registry.registerNode(descriptor(serverId, ['server', 'capability'], 'local'))
    registry.registerNode(descriptor(clientId, ['client', 'device'], 'paired'))
    registry.connect({ nodeId: serverId, carrier: 'memory', leaseMs: 10_000 })
    const client = registry.connect({ nodeId: clientId, carrier: 'websocket', leaseMs: 10_000 })
    const resolver = new PlacementResolver(registry)
    expect(
      resolver.resolve({
        requirement: { ...requirement, placement: { supportsHeadless: true } },
        offers: [offer(clientId, 'client-local'), offer(serverId, 'server-local')],
      }).offer.offerId,
    ).toBe(`offer:${serverId}`)
    expect(() =>
      resolver.resolve({
        requirement: {
          ...requirement,
          placement: { executionLocations: ['client-local'], requiresInputSeat: true },
        },
        offers: [offer(clientId, 'client-local')],
        principalId: 'pero',
      }),
    ).toThrow('PLACEMENT_UNAVAILABLE')
    registry.issueInputSeat({
      sessionId: client.sessionId,
      principalId: 'pero',
      capabilities: ['input'],
      leaseMs: 1_000,
    })
    expect(
      resolver.resolve({
        requirement: {
          ...requirement,
          placement: { executionLocations: ['client-local'], requiresInputSeat: true },
        },
        offers: [offer(clientId, 'client-local')],
        principalId: 'pero',
      }).node.nodeId,
    ).toBe(clientId)
  })

  it('Capability Handle 应拒绝跨 Authority Node 的同名对象', () => {
    const handles = new CapabilityHandleRegistry()
    const handle = handles.issue({
      subjectId: 'consumer',
      issuerNodeId: serverId,
      subjectNodeId: clientId,
      providerNodeId: serverId,
      revocationEpoch: 1,
      resource: object(serverId),
      operations: ['run'],
      revocable: true,
    })
    expect(handles.allows(handle.handleId, object(serverId), 'run')).toBe(true)
    expect(handles.allows(handle.handleId, object(remoteId), 'run')).toBe(false)
    expect(handles.allows(handle.handleId, { ...object(serverId), authorityEpoch: 2 }, 'run')).toBe(
      false,
    )
  })

  it('Capability Port 应写入 Node Route，并对未配置远程 Transport fail-closed', async () => {
    const registry = new NodeRegistry()
    registry.registerNode(descriptor(serverId, ['server', 'capability'], 'local'))
    registry.registerNode(descriptor(remoteId, ['capability', 'compute'], 'managed'))
    registry.connect({ nodeId: serverId, carrier: 'memory', leaseMs: 10_000 })
    registry.connect({ nodeId: remoteId, carrier: 'websocket', leaseMs: 10_000 })
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles, new PlacementResolver(registry), serverId)
    directory.registerDefinition({
      capabilityType: 'test.capability',
      contractVersion: '1.0',
      operations: { run: { risk: 'read', idempotency: 'safe' } },
    })
    let receivedRoute: unknown
    directory.registerProvider(offer(serverId, 'server-local'), async (envelope) => {
      receivedRoute = envelope.route
      return 'ok'
    })
    const localHandle = handles.issue({
      subjectId: 'consumer',
      resource: object(serverId),
      operations: ['run'],
      revocable: true,
    })
    const scope = new LifecycleScope('Node Port')
    const local = directory.bind({ requirement, handleId: localHandle.handleId, scope })
    await expect(
      local.invoke('run', {}, { principalId: 'pero', correlationId: 'local' }),
    ).resolves.toBe('ok')
    expect(receivedRoute).toMatchObject({
      sourceNodeId: serverId,
      targetNodeId: serverId,
      hopLimit: 8,
    })

    directory.registerProvider(offer(remoteId, 'remote-capability-node'), async () => 'remote')
    const remoteHandle = handles.issue({
      subjectId: 'consumer',
      resource: object(remoteId),
      operations: ['run'],
      revocable: true,
    })
    const remote = directory.bind({
      requirement: {
        ...requirement,
        placement: { executionLocations: ['remote-capability-node'] },
      },
      handleId: remoteHandle.handleId,
      scope,
    })
    await expect(
      remote.invoke('run', {}, { principalId: 'pero', correlationId: 'remote' }),
    ).rejects.toThrow('NODE_TRANSPORT_UNAVAILABLE')
    await scope.dispose()
  })
})
