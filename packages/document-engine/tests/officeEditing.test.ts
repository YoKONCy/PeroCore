import { describe, expect, it } from 'vitest'
import {
  InMemoryDocumentEngine,
  asKernelNodeId,
  type DocumentNodeId,
  type DocumentSnapshot,
  type OperationId,
} from '../src/index'
import {
  compileOfficeEdit,
  officeContent,
  officeChildren,
  runsOf,
  setNodeRuns,
  type OfficeContent,
  type OfficeNode,
} from '../src/office'
import { editOfficeTable, officeTableGrid } from '../src/officeTable'

function setup() {
  const engine = new InMemoryDocumentEngine()
  const initial = engine.createDocument({
    title: '办公文稿',
    ownerPrincipalId: 'owner',
    authorityNodeId: asKernelNodeId('arca'),
  })
  const content = officeContent(initial)
  for (const [index, text] of ['甲乙丙丁戊', '第二段', '第三段'].entries())
    content.nodes.push({
      nodeId: `paragraph-${index}` as DocumentNodeId,
      parentId: initial.document.rootNodeId,
      orderKey: String(index),
      type: 'paragraph',
      text,
      attributes: {},
    })
  const snapshot = save(engine, initial, content, 'seed')
  return { engine, initial, snapshot }
}
function request(snapshot: DocumentSnapshot, content: OfficeContent, key: string) {
  return {
    documentId: snapshot.documentId,
    baseRevisionId: snapshot.revisionId,
    content,
    transactionId: key,
    timestamp: '2026-10-16T00:00:00.000Z',
    intent: '编辑办公文稿',
  }
}
function save(
  engine: InMemoryDocumentEngine,
  snapshot: DocumentSnapshot,
  content: OfficeContent,
  key: string,
) {
  engine.transact(compileOfficeEdit(snapshot, request(snapshot, content, key), 'owner'))
  return engine.inspect(snapshot.documentId)
}

