import { describe, expect, it, vi } from 'vitest'
import type { KernelNodeId, KernelObjectId } from '@infos/shared'
import { ApplicationResourceAccessService } from '../../../src/applications/applicationResourceAccessService'
import { CapabilityDirectory } from '../../../src/kernel/capabilityDirectory'
import { CapabilityHandleRegistry } from '../../../src/kernel/capabilityHandleRegistry'

describe('ApplicationResourceAccessService', () => {
  it('没有资源Grant时必须在签发Capability Handle前拒绝', async () => {
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles)
    directory.registerDefinition({
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: { read: { risk: 'read', idempotency: 'safe' } },
    })
    directory.registerProvider(
      {
        offerId: 'persona',
        provider: {
          objectType: 'persona',
          objectId: 'persona/pero' as KernelObjectId,
          generation: 1,
          ownerPrincipalId: 'pero',
        },
        capabilityType: 'infos.persona',
        contractVersion: '1.0',
        operations: ['read'],
        resourceKinds: ['persona'],
        health: 'available',
      },
      vi.fn(async () => ({ displayName: 'Pero' })),
    )
    const grants = { queryGrants: vi.fn(async () => []) }
    const service = new ApplicationResourceAccessService(
      'kernel-node' as KernelNodeId,
      directory,
      handles,
      grants as never,
    )
    await expect(
      service.invoke({
        appId: 'infos.arca',
        instanceId: 'managed',
        appNodeId: 'arca-node' as KernelNodeId,
        requirement: {
          capabilityType: 'infos.persona',
          contractVersion: '1.0',
          operations: ['read'],
          required: true,
          reason: '文档协作人格',
        },
        operation: 'read',
        value: { agentId: 'pero' },
        context: { correlationId: 'denied' },
      }),
    ).rejects.toThrow('APPLICATION_CAPABILITY_GRANT_REQUIRED')
  })

  it('匹配Agent和权限的Grant应允许一次受控调用', async () => {
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles)
    directory.registerDefinition({
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: { read: { risk: 'read', idempotency: 'safe' } },
    })
    directory.registerProvider(
      {
        offerId: 'persona',
        provider: {
          objectType: 'persona',
          objectId: 'persona/pero' as KernelObjectId,
          generation: 1,
          ownerPrincipalId: 'pero',
        },
        capabilityType: 'infos.persona',
        contractVersion: '1.0',
        operations: ['read'],
        resourceKinds: ['persona'],
        health: 'available',
      },
      vi.fn(async () => ({ displayName: 'Pero' })),
    )
    const service = new ApplicationResourceAccessService(
      'kernel-node' as KernelNodeId,
      directory,
      handles,
      {
        queryGrants: vi.fn(async () => [
          {
            resource: { kind: 'persona', agentId: 'pero', allowAppPatch: false },
            permissions: ['read'],
          },
        ]),
      } as never,
    )
    await expect(
      service.invoke({
        appId: 'infos.arca',
        instanceId: 'managed',
        appNodeId: 'arca-node' as KernelNodeId,
        requirement: {
          capabilityType: 'infos.persona',
          contractVersion: '1.0',
          operations: ['read'],
          required: true,
          reason: '文档协作人格',
        },
        operation: 'read',
        value: { agentId: 'pero' },
        context: { correlationId: 'allowed' },
      }),
    ).resolves.toEqual({ displayName: 'Pero' })
  })
})
