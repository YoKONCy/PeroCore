import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelEnvelope, KernelNodeId, KernelObjectId } from '@infos/shared'
import type { NodeInvokeRequest } from '@infos/node-sdk'
import { ArcaApplicationHost } from '@infos/arca'

const directories: string[] = []
function dataPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infos-arca-host-'))
  directories.push(directory)
  return directory
}

function request(input: {
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  operation: string
  value: unknown
  idempotencyKey?: string
}): NodeInvokeRequest {
  const envelope: KernelEnvelope<{ operation: string; input: unknown }> = {
    protocolVersion: 1,
    messageId: randomUUID(),
    principalId: 'principal:test',
    operation: input.operation,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    emittedAt: new Date().toISOString(),
    durability: 'durable',
    idempotencyKey: input.idempotencyKey,
    payload: { operation: input.operation, input: input.value },
  }
  return {
    protocolVersion: 1,
    type: 'invoke',
    messageId: randomUUID(),
    invocationId: randomUUID(),
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    providerId: 'infos.arca.document-authority',
    envelope,
  }
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('Arca Autonomous Host A5/A6', () => {
  it('应以 application/capability/storage Facet 发布 Document Offer', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    expect(host.nodeHost.identity.descriptor.facets).toEqual([
      'application',
      'capability',
      'storage',
    ])
    expect(host.nodeHost.hello().application).toEqual(
      expect.objectContaining({
        appId: 'infos.arca',
        instanceId: host.instanceId,
        endpoints: expect.arrayContaining([
          expect.objectContaining({ endpointId: 'collaboration', kind: 'task' }),
        ]),
      }),
    )
    expect(host.nodeHost.offers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityType: 'document.semantic',
          placement: expect.objectContaining({
            providerNodeId: host.nodeId,
            resourceAuthorityNodeId: host.nodeId,
            supportsHeadless: true,
          }),
        }),
        expect.objectContaining({
          capabilityType: 'model.settings',
          placement: expect.objectContaining({ providerNodeId: host.nodeId }),
        }),
      ]),
    )
    await host.stop()
  })

  it('应发布动态 Discovery Record 并在停止时按所有权移除', async () => {
    const directory = dataPath()
    const discoveryPath = join(directory, 'runtime', 'discovery.json')
    const host = new ArcaApplicationHost({ dataPath: directory, discoveryPath })
    const result = await host.start({ loopbackPort: 0 })
    const record = JSON.parse(readFileSync(discoveryPath, 'utf8')) as Record<string, unknown>
    expect(result.loopbackPort).toBeGreaterThan(0)
    expect(record).toEqual(
      expect.objectContaining({
        protocolVersion: 1,
        applicationProtocolVersion: 1,
        application: expect.objectContaining({
          appId: 'infos.arca',
          instanceId: host.instanceId,
        }),
        nodeId: host.nodeId,
        carrier: 'websocket',
        endpoint: `ws://127.0.0.1:${result.loopbackPort}`,
      }),
    )
    await host.stop()
    expect(existsSync(discoveryPath)).toBe(false)
  })

  it('只读 Surface Bootstrap 应返回稳定文档列表与领域投影', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const kernelNodeId = 'kernel-node' as KernelNodeId
    const transport = host.nodeHost.inMemoryTransport(kernelNodeId)
    const empty = await transport.request(
      request({
        sourceNodeId: kernelNodeId,
        targetNodeId: host.nodeId,
        operation: 'surface.bootstrap',
        value: {},
      }),
    )
    expect(empty.output).toEqual({
      documents: [],
      activeDocument: null,
      authorityState: 'unavailable',
    })
    await transport.request(
      request({
        sourceNodeId: kernelNodeId,
        targetNodeId: host.nodeId,
        operation: 'document.import_markdown',
        idempotencyKey: 'surface-import',
        value: {
          documentId: 'surface-document',
          ownerPrincipalId: 'owner',
          actorPrincipalId: 'human:tester',
          title: '只读工作站',
          markdown: '# 第一章\n\n这里是正文。',
          idempotencyKey: 'surface-import',
        },
      }),
    )
    const bootstrap = await transport.request(
      request({
        sourceNodeId: kernelNodeId,
        targetNodeId: host.nodeId,
        operation: 'surface.bootstrap',
        value: { documentId: 'surface-document' },
      }),
    )
    expect(bootstrap.output).toEqual(
      expect.objectContaining({
        documents: [expect.objectContaining({ title: '只读工作站' })],
        activeDocument: expect.objectContaining({
          snapshot: expect.objectContaining({ documentId: 'surface-document' }),
          outline: expect.objectContaining({ format: 'outline' }),
          markdown: expect.objectContaining({
            format: 'markdown',
            content: '# 第一章\n\n这里是正文。',
          }),
        }),
      }),
    )
    await transport.close()
    await host.stop()
  })

  it('Kernel 应通过 NodeTransport 完成 Markdown 导入和投影', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const kernelNodeId = 'kernel-node' as KernelNodeId
    const transport = host.nodeHost.inMemoryTransport(kernelNodeId)
    const documentId = 'transport-document' as unknown as KernelObjectId
    const imported = await transport.request(
      request({
        sourceNodeId: kernelNodeId,
        targetNodeId: host.nodeId,
        operation: 'document.import_markdown',
        idempotencyKey: 'transport-import',
        value: {
          documentId,
          authorityNodeId: 'forged-node',
          ownerPrincipalId: 'owner',
          actorPrincipalId: 'agent:writer',
          title: 'Transport',
          markdown: '# 标题\n\n正文',
          idempotencyKey: 'transport-import',
        },
      }),
    )
    expect(imported.state).toBe('completed')
    expect(host.documents.inspect(documentId as never).document.authorityNodeId).toBe(host.nodeId)
    const projected = await transport.request(
      request({
        sourceNodeId: kernelNodeId,
        targetNodeId: host.nodeId,
        operation: 'document.project_markdown',
        value: { documentId },
      }),
    )
    expect(projected.state).toBe('completed')
    expect(projected.output).toEqual(expect.objectContaining({ content: '# 标题\n\n正文' }))
    await transport.close()
    await host.stop()
  })

  it('Host 重启后应保持稳定 Node Identity 和 Document Authority', async () => {
    const directory = dataPath()
    const first = new ArcaApplicationHost({ dataPath: directory })
    await first.start()
    const nodeId = first.nodeId
    const transport = first.nodeHost.inMemoryTransport('kernel-node' as KernelNodeId)
    await transport.request(
      request({
        sourceNodeId: 'kernel-node' as KernelNodeId,
        targetNodeId: first.nodeId,
        operation: 'document.import_markdown',
        idempotencyKey: 'restart-import',
        value: {
          documentId: 'restart-document',
          authorityNodeId: first.nodeId,
          ownerPrincipalId: 'owner',
          actorPrincipalId: 'agent:writer',
          title: '重启',
          markdown: '持久正文',
          idempotencyKey: 'restart-import',
        },
      }),
    )
    await transport.close()
    await first.stop()

    const second = new ArcaApplicationHost({ dataPath: directory })
    await second.start()
    expect(second.nodeId).toBe(nodeId)
    const restored = second.documents.inspect('restart-document' as never)
    expect(restored.document.authorityNodeId).toBe(nodeId)
    expect(second.documents.projectPlainText(restored.documentId).content).toBe('持久正文')
    await second.stop()
  })

  it('Outbox Dispatcher 应按序发布并在失败处停止', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    host.documents.createDocument({
      authorityNodeId: host.nodeId,
      ownerPrincipalId: 'owner',
      title: 'Outbox',
    })
    const pending = host.documents.listPendingOutbox()
    const seen: string[] = []
    const failed = await host.publishOutbox(async (event) => {
      seen.push(event.eventId)
      throw new Error('联邦暂不可用')
    })
    expect(failed).toEqual({ published: 0, failedEventId: pending[0]!.eventId })
    expect(host.documents.listPendingOutbox()).toHaveLength(1)
    const success = await host.publishOutbox(async (event) => {
      seen.push(event.eventId)
    })
    expect(success).toEqual({ published: 1 })
    expect(host.documents.listPendingOutbox()).toEqual([])
    await host.stop()
  })
})
