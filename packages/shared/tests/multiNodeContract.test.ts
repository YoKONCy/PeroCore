import { describe, expect, it } from 'vitest'
import { GATEWAY_ACTION_CATALOG, gatewayActionPolicy, validateKernelEnvelope } from '../src'
import type { DeliveryAudience, KernelEnvelope, KernelNodeId } from '../src'

describe('多节点共享契约', () => {
  it('每个 Gateway 业务 Action 都必须声明 durability、audience 和恢复来源', () => {
    for (const [action, policy] of Object.entries(GATEWAY_ACTION_CATALOG)) {
      expect(action).not.toBe('')
      expect(['durable', 'ephemeral']).toContain(policy.durability)
      expect(policy.audience).not.toBe('')
      expect(policy.recovery).not.toBe('')
    }
    expect(gatewayActionPolicy('audio_chunk').audience).toBe('specific_node')
    expect(gatewayActionPolicy('tool_approval_requested').durability).toBe('durable')
  })

  it('统一 Kernel Envelope 应携带显式 Audience 与 Stream Sequence', () => {
    const audience: DeliveryAudience = {
      type: 'thread_subscribers',
      threadId: 'thread-main',
    }
    const envelope: KernelEnvelope<{ action: 'proactive_message' }> = {
      protocolVersion: 1,
      messageId: 'message-1',
      correlationId: 'correlation-1',
      principalId: 'principal-1',
      operation: 'proactive_message',
      sourceNodeId: 'server-1' as KernelNodeId,
      emittedAt: '2026-08-28T00:00:00.000Z',
      durability: 'durable',
      audience,
      sequence: 1,
      payload: { action: 'proactive_message' },
    }

    expect(() => validateKernelEnvelope(envelope)).not.toThrow()
    expect(envelope.audience).toEqual(audience)
  })
})
