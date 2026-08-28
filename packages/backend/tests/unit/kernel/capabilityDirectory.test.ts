import { describe, expect, it, vi } from 'vitest'
import type {
  KernelCapabilityId,
  KernelCapabilityRequirement,
  KernelExecutionId,
  KernelObjectId,
  KernelProcessId,
} from '@infos/shared'
import {
  CapabilityDirectory,
  CapabilityHandleRegistry,
  LifecycleScope,
} from '@infos/backend/kernel'

const provider = {
  objectType: 'package-provider',
  objectId: 'package.text-provider' as KernelObjectId,
  generation: 1,
  ownerPrincipalId: 'system',
}
const requirement: KernelCapabilityRequirement = {
  requirementId: 'consumer.format',
  capabilityType: 'text.format',
  contractVersion: '1.0',
  operations: ['uppercase'],
  required: true,
  binding: 'eager',
  cardinality: 'one',
}

describe('Capability 用户空间调用', () => {
  it('两个 Package 应只通过 Bound Port 与 Handle 互调', async () => {
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles)
    directory.registerDefinition({
      capabilityType: 'text.format',
      contractVersion: '1.0',
      operations: { uppercase: { risk: 'read', idempotency: 'safe' } },
    })
    const invoke = vi.fn(async (envelope) => {
      const payload = envelope.payload as { input: { text: string } }
      return { text: payload.input.text.toUpperCase(), executionId: envelope.executionId }
    })
    directory.registerProvider(
      {
        offerId: 'offer.text-provider',
        provider,
        capabilityType: 'text.format',
        contractVersion: '1.0',
        operations: ['uppercase'],
        resourceKinds: ['text'],
        health: 'available',
      },
      invoke,
    )
    const handle = handles.issue({
      subjectId: 'package.text-consumer',
      resource: provider,
      operations: ['uppercase'],
      revocable: true,
    })
    const scope = new LifecycleScope('package.text-consumer')
    const port = directory.bind({ requirement, handleId: handle.handleId, scope })
    const output = await port.invoke<{ text: string }, { text: string; executionId?: string }>(
      'uppercase',
      { text: 'infOS' },
      {
        principalId: 'pero',
        processId: 'process-consumer' as KernelProcessId,
        executionId: 'execution-consumer' as KernelExecutionId,
        correlationId: 'correlation-1',
      },
    )

    expect(output).toEqual({ text: 'INFOS', executionId: 'execution-consumer' })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'text.format/uppercase',
        capabilityHandleId: handle.handleId,
        correlationId: 'correlation-1',
      }),
    )
    await scope.dispose()
    await expect(
      port.invoke('uppercase', { text: 'closed' }, { principalId: 'pero', correlationId: 'c2' }),
    ).rejects.toThrow('Port 已释放')
  })

  it('应拒绝越权、过期 Deadline 与离线 Provider', async () => {
    const handles = new CapabilityHandleRegistry()
    const directory = new CapabilityDirectory(handles)
    directory.registerDefinition({
      capabilityType: 'text.format',
      contractVersion: '1.0',
      operations: { uppercase: { risk: 'read', idempotency: 'safe' } },
    })
    const unregister = directory.registerProvider(
      {
        offerId: 'offer.text-provider',
        provider,
        capabilityType: 'text.format',
        contractVersion: '1.0',
        operations: ['uppercase'],
        resourceKinds: ['text'],
        health: 'available',
      },
      async () => ({ ok: true }),
    )
    const denied = handles.issue({
      subjectId: 'package.consumer',
      resource: provider,
      operations: [],
      revocable: true,
    })
    const scope = new LifecycleScope('consumer')
    const port = directory.bind({ requirement, handleId: denied.handleId, scope })
    await expect(
      port.invoke('uppercase', {}, { principalId: 'pero', correlationId: 'denied' }),
    ).rejects.toThrow('CAPABILITY_DENIED')

    const allowed = handles.issue({
      subjectId: 'package.consumer',
      resource: provider,
      operations: ['uppercase'],
      revocable: true,
    })
    const active = directory.bind({ requirement, handleId: allowed.handleId, scope })
    await expect(
      active.invoke(
        'uppercase',
        {},
        {
          principalId: 'pero',
          correlationId: 'expired',
          deadline: '2000-01-01T00:00:00.000Z',
        },
      ),
    ).rejects.toThrow('KERNEL_DEADLINE_EXCEEDED')
    unregister()
    await expect(
      active.invoke('uppercase', {}, { principalId: 'pero', correlationId: 'offline' }),
    ).rejects.toThrow('Provider 已离线')
    expect(handles.get('missing' as KernelCapabilityId)).toBeNull()
  })
})
