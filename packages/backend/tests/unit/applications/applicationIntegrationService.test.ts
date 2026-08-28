import { describe, expect, it, vi } from 'vitest'
import type { ApplicationAdapterManifest, KernelNodeId } from '@infos/shared'
import { ApplicationIntegrationService } from '../../../src/applications/applicationIntegrationService'

const manifest: ApplicationAdapterManifest = {
  manifestVersion: 1,
  id: 'infos.arca',
  name: 'Arca',
  description: '文档工作站',
  adapterVersion: '1.0.0',
  protocolVersion: 1,
  application: { versions: '>=1', transports: ['websocket'] },
  endpoints: [],
  offeredCapabilities: [],
  requestedCapabilities: [
    {
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: ['read'],
      required: false,
      reason: '读取授权人格',
    },
  ],
}

describe('ApplicationIntegrationService', () => {
  it('应只按Manifest声明和当前实例创建Grant并调用统一能力入口', async () => {
    const grants = {
      grant: vi.fn(async () => 'grant-1'),
      queryGrants: vi.fn(async () => [
        {
          id: 'grant-1',
          holderId: 'arca-instance',
          resource: { kind: 'persona', agentId: 'pero', allowAppPatch: false },
          permissions: ['read'],
        },
      ]),
      revoke: vi.fn(async () => true),
    }
    const resources = { invoke: vi.fn(async () => ({ displayName: 'Pero' })) }
    const service = new ApplicationIntegrationService(grants as never, resources as never)
    service.register(manifest, () => ({
      instanceId: 'arca-instance',
      nodeId: 'arca-node' as KernelNodeId,
    }))

    await expect(
      service.grant({
        appId: 'infos.arca',
        ownerAgentId: 'pero',
        capabilityType: 'infos.persona',
        resource: { kind: 'persona', agentId: 'pero', allowAppPatch: false },
        permissions: ['read'],
      }),
    ).resolves.toBe('grant-1')
    await expect(
      service.invoke({
        appId: 'infos.arca',
        capabilityType: 'infos.persona',
        operation: 'read',
        value: { agentId: 'pero' },
        context: { correlationId: 'integration-test' },
      }),
    ).resolves.toEqual({ displayName: 'Pero' })

    expect(grants.grant).toHaveBeenCalledWith(
      expect.objectContaining({ holderId: 'arca-instance', holderType: 'app' }),
    )
    expect(resources.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'infos.arca',
        instanceId: 'arca-instance',
        appNodeId: 'arca-node',
        operation: 'read',
      }),
    )
    await expect(service.revoke('infos.arca', 'grant-1')).resolves.toBe(true)
    expect(grants.revoke).toHaveBeenCalledWith('grant-1')
  })

  it.each([
    {
      expected: 'APPLICATION_OFFER_ENDPOINT_UNDECLARED',
      patch: {
        offeredCapabilities: [
          {
            capabilityType: 'document.semantic',
            contractVersion: '1.0',
            endpointId: 'missing',
            operations: ['document.inspect'],
          },
        ],
      },
    },
    {
      expected: 'APPLICATION_OFFER_OPERATION_UNDECLARED',
      patch: {
        endpoints: [
          { endpointId: 'document', kind: 'resource' as const, version: '1.0', operations: [] },
        ],
        offeredCapabilities: [
          {
            capabilityType: 'document.semantic',
            contractVersion: '1.0',
            endpointId: 'document',
            operations: ['document.inspect'],
          },
        ],
      },
    },
    {
      expected: 'APPLICATION_TOOL_OPERATION_NOT_OFFERED',
      patch: {
        endpoints: [
          {
            endpointId: 'document',
            kind: 'resource' as const,
            version: '1.0',
            operations: ['document.inspect'],
          },
        ],
        offeredCapabilities: [],
        toolProjections: [
          {
            name: 'arca_document_inspect',
            endpointId: 'document',
            operation: 'document.inspect',
            audience: 'host_agent' as const,
            availability: 'while_ready' as const,
            invocation: 'invoke' as const,
            description: '读取文档',
            parameters: { type: 'object' },
          },
        ],
      },
    },
  ])('应拒绝不一致的Manifest声明：$expected', ({ patch, expected }) => {
    const service = new ApplicationIntegrationService(
      { grant: vi.fn() } as never,
      { invoke: vi.fn() } as never,
    )

    expect(() =>
      service.register({ ...manifest, ...patch }, () => ({
        instanceId: 'arca-instance',
        nodeId: 'arca-node' as KernelNodeId,
      })),
    ).toThrow(expected)
  })

  it('应拒绝Manifest未声明的能力和资源类型错配', async () => {
    const service = new ApplicationIntegrationService(
      { grant: vi.fn() } as never,
      { invoke: vi.fn() } as never,
    )
    service.register(manifest, () => ({
      instanceId: 'arca-instance',
      nodeId: 'arca-node' as KernelNodeId,
    }))

    await expect(
      service.invoke({
        appId: 'infos.arca',
        capabilityType: 'infos.model',
        operation: 'generate',
        value: {},
        context: { correlationId: 'undeclared' },
      }),
    ).rejects.toThrow('APPLICATION_CAPABILITY_UNDECLARED')
    await expect(
      service.grant({
        appId: 'infos.arca',
        ownerAgentId: 'pero',
        capabilityType: 'infos.persona',
        resource: { kind: 'model' },
        permissions: ['read'],
      }),
    ).rejects.toThrow('APPLICATION_GRANT_RESOURCE_MISMATCH')
  })
})