describe('办公文稿事务与历史', () => {
  it('重试沿用原事务，晚到回执之后的修订仍可回放', () => {
    const { engine, snapshot } = setup(),
      content = officeContent(snapshot)
    setNodeRuns(content.nodes.find((node) => node.nodeId === 'paragraph-0')!, [
      { text: '新版', marks: { bold: true, underline: true } },
    ])
    const edit = request(snapshot, content, 'retry'),
      first = engine.transact(compileOfficeEdit(snapshot, edit, 'owner'))
    const committed = engine.inspect(snapshot.documentId),
      next = officeContent(committed)
    next.title = '文稿的新标题'
    save(engine, committed, next, 'rename')
    expect(
      engine.transact(
        compileOfficeEdit(
          engine.snapshotAt(snapshot.documentId, snapshot.revisionId),
          edit,
          'owner',
        ),
      ),
    ).toEqual(first)
    expect(engine.snapshotAt(snapshot.documentId, first.revisionId).rootHash).toBe(
      committed.rootHash,
    )
    expect(engine.inspect(snapshot.documentId).document.title).toBe('文稿的新标题')
  })
  it('段落转换成列表时保留节点标识，随后撤销并恢复旧版不影响另一篇文稿', () => {
    const { engine, snapshot } = setup(),
      content = officeContent(snapshot)
    const other = engine.createDocument({
      title: '其他文稿',
      ownerPrincipalId: 'owner',
      authorityNodeId: asKernelNodeId('arca'),
    })
    const list: OfficeNode = {
      nodeId: 'list' as DocumentNodeId,
      parentId: snapshot.document.rootNodeId,
      type: 'list',
      orderKey: '0',
      attributes: { ordered: true },
    }
    content.nodes.push(list)
    for (const node of content.nodes.filter((node) => node.type === 'paragraph')) {
      node.type = 'list-item'
      node.parentId = list.nodeId
    }
    const listed = save(engine, snapshot, content, 'list')
    expect(officeChildren(officeContent(listed), list.nodeId).map((node) => node.text)).toEqual([
      '甲乙丙丁戊',
      '第二段',
      '第三段',
    ])
    const restored = save(
      engine,
      listed,
      officeContent(engine.snapshotAt(snapshot.documentId, snapshot.revisionId)),
      'restore',
    )
    expect(restored.nodes.filter((node) => node.type === 'paragraph')).toHaveLength(3)
    expect(engine.inspect(other.documentId).rootHash).toBe(other.rootHash)
    expect(engine.snapshotAt(snapshot.documentId, listed.revisionId).rootHash).toBe(listed.rootHash)
  })
  it('旧版文本操作的格式语义保持可回放，新版编辑显式更新格式', () => {
    const { engine, snapshot } = setup(),
      content = officeContent(snapshot)
    setNodeRuns(content.nodes.find((node) => node.nodeId === 'paragraph-0')!, [
      { text: '甲乙丙丁戊', marks: { bold: true } },
    ])
    const styled = save(engine, snapshot, content, 'style')
    const node = styled.nodes.find((node) => node.nodeId === 'paragraph-0')!
    engine.transact({
      transactionId: 'legacy',
      documentId: styled.documentId,
      baseRevisionId: styled.revisionId,
      actorPrincipalId: 'owner',
      intent: '旧版文本编辑',
      idempotencyKey: 'legacy',
      operations: [
        {
          operationId: 'legacy:text' as OperationId,
          documentId: styled.documentId,
          baseRevisionId: styled.revisionId,
          actorPrincipalId: 'owner',
          timestamp: '2026-10-16T00:00:00.000Z',
          type: 'text.replace',
          nodeId: node.nodeId,
          expectedGeneration: node.generation,
          value: '旧版修改',
        },
      ],
    })
    const legacy = engine.inspect(styled.documentId),
      newer = officeContent(legacy)
    setNodeRuns(newer.nodes.find((candidate) => candidate.nodeId === node.nodeId)!, [
      { text: '现代编辑', marks: { italic: true } },
    ])
    save(engine, legacy, newer, 'modern')
    expect(engine.snapshotAt(styled.documentId, styled.revisionId).rootHash).toBe(styled.rootHash)
    expect(engine.snapshotAt(styled.documentId, legacy.revisionId).rootHash).toBe(legacy.rootHash)
  })
  it('仅含快照的工程继续编辑后，仍能回放导入基线', () => {
    const { engine, snapshot } = setup(),
      checkpoint = engine.exportCheckpoint()
    const authority = checkpoint.authorities[0]!
    authority.historyBase = { document: snapshot.document, nodes: snapshot.nodes }
    authority.revisions = authority.revisions.filter(
      (revision) => revision.revisionId === snapshot.revisionId,
    )
    authority.journal = []
    authority.operationIds = []
    authority.idempotency = []
    engine.restoreCheckpoint(checkpoint)
    const content = officeContent(snapshot)
    content.title = '导入后修改'
    const modified = save(engine, snapshot, content, 'after-import')
    expect(engine.snapshotAt(snapshot.documentId, snapshot.revisionId).rootHash).toBe(
      snapshot.rootHash,
    )
    expect(engine.getRevision(modified.revisionId).sequence).toBeGreaterThan(
      engine.getRevision(snapshot.revisionId).sequence,
    )
  })
  it('评论在插入文字后重定位，删除锚点后仍保留引用原文', () => {
    const { engine, snapshot } = setup()
    engine.createComment({
      documentId: snapshot.documentId,
      revisionId: snapshot.revisionId,
      nodeId: 'paragraph-0' as DocumentNodeId,
      authorPrincipalId: 'owner',
      body: '核对这里',
      range: { start: 2, end: 4 },
    })
    const content = officeContent(snapshot),
      node = content.nodes.find((node) => node.nodeId === 'paragraph-0')!
    setNodeRuns(node, [{ text: '新增甲乙丙丁戊' }])
    const edited = save(engine, snapshot, content, 'prefix')
    expect(engine.listComments(snapshot.documentId)[0]?.currentRange).toEqual({ start: 4, end: 6 })
    const deleted = officeContent(edited)
    deleted.nodes = deleted.nodes.filter((node) => node.nodeId !== 'paragraph-0')
    save(engine, edited, deleted, 'delete')
    expect(engine.listComments(snapshot.documentId)[0]).toMatchObject({
      anchorState: 'missing',
      anchor: { quote: '丙丁' },
    })
  })
  it('提案差异固定在基础修订，新修订出现后仍可查看和拒绝', () => {
    const { engine, snapshot } = setup(),
      proposed = officeContent(snapshot)
    setNodeRuns(proposed.nodes.find((node) => node.nodeId === 'paragraph-0')!, [
      { text: '提案正文' },
    ])
    const transaction = compileOfficeEdit(
      snapshot,
      request(snapshot, proposed, 'proposal'),
      'agent:arca-local',
    )
    const proposal = engine.propose({
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: 'agent:arca-local',
      actorKind: 'agent',
      intent: '润色',
      explanation: '等待审阅',
      risk: 'low',
      operations: transaction.operations,
    })
    engine.validate(proposal.changeSetId)
    const changed = officeContent(snapshot)
    setNodeRuns(changed.nodes.find((node) => node.nodeId === 'paragraph-0')!, [
      { text: '用户后续修改' },
    ])
    const newer = save(engine, snapshot, changed, 'later')
    expect(engine.diffChangeSet(proposal.changeSetId).textChanges[0]).toMatchObject({
      before: '甲乙丙丁戊',
      after: '提案正文',
    })
    engine.review({
      changeSetId: proposal.changeSetId,
      reviewerPrincipalId: 'owner',
      decision: 'reject',
    })
    expect(engine.getChangeSet(proposal.changeSetId).status).toBe('rejected')
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(newer.rootHash)
  })
})

