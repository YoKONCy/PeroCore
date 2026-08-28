import { describe, expect, it } from 'vitest'
import { DocumentEngineError, InMemoryDocumentEngine, asKernelNodeId } from '@infos/document-engine'
import type {
  ChangeSetId,
  DocumentId,
  DocumentNodeId,
  DocumentOperation,
  OperationId,
  RevisionId,
} from '@infos/document-engine'

const actor = 'agent:pero'
const timestamp = '2026-08-18T00:00:00.000Z'

function setup() {
  const engine = new InMemoryDocumentEngine()
  const snapshot = engine.createDocument({
    documentId: 'document-1' as DocumentId,
    rootNodeId: 'root' as DocumentNodeId,
    authorityNodeId: asKernelNodeId('node-arca'),
    ownerPrincipalId: 'owner',
    title: '测试文档',
  })
  return { engine, snapshot }
}

function operation<
  T extends Omit<
    DocumentOperation,
    'operationId' | 'documentId' | 'actorPrincipalId' | 'baseRevisionId' | 'timestamp'
  >,
>(
  snapshot: ReturnType<ReturnType<typeof setup>['engine']['inspect']> extends never
    ? never
    : ReturnType<ReturnType<typeof setup>['engine']['inspect']>,
  value: T,
  id: string,
): DocumentOperation {
  return {
    ...value,
    operationId: id as OperationId,
    documentId: snapshot.documentId,
    actorPrincipalId: actor,
    baseRevisionId: snapshot.revisionId,
    timestamp,
  } as DocumentOperation
}

function transact(
  engine: InMemoryDocumentEngine,
  snapshot: ReturnType<InMemoryDocumentEngine['inspect']>,
  operations: DocumentOperation[],
  key: string,
) {
  return engine.transact({
    transactionId: `tx:${key}`,
    documentId: snapshot.documentId,
    actorPrincipalId: actor,
    baseRevisionId: snapshot.revisionId,
    operations,
    intent: '测试修改',
    idempotencyKey: key,
  })
}

function errorCode(action: () => unknown): string {
  try {
    action()
    return ''
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentEngineError)
    return (error as DocumentEngineError).kernelError.code
  }
}

