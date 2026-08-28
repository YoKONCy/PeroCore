import { describe, expect, it } from 'vitest'
import type { KernelObjectId } from '@infos/shared'
import { InMemoryRuntimeAdapter } from '@infos/backend/runtime'

const runtime = {
  objectType: 'test-runtime',
  objectId: 'runtime-1' as KernelObjectId,
  generation: 1,
  ownerPrincipalId: 'system',
}

describe('RuntimeAdapter 状态机', () => {
  it('应在替换状态后提升 generation 并拒绝旧句柄', async () => {
    const adapter = new InMemoryRuntimeAdapter(runtime, { value: 1 })
    const result = await adapter.execute(
      {
        callId: 'call-1',
        target: runtime,
        operation: 'replace',
        input: { value: 2 },
        expectedGeneration: 1,
      },
      { principalId: 'pero', correlationId: 'runtime-1' },
    )
    expect(result.generation).toBe(2)
    await expect(
      adapter.execute(
        {
          callId: 'call-2',
          target: runtime,
          operation: 'merge',
          input: { extra: true },
          expectedGeneration: 1,
        },
        { principalId: 'pero', correlationId: 'runtime-2' },
      ),
    ).rejects.toThrow('RUNTIME_STALE_HANDLE')
  })

  it('应支持取消和 Deadline', async () => {
    const adapter = new InMemoryRuntimeAdapter(runtime, { value: 1 })
    await adapter.cancel('cancelled')
    await expect(
      adapter.execute(
        {
          callId: 'cancelled',
          target: runtime,
          operation: 'merge',
          input: {},
          expectedGeneration: 1,
        },
        { principalId: 'pero', correlationId: 'cancelled' },
      ),
    ).rejects.toThrow('RUNTIME_CALL_CANCELLED')
    await expect(
      adapter.execute(
        {
          callId: 'expired',
          target: runtime,
          operation: 'merge',
          input: {},
          expectedGeneration: 1,
        },
        {
          principalId: 'pero',
          correlationId: 'expired',
          deadline: '2000-01-01T00:00:00.000Z',
        },
      ),
    ).rejects.toThrow('KERNEL_DEADLINE_EXCEEDED')
  })
})
