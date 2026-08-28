import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import type { NodeInvokeRequest } from '@infos/node-sdk'
import type { DocumentId, DocumentNodeId, OperationId } from '@infos/document-engine'
import { ArcaApplicationHost } from '@infos/arca'

const directories: string[] = []
function dataPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infos-arca-collaboration-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

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
    durability: 'ephemeral',
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

async function invoke(host: ArcaApplicationHost, operation: string, value: unknown, key?: string) {
  const clientNodeId = 'arca-client-test' as KernelNodeId
  const transport = host.nodeHost.inMemoryTransport(clientNodeId)
  const receipt = await transport.request(
    request({
      sourceNodeId: clientNodeId,
      targetNodeId: host.nodeId,
      operation,
      value,
      idempotencyKey: key,
    }),
  )
  await transport.close()
  return receipt
}

async function session(host: ArcaApplicationHost) {
  const challenge = await invoke(host, 'surface.session.challenge', {
    clientNodeId: 'arca-client-test',
    principalId: 'human:tester',
  })
  const value = challenge.output as { challengeId: string; nonce: string }
  const completed = await invoke(host, 'surface.session.complete', {
    ...value,
    clientNodeId: 'arca-client-test',
    principalId: 'human:tester',
  })
  return completed.output as { token: string; principalId: string }
}

async function setupDocument(host: ArcaApplicationHost) {
  await invoke(
    host,
    'document.import_markdown',
    {
      documentId: 'document-collaboration',
      ownerPrincipalId: 'owner',
      actorPrincipalId: 'human:owner',
      title: '协作生命周期',
      markdown: '# 标题\n\n旧正文',
      idempotencyKey: 'import-collaboration',
    },
    'import-collaboration',
  )
  const snapshot = host.documents.inspect('document-collaboration' as DocumentId)
  const paragraph = snapshot.nodes.find((node) => node.type === 'paragraph')!
  return { snapshot, paragraph }
}