describe('Document Engine A1', () => {
  it('创建文档应生成 Root、初始 Revision 和稳定 Root Hash', () => {
    const { engine, snapshot } = setup()
    expect(snapshot.nodes).toEqual([
      expect.objectContaining({ nodeId: 'root', type: 'document-root', generation: 1 }),
    ])
    expect(snapshot.revisionId).toBe(snapshot.document.headRevisionId)
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
  })

  it('语义插入后应生成 Outline、Plain Text、Revision、Receipt 和 Journal', () => {
    const { engine, snapshot } = setup()
    const operations = [
      operation(
        snapshot,
        {
          type: 'node.insert',
          node: {
            nodeId: 'section' as DocumentNodeId,
            type: 'section',
            parentId: 'root' as DocumentNodeId,
            orderKey: 'a',
          },
          parentGeneration: 1,
        },
        'op-1',
      ),
      operation(
        snapshot,
        {
          type: 'node.insert',
          node: {
            nodeId: 'heading' as DocumentNodeId,
            type: 'heading',
            parentId: 'section' as DocumentNodeId,
            orderKey: 'a',
            text: '第一章',
          },
          parentGeneration: 1,
        },
        'op-2',
      ),
      operation(
        snapshot,
        {
          type: 'node.insert',
          node: {
            nodeId: 'paragraph' as DocumentNodeId,
            type: 'paragraph',
            parentId: 'section' as DocumentNodeId,
            orderKey: 'b',
            text: '正文',
          },
          parentGeneration: 2,
        },
        'op-3',
      ),
    ]
    const receipt = transact(engine, snapshot, operations, 'insert')
    expect(receipt.status).toBe('committed')
    expect(receipt.observedEffects).toHaveLength(3)
    expect(engine.projectPlainText(snapshot.documentId).content).toBe('第一章\n\n正文')
    expect(engine.projectOutline(snapshot.documentId).content).toEqual([
      expect.objectContaining({
        nodeId: 'section',
        children: [expect.objectContaining({ nodeId: 'heading', text: '第一章' })],
      }),
    ])
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(1)
  })

  it('Revision 冲突应保持 Graph 和 Journal 不变', () => {
    const { engine, snapshot } = setup()
    const invalid = operation(snapshot, { type: 'document.rename', value: '新标题' }, 'op-revision')
    invalid.baseRevisionId = 'stale' as RevisionId
    const before = engine.inspect(snapshot.documentId)
    expect(errorCode(() => transact(engine, snapshot, [invalid], 'revision'))).toBe(
      'DOCUMENT_REVISION_CONFLICT',
    )
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(before.rootHash)
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(0)
  })

  it('Generation 冲突应原子回滚事务中已模拟的前序操作', () => {
    const { engine, snapshot } = setup()
    const operations = [
      operation(snapshot, { type: 'document.rename', value: '不能提交' }, 'op-rename'),
      operation(
        snapshot,
        {
          type: 'text.replace',
          nodeId: 'root' as DocumentNodeId,
          expectedGeneration: 99,
          value: '失败',
        },
        'op-stale',
      ),
    ]
    expect(errorCode(() => transact(engine, snapshot, operations, 'generation'))).toBe(
      'DOCUMENT_GENERATION_CONFLICT',
    )
    expect(engine.inspect(snapshot.documentId).document.title).toBe('测试文档')
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(0)
  })

  it('移动节点到其后代应拒绝且不产生 Journal', () => {
    const { engine, snapshot } = setup()
    const first = transact(
      engine,
      snapshot,
      [
        operation(
          snapshot,
          {
            type: 'node.insert',
            node: {
              nodeId: 'section' as DocumentNodeId,
              type: 'section',
              parentId: 'root' as DocumentNodeId,
              orderKey: 'a',
            },
            parentGeneration: 1,
          },
          'op-section',
        ),
        operation(
          snapshot,
          {
            type: 'node.insert',
            node: {
              nodeId: 'child' as DocumentNodeId,
              type: 'section',
              parentId: 'section' as DocumentNodeId,
              orderKey: 'a',
            },
            parentGeneration: 1,
          },
          'op-child',
        ),
      ],
      'tree-setup',
    )
    const current = engine.inspect(snapshot.documentId)
    const section = current.nodes.find((node) => node.nodeId === 'section')!
    const child = current.nodes.find((node) => node.nodeId === 'child')!
    expect(
      errorCode(() =>
        transact(
          engine,
          current,
          [
            operation(
              current,
              {
                type: 'node.move',
                nodeId: section.nodeId,
                expectedGeneration: section.generation,
                newParentId: child.nodeId,
                newOrderKey: 'x',
                newParentGeneration: child.generation,
              },
              'op-cycle',
            ),
          ],
          'cycle',
        ),
      ),
    ).toBe('DOCUMENT_TREE_CYCLE')
    expect(engine.inspect(snapshot.documentId).revisionId).toBe(first.revisionId)
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(1)
  })

  it('递归删除应生成每个节点的删除 Effect', () => {
    const { engine, snapshot } = setup()
    transact(
      engine,
      snapshot,
      [
        operation(
          snapshot,
          {
            type: 'node.insert',
            node: {
              nodeId: 'section' as DocumentNodeId,
              type: 'section',
              parentId: 'root' as DocumentNodeId,
              orderKey: 'a',
            },
            parentGeneration: 1,
          },
          'op-section',
        ),
        operation(
          snapshot,
          {
            type: 'node.insert',
            node: {
              nodeId: 'paragraph' as DocumentNodeId,
              type: 'paragraph',
              parentId: 'section' as DocumentNodeId,
              orderKey: 'a',
              text: '正文',
            },
            parentGeneration: 1,
          },
          'op-paragraph',
        ),
      ],
      'delete-setup',
    )
    const current = engine.inspect(snapshot.documentId)
    const section = current.nodes.find((node) => node.nodeId === 'section')!
    const receipt = transact(
      engine,
      current,
      [
        operation(
          current,
          {
            type: 'node.delete',
            nodeId: section.nodeId,
            expectedGeneration: section.generation,
            recursive: true,
          },
          'op-delete',
        ),
      ],
      'delete',
    )
    expect(receipt.observedEffects.filter((effect) => effect.type === 'node-deleted')).toHaveLength(
      2,
    )
    expect(engine.inspect(snapshot.documentId).nodes).toHaveLength(1)
  })

  it('相同幂等键和请求应返回原 Receipt', () => {
    const { engine, snapshot } = setup()
    const operations = [
      operation(snapshot, { type: 'document.rename', value: '新标题' }, 'op-idem'),
    ]
    const first = transact(engine, snapshot, operations, 'same')
    const second = transact(engine, snapshot, operations, 'same')
    expect(second).toEqual(first)
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(1)
  })

  it('相同幂等键对应不同请求应拒绝', () => {
    const { engine, snapshot } = setup()
    transact(
      engine,
      snapshot,
      [operation(snapshot, { type: 'document.rename', value: '标题甲' }, 'op-a')],
      'shared',
    )
    expect(
      errorCode(() =>
        engine.transact({
          transactionId: 'tx:shared',
          documentId: snapshot.documentId,
          actorPrincipalId: actor,
          baseRevisionId: snapshot.revisionId,
          operations: [operation(snapshot, { type: 'document.rename', value: '标题乙' }, 'op-b')],
          intent: '测试修改',
          idempotencyKey: 'shared',
        }),
      ),
    ).toBe('DOCUMENT_IDEMPOTENCY_CONFLICT')
  })

  it('ChangeSet 未审批不能提交', () => {
    const { engine, snapshot } = setup()
    const changeSet = engine.propose({
      changeSetId: 'change-1' as ChangeSetId,
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: actor,
      actorKind: 'agent',
      intent: '重命名',
      operations: [
        operation(snapshot, { type: 'document.rename', value: '候选标题' }, 'op-change'),
      ],
      risk: 'medium',
    })
    expect(
      errorCode(() =>
        engine.commitChangeSet(changeSet.changeSetId, {
          reviewerPrincipalId: 'owner',
          idempotencyKey: 'change-unreviewed',
        }),
      ),
    ).toBe('CHANGESET_REVIEW_REQUIRED')
  })

  it('ChangeSet 应拒绝跨文档或伪造 Actor 的 Operation', () => {
    const { engine, snapshot } = setup()
    const forged = operation(snapshot, { type: 'document.rename', value: '伪造标题' }, 'op-forged')
    forged.actorPrincipalId = 'agent:other'
    expect(
      errorCode(() =>
        engine.propose({
          documentId: snapshot.documentId,
          baseRevisionId: snapshot.revisionId,
          actorPrincipalId: actor,
          actorKind: 'agent',
          intent: '伪造修改',
          operations: [forged],
          risk: 'medium',
        }),
      ),
    ).toBe('DOCUMENT_CROSS_BOUNDARY')
  })

  it('提交者必须与批准 Review 的 Reviewer 一致', () => {
    const { engine, snapshot } = setup()
    const changeSet = engine.propose({
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: actor,
      actorKind: 'agent',
      intent: '重命名',
      operations: [
        operation(snapshot, { type: 'document.rename', value: '批准后的标题' }, 'op-reviewer'),
      ],
      risk: 'medium',
    })
    engine.validate(changeSet.changeSetId)
    engine.review({
      changeSetId: changeSet.changeSetId,
      reviewerPrincipalId: 'owner',
      decision: 'approve',
    })
    expect(
      errorCode(() =>
        engine.commitChangeSet(changeSet.changeSetId, {
          reviewerPrincipalId: 'other-reviewer',
          idempotencyKey: 'wrong-reviewer',
        }),
      ),
    ).toBe('CHANGESET_REVIEW_REQUIRED')
  })

  it('ChangeSet 审批后应提交并记录 Actor', () => {
    const { engine, snapshot } = setup()
    const changeSet = engine.propose({
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: actor,
      actorKind: 'agent',
      intent: '重命名',
      operations: [
        operation(snapshot, { type: 'document.rename', value: '已批准标题' }, 'op-approved'),
      ],
      risk: 'medium',
    })
    expect(engine.validate(changeSet.changeSetId).status).toBe('validated')
    engine.review({
      changeSetId: changeSet.changeSetId,
      reviewerPrincipalId: 'owner',
      decision: 'approve',
    })
    const receipt = engine.commitChangeSet(changeSet.changeSetId, {
      reviewerPrincipalId: 'owner',
      idempotencyKey: 'approved',
    })
    expect(receipt.actorPrincipalId).toBe(actor)
    expect(engine.inspect(snapshot.documentId).document.title).toBe('已批准标题')
  })

  it('审批后 Head 变化应将 ChangeSet 标记为冲突', () => {
    const { engine, snapshot } = setup()
    const changeSet = engine.propose({
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: actor,
      actorKind: 'agent',
      intent: '候选重命名',
      operations: [
        operation(snapshot, { type: 'document.rename', value: '候选标题' }, 'op-candidate'),
      ],
      risk: 'medium',
    })
    engine.validate(changeSet.changeSetId)
    engine.review({
      changeSetId: changeSet.changeSetId,
      reviewerPrincipalId: 'owner',
      decision: 'approve',
    })
    transact(
      engine,
      snapshot,
      [operation(snapshot, { type: 'document.rename', value: '人类新标题' }, 'op-human')],
      'human',
    )
    expect(
      errorCode(() =>
        engine.commitChangeSet(changeSet.changeSetId, {
          reviewerPrincipalId: 'owner',
          idempotencyKey: 'conflicted',
        }),
      ),
    ).toBe('DOCUMENT_REVISION_CONFLICT')
  })

  it('返回的 Snapshot、Journal 和 Projection 不应暴露内部可变权威', () => {
    const { engine, snapshot } = setup()
    snapshot.document.title = '外部篡改'
    snapshot.nodes[0]!.attributes.changed = true
    const journal = engine.listJournal(snapshot.documentId)
    journal.push({} as never)
    const projection = engine.projectPlainText(snapshot.documentId)
    projection.content = '外部篡改'
    const inspected = engine.inspect(snapshot.documentId)
    expect(inspected.document.title).toBe('测试文档')
    expect(inspected.nodes[0]!.attributes).toEqual({})
    expect(engine.listJournal(snapshot.documentId)).toEqual([])
    expect(engine.projectPlainText(snapshot.documentId).content).toBe('')
  })
})
