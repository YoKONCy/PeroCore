import { describe, expect, it, vi } from 'vitest'
import type { KernelCapabilityOffer, KernelNodeId, KernelObjectId } from '@infos/shared'
import { arcaManifest } from '@infos/arca'
import { ApplicationRealmManager } from '../../../src/applications/applicationRealm'
import { ArcaCapabilityRuntime } from '../../../src/capabilities/arcaCapabilityRuntime'
import { CapabilityDirectory } from '../../../src/kernel/capabilityDirectory'
import { CapabilityHandleRegistry } from '../../../src/kernel/capabilityHandleRegistry'
import { NodeRegistry } from '../../../src/kernel/nodeRegistry'
import { PlacementResolver } from '../../../src/kernel/placementResolver'
import { ToolRegistry } from '../../../src/services/agent/toolRegistry'

const localNodeId = 'kernel:test' as KernelNodeId
const providerNodeId = 'application:arca-test' as KernelNodeId
const operations = [
  'document.inspect',
  'document.context_regions',
  'document.changeset.list',
  'document.changeset.propose',
  'document.changeset.validate',
]

describe('ArcaCapabilityRuntime', () => {
  it('Tool Projection应随在线Offer注册和注销', async () => {
    const handles = new CapabilityHandleRegistry()
    const nodes = new NodeRegistry()
    nodes.registerNode({
      nodeId: providerNodeId,
      displayName: 'Arca Test',
      facets: ['application', 'capability'],
      trust: 'local',
      platform: { os: 'windows', arch: 'x64', runtime: 'node' },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    })
    nodes.connect({ nodeId: providerNodeId, carrier: 'websocket', leaseMs: 60_000 })
    const directory = new CapabilityDirectory(handles, new PlacementResolver(nodes), localNodeId)
    directory.registerDefinition({
      capabilityType: 'document.semantic',
      contractVersion: '1.0',
      operations: Object.fromEntries(
        operations.map((operation) => [operation, { risk: 'interact', idempotency: 'unsafe' }]),
      ),
    })
    const tools = new ToolRegistry()
    const realms = new ApplicationRealmManager(tools)
    const realm = realms.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'managed',
    })
    const runtime = new ArcaCapabilityRuntime(directory, handles, realm, localNodeId, arcaManifest)

    await runtime.start()
    expect(tools.has('arca_document_inspect')).toBe(false)

    const invoke = vi.fn(async () => ({ revisionId: 'revision-1' }))
    const offer: KernelCapabilityOffer = {
      offerId: 'arca-document@test',
      provider: {
        objectType: 'capability-provider',
        objectId: 'arca-document/provider' as KernelObjectId,
        generation: 1,
        ownerPrincipalId: 'application:infos.arca',
        authorityNodeId: providerNodeId,
        authorityEpoch: 1,
      },
      capabilityType: 'document.semantic',
      contractVersion: '1.0',
      operations,
      resourceKinds: ['document'],
      health: 'available',
      placement: {
        providerNodeId,
        providerFacet: 'capability',
        executionLocation: 'application-node',
        resourceAuthorityNodeId: providerNodeId,
        requiresClientPresence: false,
        supportsHeadless: true,
        dataResidency: 'node-local',
        latencyClass: 'local',
        costClass: 'free',
      },
    }
    const remove = directory.registerRemoteProvider(offer, invoke)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runtime.available()).toBe(true)
    expect(tools.has('arca_document_inspect')).toBe(true)
    expect(realms.isHostProjection('arca_document_inspect')).toBe(true)
    expect(realms.isPrivateTool('arca_document_inspect')).toBe(false)
    expect(tools.getDefinition('arca_changeset_propose')?.requiresApproval).toBe(true)

    remove()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runtime.available()).toBe(false)
    expect(tools.has('arca_document_inspect')).toBe(false)
    expect(realms.ownsTool('arca_document_inspect')).toBe(false)

    await runtime.stop()
    await realms.shutdown()
  })
})