describe('表格逻辑网格', () => {
  it('合并、拆分与增删行列保持矩形，合并内容不会丢失', () => {
    const content: OfficeContent = {
      title: '表格',
      nodes: [
        {
          nodeId: 'table' as DocumentNodeId,
          parentId: null,
          type: 'table',
          orderKey: '0',
          attributes: {},
        },
      ],
    }
    let sequence = 0
    const id = () => `new-${sequence++}`
    for (let row = 0; row < 2; row++) {
      content.nodes.push({
        nodeId: `r${row}` as DocumentNodeId,
        parentId: 'table' as DocumentNodeId,
        type: 'table-row',
        orderKey: String(row),
        attributes: {},
      })
      for (let column = 0; column < 2; column++)
        content.nodes.push({
          nodeId: `c${row}${column}` as DocumentNodeId,
          parentId: `r${row}` as DocumentNodeId,
          type: 'table-cell',
          orderKey: String(column),
          text: `${row}${column}`,
          attributes: {},
        })
    }
    editOfficeTable(content, 'c00', 'merge-right', id)
    editOfficeTable(content, 'c10', 'merge-right', id)
    editOfficeTable(content, 'c00', 'merge-down', id)
    expect(officeTableGrid(content, 'table').positions).toHaveLength(1)
    expect(
      runsOf(content.nodes.find((node) => node.nodeId === 'c00')!)
        .map((run) => run.text)
        .join(''),
    ).toBe('00\n01\n10\n11')
    editOfficeTable(content, 'c00', 'split', id)
    expect(officeTableGrid(content, 'table').positions).toHaveLength(4)
    editOfficeTable(content, 'c00', 'row', id)
    editOfficeTable(content, 'c00', 'column', id)
    expect(officeTableGrid(content, 'table')).toMatchObject({ width: 3 })
    expect(officeTableGrid(content, 'table').rows).toHaveLength(3)
    editOfficeTable(content, 'c00', 'delete-column', id)
    editOfficeTable(
      content,
      officeTableGrid(content, 'table').grid[0]![0]!.node.nodeId,
      'delete-row',
      id,
    )
    expect(officeTableGrid(content, 'table')).toMatchObject({ width: 2 })
    expect(officeTableGrid(content, 'table').rows).toHaveLength(2)
  })
})
