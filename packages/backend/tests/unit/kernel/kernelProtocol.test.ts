import { describe, expect, it } from 'vitest'
import {
  negotiateKernelProtocol,
  validateKernelEnvelope,
  validateKernelEventEnvelope,
  validateSurfaceFrame,
  validateVersionedMessage,
} from '@infos/shared'

describe('Kernel协议协商与Schema验证', () => {
  it('应选择双方支持的最高版本并拒绝无交集版本', () => {
    expect(negotiateKernelProtocol([0, 1])).toBe(1)
    expect(() => negotiateKernelProtocol([2, 3])).toThrow('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  })

  it('版本1应允许未知字段但拒绝缺失字段和未知主版本', () => {
    expect(() => validateVersionedMessage({ protocolVersion: 1, futureField: true })).not.toThrow()
    expect(() => validateVersionedMessage({ protocolVersion: 2 })).toThrow(
      'KERNEL_PROTOCOL_VERSION_UNSUPPORTED',
    )
    expect(() => validateVersionedMessage({})).toThrow('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  })

  it('Kernel Envelope应验证身份、时间、Durability和Payload上限', () => {
    const envelope = {
      protocolVersion: 1,
      messageId: 'message-1',
      principalId: 'pero',
      operation: 'test',
      emittedAt: new Date().toISOString(),
      durability: 'ephemeral',
      payload: { ok: true },
      futureField: '允许',
    }
    expect(() => validateKernelEnvelope(envelope)).not.toThrow()
    expect(() => validateKernelEnvelope({ ...envelope, messageId: '' })).toThrow(
      'PROTOCOL_FIELD_INVALID',
    )
    expect(() => validateKernelEnvelope({ ...envelope, emittedAt: 'invalid' })).toThrow(
      'KERNEL_ENVELOPE_TIME_INVALID',
    )
    expect(() => validateKernelEnvelope({ ...envelope, durability: 'unknown' })).toThrow(
      'KERNEL_ENVELOPE_DURABILITY_INVALID',
    )
  })

  it('Durable Event与Surface Frame应执行独立Schema校验', () => {
    expect(() =>
      validateKernelEventEnvelope({
        protocolVersion: 1,
        eventId: 'event-1',
        type: 'test.committed',
        principalId: 'pero',
        durability: 'durable',
        occurredAt: new Date().toISOString(),
        payload: {},
      }),
    ).not.toThrow()
    const frame = {
      protocolVersion: 1,
      surfaceId: 'surface-1',
      generation: 'generation-1',
      revision: 1,
      sequence: 1,
      operationId: 'operation-1',
      operation: { type: 'surface.open', threadId: 'thread-1', principalId: 'pero' },
    }
    expect(() => validateSurfaceFrame(frame)).not.toThrow()
    expect(() => validateSurfaceFrame({ ...frame, sequence: -1 })).toThrow(
      'SURFACE_FRAME_SEQUENCE_INVALID',
    )
    expect(() => validateSurfaceFrame({ ...frame, operation: { type: 'unknown' } })).toThrow(
      'SURFACE_OPERATION_INVALID',
    )
  })
})
