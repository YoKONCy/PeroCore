import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SqliteDocumentEngine,
  asKernelNodeId,
  type DocumentNodeId,
} from '../../../document-engine/src/index'
import { officeContent, setNodeRuns } from '../../../document-engine/src/office'
import { ArcaOfficeService } from '../src/officeService'

const resources: Array<{ path: string; engine: SqliteDocumentEngine }> = []
afterEach(() => {
  for (const item of resources.splice(0)) {
    item.engine.close()
    if (!resolve(item.path).startsWith(resolve(tmpdir()) + sep + 'arca-office-service-'))
      throw new Error('测试临时目录不符合清理范围')
    rmSync(item.path, { recursive: true, force: true })
  }
})
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'arca-office-service-')),
    file = join(path, 'arca.sqlite'),
    engine = new SqliteDocumentEngine(file),
    office = new ArcaOfficeService(engine)
  resources.push({ path, engine })
  const initial = engine.createDocument({
      title: '报告',
      authorityNodeId: asKernelNodeId('arca'),
      ownerPrincipalId: 'owner',
    }),
    content = officeContent(initial)
  content.nodes.push({
    nodeId: 'paragraph' as DocumentNodeId,
    parentId: initial.document.rootNodeId,
    type: 'paragraph',
    orderKey: '0',
    text: '原始报告',
    attributes: {},
  })
  const snapshot = office.apply(
    {
      documentId: initial.documentId,
      baseRevisionId: initial.revisionId,
      content,
      transactionId: 'seed',
      timestamp: '2026-10-16T00:00:00.000Z',
      intent: '创建正文',
    },
    'owner',
  ).snapshot
  return { path, file, engine, office, snapshot }
}
describe('办公文稿持久服务', () => {
  it('历史恢复只对目标文稿生成新修订，另一篇文稿及已有历史不变', () => {
    const { engine, office, snapshot } = setup(),
      other = engine.createDocument({
        title: '其他文稿',
        authorityNodeId: asKernelNodeId('arca'),
        ownerPrincipalId: 'owner',
      }),
      content = officeContent(snapshot)
    setNodeRuns(content.nodes.find((node) => node.nodeId === 'paragraph')!, [
      { text: '修改后的报告', marks: { underline: true } },
    ])
    const modified = office.apply(
      {
        documentId: snapshot.documentId,
        baseRevisionId: snapshot.revisionId,
        content,
        transactionId: 'modify',
        timestamp: '2026-10-16T00:01:00.000Z',
        intent: '编辑',
      },
      'owner',
    ).snapshot
    const result = office.restore(
      {
        documentId: snapshot.documentId,
        baseRevisionId: modified.revisionId,
        revisionId: snapshot.revisionId,
        transactionId: 'restore',
        timestamp: '2026-10-16T00:02:00.000Z',
      },
      'owner',
    )
    expect(result.snapshot.revisionId).not.toBe(snapshot.revisionId)
    expect(result.snapshot.nodes.find((node) => node.nodeId === 'paragraph')?.text).toBe('原始报告')
    expect(engine.snapshotAt(snapshot.documentId, modified.revisionId).rootHash).toBe(
      modified.rootHash,
    )
    expect(engine.inspect(other.documentId).rootHash).toBe(other.rootHash)
  })
  it('草稿另存保持原文，并且同一请求重试只返回同一份副本', () => {
    const { engine, snapshot } = setup(),
      content = officeContent(snapshot)
    setNodeRuns(content.nodes.find((node) => node.nodeId === 'paragraph')!, [{ text: '冲突草稿' }])
    const input = {
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      title: '草稿副本',
      principalId: 'owner',
      transactionId: 'copy',
      content,
    }
    const copy = engine.duplicateDocument(input),
      again = engine.duplicateDocument(input)
    expect(copy.documentId).toBe(again.documentId)
    expect(engine.listDocuments()).toHaveLength(2)
    expect(copy.nodes.find((node) => node.type === 'paragraph')?.text).toBe('冲突草稿')
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
    expect(() => engine.duplicateDocument({ ...input, title: '另一个标题' })).toThrow(
      '副本请求标识',
    )
  })
  it('HTML 预览保留格式并转义正文，禁止正文插入可执行标签', () => {
    const { office, snapshot } = setup(),
      content = officeContent(snapshot)
    setNodeRuns(content.nodes.find((node) => node.nodeId === 'paragraph')!, [
      {
        text: '<script>危险内容</script>',
        marks: { bold: true, underline: true, highlight: '#fff3a3' },
      },
    ])
    office.apply(
      {
        documentId: snapshot.documentId,
        baseRevisionId: snapshot.revisionId,
        content,
        transactionId: 'html',
        timestamp: '2026-10-16T00:03:00.000Z',
        intent: '设置样式',
      },
      'owner',
    )
    const { html } = office.preview(snapshot.documentId)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('font-weight:700')
    expect(html).toContain('background-color:#fff3a3')
  })
})