describe('Arca 文档协作生命周期', () => {
  it('无 Surface Session 不得执行 Human Edit', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const result = await invoke(
      host,
      'document.edit_text',
      {
        documentId: snapshot.documentId,
        nodeId: paragraph.nodeId,
        expectedGeneration: paragraph.generation,
        baseRevisionId: snapshot.revisionId,
        transactionId: 'tx-no-session',
        value: '非法正文',
      },
      'tx-no-session',
    )
    expect(result.state).toBe('failed')
    expect(result.error?.message).toContain('SURFACE_SESSION_REQUIRED')
    expect(
      host.documents
        .inspect(snapshot.documentId)
        .nodes.find((node) => node.nodeId === paragraph.nodeId)?.text,
    ).toBe('旧正文')
    await host.stop()
  })

  it('Human Edit 应绑定 Session Principal 并产生 Revision Receipt', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const surface = await session(host)
    const result = await invoke(
      host,
      'document.edit_text',
      {
        documentId: snapshot.documentId,
        nodeId: paragraph.nodeId,
        expectedGeneration: paragraph.generation,
        baseRevisionId: snapshot.revisionId,
        actorPrincipalId: 'human:forged',
        transactionId: 'tx-human-edit',
        value: '新正文',
        surfaceSessionToken: surface.token,
      },
      'tx-human-edit',
    )
    expect(result.state).toBe('completed')
    expect(result.output).toEqual(
      expect.objectContaining({ actorPrincipalId: 'human:tester', status: 'committed' }),
    )
    expect(
      host.documents
        .inspect(snapshot.documentId)
        .nodes.find((node) => node.nodeId === paragraph.nodeId)?.text,
    ).toBe('新正文')
    await host.stop()
  })

  it('受限Surface结构操作必须绑定Session并产生可审计Revision', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const withoutSession = await invoke(
      host,
      'document.rename',
      { documentId: snapshot.documentId, title: '非法标题' },
      'rename-without-session',
    )
    expect(withoutSession.state).toBe('failed')
    expect(withoutSession.error?.message).toContain('SURFACE_SESSION_REQUIRED')

    const surface = await session(host)
    const inserted = await invoke(
      host,
      'document.node.insert',
      {
        documentId: snapshot.documentId,
        surfaceSessionToken: surface.token,
        nodeId: 'surface-paragraph',
        type: 'paragraph',
        parentId: paragraph.parentId,
        parentGeneration: snapshot.nodes.find((node) => node.nodeId === paragraph.parentId)!
          .generation,
        orderKey: 'zzzz',
        text: '结构正文',
      },
      'surface-insert',
    )
    expect(inserted.output).toEqual(
      expect.objectContaining({ actorPrincipalId: 'human:tester', status: 'committed' }),
    )
    const afterInsert = host.documents.inspect(snapshot.documentId)
    const created = afterInsert.nodes.find(
      (node) => node.nodeId === ('surface-paragraph' as DocumentNodeId),
    )!
    const renamed = await invoke(
      host,
      'document.rename',
      {
        documentId: snapshot.documentId,
        surfaceSessionToken: surface.token,
        title: '结构编辑完成',
      },
      'surface-rename',
    )
    expect(renamed.state).toBe('completed')
    const afterRename = host.documents.inspect(snapshot.documentId)
    const parent = afterRename.nodes.find((node) => node.nodeId === created.parentId)!
    const deleted = await invoke(
      host,
      'document.node.delete',
      {
        documentId: snapshot.documentId,
        surfaceSessionToken: surface.token,
        nodeId: created.nodeId,
        expectedGeneration: created.generation,
        recursive: true,
      },
      'surface-delete',
    )
    expect(deleted.state).toBe('completed')
    expect(host.documents.inspect(snapshot.documentId).document.title).toBe('结构编辑完成')
    expect(
      host.documents
        .inspect(snapshot.documentId)
        .nodes.some((node) => node.nodeId === created.nodeId),
    ).toBe(false)
    expect(parent.generation).toBeGreaterThan(0)

    const revisions = await invoke(host, 'document.revision.list', {
      documentId: snapshot.documentId,
    })
    expect(revisions.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revision: expect.objectContaining({ actorPrincipalId: 'human:tester' }),
        }),
      ]),
    )
    await host.stop()
  })

  it('A9 Agent Scene 与 Context Region 应携带 Authority Provenance', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const scene = await invoke(host, 'document.agent_scene', {
      documentId: snapshot.documentId,
      currentNodeId: paragraph.nodeId,
    })
    expect(scene.output).toEqual(
      expect.objectContaining({
        revisionId: snapshot.revisionId,
        currentNode: expect.objectContaining({ nodeId: paragraph.nodeId }),
      }),
    )
    const regions = await invoke(host, 'document.context_regions', {
      documentId: snapshot.documentId,
      currentNodeId: paragraph.nodeId,
    })
    expect(regions.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trust: 'authority',
          contentHash: expect.any(String),
          sourceObjectRefs: [expect.objectContaining({ authorityNodeId: host.nodeId })],
        }),
      ]),
    )
    await host.stop()
  })

  it('A10 Semantic Diff 应确定性描述 Agent ChangeSet 并跨重启恢复', async () => {
    const directory = dataPath()
    const first = new ArcaApplicationHost({ dataPath: directory })
    await first.start()
    const { snapshot, paragraph } = await setupDocument(first)
    const proposed = await invoke(
      first,
      'document.changeset.propose',
      {
        changeSetId: 'changeset-a10',
        documentId: snapshot.documentId,
        baseRevisionId: snapshot.revisionId,
        actorPrincipalId: 'agent:writer',
        actorKind: 'agent',
        intent: '重写正文',
        explanation: '提高可读性',
        risk: 'medium',
        operations: [
          {
            operationId: 'operation-a10' as OperationId,
            documentId: snapshot.documentId,
            actorPrincipalId: 'agent:writer',
            baseRevisionId: snapshot.revisionId,
            timestamp: '2026-08-18T00:00:00.000Z',
            type: 'text.replace',
            nodeId: paragraph.nodeId,
            expectedGeneration: paragraph.generation,
            value: 'Agent 新正文',
          },
        ],
      },
      'propose-a10',
    )
    expect(proposed.state).toBe('completed')
    await invoke(
      first,
      'document.changeset.validate',
      { changeSetId: 'changeset-a10' },
      'validate-a10',
    )
    const diff = await invoke(first, 'document.changeset.diff', { changeSetId: 'changeset-a10' })
    expect(diff.output).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ changedTextNodes: 1 }),
        textChanges: [{ nodeId: paragraph.nodeId, before: '旧正文', after: 'Agent 新正文' }],
      }),
    )
    const surface = await session(first)
    await invoke(
      first,
      'document.changeset.review',
      { changeSetId: 'changeset-a10', decision: 'approve', surfaceSessionToken: surface.token },
      'review-a10',
    )
    await invoke(
      first,
      'document.changeset.commit',
      { changeSetId: 'changeset-a10', surfaceSessionToken: surface.token },
      'commit-a10',
    )
    await first.stop()

    const second = new ArcaApplicationHost({ dataPath: directory })
    await second.start()
    const restored = second.documents.diffChangeSet('changeset-a10' as never)
    expect(restored.toRevisionId).toBe(second.documents.inspect(snapshot.documentId).revisionId)
    expect(restored.textChanges[0]?.before).toBe('旧正文')
    await second.stop()
  })

  it('高级能力 ABI 应保持 Session、Projection 与 Package 边界', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const surface = await session(host)

    const comment = await invoke(
      host,
      'document.comment.create',
      {
        documentId: snapshot.documentId,
        nodeId: paragraph.nodeId,
        revisionId: snapshot.revisionId,
        body: '领域评论',
        authorPrincipalId: 'human:forged',
        surfaceSessionToken: surface.token,
      },
      'comment-create',
    )
    expect(comment.output).toEqual(
      expect.objectContaining({ authorPrincipalId: 'human:tester', status: 'open' }),
    )
    const presentation = await invoke(host, 'document.project_presentation', {
      documentId: snapshot.documentId,
    })
    expect(presentation.output).toEqual(
      expect.objectContaining({ format: 'presentation', contentHash: expect.any(String) }),
    )
    const exported = await invoke(host, 'project.package.export', {
      title: '工程包',
      documentIds: [snapshot.documentId],
      historyMode: 'full',
    })
    expect(exported.output).toEqual(
      expect.objectContaining({ base64: expect.any(String), byteLength: expect.any(Number) }),
    )
    const merge = await invoke(
      host,
      'document.collaboration.merge',
      {
        surfaceSessionToken: surface.token,
        batch: {
          batchId: 'host-batch',
          documentId: snapshot.documentId,
          actorId: 'human:forged',
          lamport: 1,
          baseRevisionId: snapshot.revisionId,
          createdAt: '2026-08-18T00:00:00.000Z',
          operations: [
            {
              operationId: 'host-collaboration-operation',
              documentId: snapshot.documentId,
              actorPrincipalId: 'human:forged',
              baseRevisionId: snapshot.revisionId,
              timestamp: '2026-08-18T00:00:00.000Z',
              type: 'text.replace',
              nodeId: paragraph.nodeId,
              expectedGeneration: paragraph.generation,
              value: '协作正文',
            },
          ],
        },
      },
      'host-collaboration',
    )
    expect(merge.output).toEqual(expect.objectContaining({ status: 'committed' }))
    expect(
      host.documents
        .inspect(snapshot.documentId)
        .nodes.find((node) => node.nodeId === paragraph.nodeId)?.text,
    ).toBe('协作正文')
    await host.stop()
  })

  it('Kernel 更高 Authority Epoch 应阻断本地写入并保留 Outbox', async () => {
    const host = new ArcaApplicationHost({ dataPath: dataPath() })
    await host.start()
    const { snapshot, paragraph } = await setupDocument(host)
    const pendingBefore = host.documents.listPendingOutbox().length
    const resumed = await invoke(host, 'federation.resume', {
      kernelHeads: [{ documentId: snapshot.documentId, authorityEpoch: 2 }],
    })
    expect(resumed.output).toEqual(
      expect.objectContaining({
        heads: [expect.objectContaining({ state: 'authority_conflict' })],
      }),
    )
    const surface = await session(host)
    const edit = await invoke(
      host,
      'document.edit_text',
      {
        documentId: snapshot.documentId,
        nodeId: paragraph.nodeId as DocumentNodeId,
        expectedGeneration: paragraph.generation,
        baseRevisionId: snapshot.revisionId,
        transactionId: 'tx-conflict',
        value: '不应提交',
        surfaceSessionToken: surface.token,
      },
      'tx-conflict',
    )
    expect(edit.state).toBe('failed')
    expect(edit.error?.message).toContain('DOCUMENT_AUTHORITY_CONFLICT')
    expect(host.documents.listPendingOutbox()).toHaveLength(pendingBefore)
    await host.stop()
  })
})
