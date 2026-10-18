import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryDocumentEngine,
  asKernelNodeId,
  type DocumentNodeId,
} from '../../../../document-engine/src/index'
import {
  compileOfficeEdit,
  officeContent,
  setNodeRuns,
  type OfficeEditRequest,
  type OfficeEditResult,
} from '../../../../document-engine/src/office'
import { OfficeSession } from '../src/services/officeSession'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function setup() {
  const engine = new InMemoryDocumentEngine(),
    created = engine.createDocument({
      title: '办公文稿',
      authorityNodeId: asKernelNodeId('arca'),
      ownerPrincipalId: 'owner',
    }),
    content = officeContent(created)
  content.nodes.push({
    nodeId: 'text' as DocumentNodeId,
    parentId: created.document.rootNodeId,
    orderKey: '0',
    type: 'paragraph',
    text: '原文',
    attributes: {},
  })
  engine.transact(
    compileOfficeEdit(
      created,
      {
        documentId: created.documentId,
        baseRevisionId: created.revisionId,
        transactionId: 'seed',
        timestamp: '2026-10-16T00:00:00.000Z',
        intent: '创建正文',
        content,
      },
      'owner',
    ),
  )
  const snapshot = engine.inspect(created.documentId)
  const apply = (request: OfficeEditRequest): OfficeEditResult => {
    const receipt = engine.transact(
      compileOfficeEdit(
        engine.snapshotAt(snapshot.documentId, request.baseRevisionId),
        request,
        'owner',
      ),
    )
    return { receipt, snapshot: engine.snapshotAt(snapshot.documentId, receipt.revisionId) }
  }
  const edit = (session: OfficeSession, text: string) =>
    session.mutate('输入正文', (content) =>
      setNodeRuns(content.nodes.find((node) => node.nodeId === 'text')!, [{ text }]),
    )
  return { engine, snapshot, apply, edit }
}

