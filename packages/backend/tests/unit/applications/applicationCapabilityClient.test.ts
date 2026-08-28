import { describe, expect, it, vi } from 'vitest'
import type { KernelNodeId, KernelObjectId } from '@infos/shared'
import { ApplicationCapabilityClient } from '../../../src/applications/applicationCapabilityClient'
import { CapabilityDirectory } from '../../../src/kernel/capabilityDirectory'
import { CapabilityHandleRegistry } from '../../../src/kernel/capabilityHandleRegistry'

const kernelNodeId = 'kernel-node' as KernelNodeId
const appNodeId = 'arca-node' as KernelNodeId

describe('ApplicationCapabilityClient', () => {
  it('应为Application Principal签发收窄Handle并通过Bound Port调用', async () => {
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles)
    directory.registerDefinition({
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: { read: { risk: 'read', idempotency: 'safe' } },
    })
    const invoke = vi.fn(async () => ({ displayName: 'Pero' }))
    directory.registerProvider(
      {
        offerId: 'persona',
        provider: {
          objectType: 'kernel-application-port',
          objectId: 'kernel-node/persona' as KernelObjectId,
          generation: 1,
          ownerPrincipalId: 'system',
          authorityNodeId: kernelNodeId,
          authorityEpoch: 1,
        },
        capabilityType: 'infos.persona',
        contractVersion: '1.0',
        operations: ['read'],
        resourceKinds: ['infos.persona'],
        health: 'available',
      },
      invoke,
    )
    const client = new ApplicationCapabilityClient(
      'application:infos.arca:managed',
      appNodeId,
      kernelNodeId,
      directory,
      handles,
    )
    const port = client.bind({
      capabilityType: 'infos.persona',
      contractVersion: '1.0',
      operations: ['read'],
      required: true,
      reason: '协作人格',
    })!
    await expect(
      port.invoke('read', { agentId: 'pero' }, { principalId: 'forged', correlationId: 'one' }),
    ).resolves.toEqual({ displayName: 'Pero' })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'application:infos.arca:managed',
        sourceNodeId: appNodeId,
        capabilityHandleId: expect.any(String),
      }),
    )
    await client.dispose()
    await expect(
      port.invoke('read', { agentId: 'pero' }, { principalId: 'forged', correlationId: 'two' }),
    ).rejects.toThrow('CAPABILITY_PORT_CLOSED')
  })

  it('可选Capability缺失时应返回undefined，必需Capability应失败', async () => {
    const client = new ApplicationCapabilityClient(
      'application:test:one',
      appNodeId,
      kernelNodeId,
      new CapabilityDirectory(new CapabilityHandleRegistry()),
      new CapabilityHandleRegistry(),
    )
    const requirement = {
      capabilityType: 'infos.knowledge',
      contractVersion: '1.0',
      operations: ['query'],
      required: false,
      reason: '知识检索',
    }
    expect(client.bind(requirement)).toBeUndefined()
    expect(() => client.bind({ ...requirement, required: true })).toThrow(
      'APPLICATION_CAPABILITY_UNAVAILABLE',
    )
    await client.dispose()
  })
})
