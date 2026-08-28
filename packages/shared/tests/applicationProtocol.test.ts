import { describe, expect, it } from 'vitest'
import type { ApplicationDiscoveryRecord, KernelNodeId } from '../src'
import {
  defineApplicationAdapter,
  validateApplicationDescriptor,
  validateApplicationDiscovery,
  validateApplicationEnvelope,
} from '../../node-sdk/src'

function discovery(): ApplicationDiscoveryRecord {
  return {
    protocolVersion: 1,
    applicationProtocolVersion: 1,
    application: {
      protocolVersion: 1,
      appId: 'infos.arca',
      instanceId: 'arca-instance',
      name: 'Arca',
      appVersion: '1.0.0',
      adapterVersion: '1.0.0',
      state: 'ready',
      endpoints: [
        {
          endpointId: 'collaboration',
          kind: 'task',
          version: '1.0',
          operations: ['task.submit', 'task.get', 'task.cancel'],
        },
      ],
    },
    nodeId: 'arca-node' as KernelNodeId,
    pid: process.pid,
    generation: 1,
    carrier: 'websocket',
    endpoint: 'ws://127.0.0.1:7361',
    startedAt: new Date().toISOString(),
  }
}

describe('Application Integration Protocol', () => {
  it('应校验并冻结贡献者Adapter Manifest', () => {
    const manifest = defineApplicationAdapter({
      manifestVersion: 1,
      id: 'community.example',
      name: 'Example',
      description: '示例适配器',
      adapterVersion: '1.0.0',
      protocolVersion: 1,
      application: { versions: '>=1', transports: ['websocket'] },
      endpoints: [
        { endpointId: 'task', kind: 'task', version: '1.0', operations: ['task.submit'] },
      ],
      requestedCapabilities: [
        {
          capabilityType: 'infos.persona',
          contractVersion: '1.0',
          operations: ['read'],
          required: false,
          reason: '读取人格',
        },
      ],
    })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(() =>
      defineApplicationAdapter({
        ...manifest,
        requestedCapabilities: [
          ...manifest.requestedCapabilities,
          manifest.requestedCapabilities[0]!,
        ],
      }),
    ).toThrow('APPLICATION_CAPABILITY_DUPLICATED')
  })
  it('应接受合法的Application Descriptor与Discovery', () => {
    const value = discovery()
    expect(validateApplicationDescriptor(value.application)).toBe(value.application)
    expect(validateApplicationDiscovery(value)).toBe(value)
  })

  it('应拒绝重复Endpoint和非回环Discovery', () => {
    const duplicate = discovery()
    duplicate.application = {
      ...duplicate.application,
      endpoints: [duplicate.application.endpoints[0]!, duplicate.application.endpoints[0]!],
    }
    expect(() => validateApplicationDiscovery(duplicate)).toThrow('APPLICATION_ENDPOINT_DUPLICATED')

    const remote = discovery()
    remote.endpoint = 'ws://192.168.1.10:7361'
    expect(() => validateApplicationDiscovery(remote)).toThrow(
      'APPLICATION_DISCOVERY_ENDPOINT_FORBIDDEN',
    )
  })

  it('Envelope的因果信息不得隐含生命周期父子关系', () => {
    const envelope = validateApplicationEnvelope({
      protocolVersion: 1,
      messageId: 'message-1',
      correlationId: 'correlation-1',
      causationId: 'agent-execution-1',
      source: {
        nodeId: 'kernel-node' as KernelNodeId,
        appId: 'infos.kernel',
        instanceId: 'kernel',
      },
      target: {
        nodeId: 'arca-node' as KernelNodeId,
        appId: 'infos.arca',
        instanceId: 'arca-instance',
        endpoint: 'collaboration',
      },
      operation: 'task.submit',
      mode: 'request',
      payload: {},
      trace: { taskId: 'arca-task-1' },
    })

    expect(envelope.causationId).toBe('agent-execution-1')
    expect(envelope.trace).not.toHaveProperty('parentExecutionId')
  })
})