describe('办公文稿草稿与回执', () => {
  it('恢复旧在途事务时仍提交较新的本地草稿，不能被旧回执覆盖', async () => {
    const { snapshot, apply, edit, engine } = setup()
    const requests: OfficeEditRequest[] = []
    const first = new OfficeSession(
      snapshot,
      'ws://旧事务恢复',
      async (request) => {
        requests.push(request)
        apply(request)
        throw new Error('回执超时')
      },
      () => {},
      () => {},
    )
    first.suspend()
    edit(first, '旧提交')
    await expect(first.flush()).rejects.toThrow('回执超时')
    edit(first, '更新的本地草稿')
    const restored = new OfficeSession(
      engine.inspect(snapshot.documentId),
      'ws://旧事务恢复',
      async (request) => {
        requests.push(request)
        return apply(request)
      },
      () => {},
      () => {},
    )
    restored.suspend()
    await restored.flush()
    expect(requests[1]?.transactionId).toBe(requests[0]?.transactionId)
    expect(requests[2]?.transactionId).not.toBe(requests[0]?.transactionId)
    expect(
      engine.inspect(snapshot.documentId).nodes.find((node) => node.nodeId === 'text')?.text,
    ).toBe('更新的本地草稿')
    expect(restored.hasChanges).toBe(false)
  })
  it('编辑与撤销复用不可变快照，每次修改仍立即落盘且重启可恢复', () => {
    const { snapshot, apply, edit } = setup()
    const session = new OfficeSession(
      snapshot,
      'ws://性能回归',
      async (request) => apply(request),
      () => {},
      () => {},
    )
    session.suspend()
    const original = session.content
    edit(session, '第一次')
    const first = session.content
    edit(session, '第二次')
    expect(original.nodes.find((node) => node.nodeId === 'text')?.text).toBe('原文')
    expect(first.nodes.find((node) => node.nodeId === 'text')?.text).toBe('第一次')
    expect(session.history[0]).toBe(original)
    expect(session.recoverable).toBe(true)
    session.undo()
    expect(session.content).toBe(first)
    edit(session, '撤销后编辑')
    expect(first.nodes.find((node) => node.nodeId === 'text')?.text).toBe('第一次')
    const restored = new OfficeSession(
      snapshot,
      'ws://性能回归',
      async (request) => apply(request),
      () => {},
      () => {},
    )
    restored.suspend()
    expect(restored.content.nodes.find((node) => node.nodeId === 'text')?.text).toBe('撤销后编辑')
  })
  it('保存期间继续输入，晚到回执不覆盖新文字，并继续提交后续编辑', async () => {
    const { snapshot, apply, edit, engine } = setup(),
      requests: OfficeEditRequest[] = []
    let release!: (value: OfficeEditResult) => void
    const session = new OfficeSession(
      snapshot,
      'ws://arca',
      (request) => {
        requests.push(request)
        const response = apply(request)
        return requests.length === 1
          ? new Promise((resolve) => {
              release = resolve
              setTimeout(() => release(response), 0)
            })
          : Promise.resolve(response)
      },
      () => {},
      () => {},
    )
    edit(session, '第一轮')
    const saving = session.flush()
    edit(session, '保存期间的新输入')
    await saving
    expect(requests).toHaveLength(2)
    expect(session.content.nodes.find((node) => node.nodeId === 'text')?.text).toBe(
      '保存期间的新输入',
    )
    expect(
      engine.inspect(snapshot.documentId).nodes.find((node) => node.nodeId === 'text')?.text,
    ).toBe('保存期间的新输入')
    expect(session.hasChanges).toBe(false)
    session.detach()
  })
  it('服务端已提交但回执丢失，重开编辑器后用原事务核对，不产生重复修订', async () => {
    const { snapshot, apply, edit, engine } = setup(),
      requests: OfficeEditRequest[] = []
    const first = new OfficeSession(
      snapshot,
      'ws://arca',
      async (request) => {
        requests.push(request)
        apply(request)
        throw new Error('ARCA_INVOCATION_TIMEOUT')
      },
      () => {},
      () => {},
    )
    edit(first, '已提交的文字')
    await expect(first.flush()).rejects.toThrow('TIMEOUT')
    const recovered = new OfficeSession(
      engine.inspect(snapshot.documentId),
      'ws://arca',
      async (request) => {
        requests.push(request)
        return apply(request)
      },
      () => {},
      () => {},
    )
    await recovered.flush()
    expect(requests[1]).toEqual(requests[0])
    expect(engine.listJournal(snapshot.documentId)).toHaveLength(2)
    expect(recovered.state).toBe('saved')
    recovered.detach()
  })
  it('基础版本冲突时保留本地内容，避免静默覆盖新的正式版本', async () => {
    const { snapshot, apply, edit, engine } = setup(),
      send = vi.fn(async (request) => apply(request as OfficeEditRequest))
    const session = new OfficeSession(
      snapshot,
      'ws://arca',
      send,
      () => {},
      () => {},
    )
    edit(session, '本地草稿')
    const other = officeContent(snapshot)
    other.title = '其他窗口已改名'
    apply({
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      content: other,
      transactionId: 'other',
      timestamp: '2026-10-16T00:00:00.000Z',
      intent: '外部修改',
    })
    session.adopt(engine.inspect(snapshot.documentId))
    await expect(session.flush()).rejects.toThrow('新修订')
    expect(send).not.toHaveBeenCalled()
    expect(session.content.nodes.find((node) => node.nodeId === 'text')?.text).toBe('本地草稿')
    session.detach()
  })
  it('草稿缓存写入失败时显示失败并保留页面内容', async () => {
    const { snapshot, edit } = setup(),
      send = vi.fn()
    const session = new OfficeSession(
      snapshot,
      'ws://arca',
      send,
      () => {},
      () => {},
    )
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('存储空间不足')
    })
    edit(session, '需要保护的内容')
    await expect(session.flush()).rejects.toThrow('存储失败')
    expect(session.hasChanges).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(session.content.nodes.find((node) => node.nodeId === 'text')?.text).toBe(
      '需要保护的内容',
    )
  })
})
