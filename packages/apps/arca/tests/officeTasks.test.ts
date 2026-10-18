import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SqliteDocumentEngine,
  asKernelNodeId,
  type ChangeSetId,
  type DocumentNodeId,
} from '../../../document-engine/src/index'
import { compileOfficeEdit, officeContent } from '../../../document-engine/src/office'
import { ArcaOfficeTasks } from '../src/officeTasks'
import type { ArcaModelRepository } from '../src/modelRepository'
import { completeModel } from '../src/modelClient'

vi.mock('../src/modelClient', () => ({ completeModel: vi.fn() }))
const resources: Array<{ path: string; tasks: ArcaOfficeTasks; engine: SqliteDocumentEngine }> = []
afterEach(async () => {
  for (const item of resources.splice(0)) {
    await item.tasks.stop()
    item.engine.close()
    if (!resolve(item.path).startsWith(resolve(tmpdir()) + sep + 'arca-office-task-'))
      throw new Error('测试临时目录不符合清理范围')
    rmSync(item.path, { recursive: true, force: true })
  }
  vi.resetAllMocks()
})
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'arca-office-task-')),
    engine = new SqliteDocumentEngine(join(path, 'arca.sqlite'))
  const initial = engine.createDocument({
      title: '会议纪要',
      ownerPrincipalId: 'owner',
      authorityNodeId: asKernelNodeId('arca'),
    }),
    content = officeContent(initial)
  content.nodes.push({
    nodeId: 'paragraph' as DocumentNodeId,
    parentId: initial.document.rootNodeId,
    orderKey: '0',
    type: 'paragraph',
    text: '会议讨论了交付计划。',
    attributes: {},
  })
  engine.transact(
    compileOfficeEdit(
      initial,
      {
        documentId: initial.documentId,
        baseRevisionId: initial.revisionId,
        transactionId: 'seed',
        timestamp: '2026-10-16T00:00:00.000Z',
        intent: '创建纪要',
        content,
      },
      'owner',
    ),
  )
  const models = {
    resolve: () => ({
      id: 'model',
      name: '办公模型',
      provider: 'openai',
      model: 'model',
      baseUrl: 'http://127.0.0.1:1234',
    }),
  } as unknown as ArcaModelRepository
  const tasks = new ArcaOfficeTasks(join(path, 'tasks.json'), engine, models)
  resources.push({ path, tasks, engine })
  tasks.start()
  const snapshot = engine.inspect(initial.documentId),
    input = {
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      instruction: '润色会议纪要',
      scope: 'document' as const,
    }
  return { engine, tasks, snapshot, input, path, models }
}
const response = {
  text: JSON.stringify({
    summary: '补充行动表达',
    replacements: [
      { nodeId: 'paragraph', expectedText: '会议讨论了交付计划。', text: '会议明确了交付计划。' },
    ],
  }),
}

describe('Arca 独立办公协作任务', () => {
  it('任务文件损坏时保留原文件，手工文稿仍可读取', async () => {
    const { engine, tasks, snapshot, input, path, models } = setup()
    await tasks.stop()
    writeFileSync(join(path, 'tasks.json'), '{损坏的任务文件', 'utf8')
    const recovered = new ArcaOfficeTasks(join(path, 'tasks.json'), engine, models)
    recovered.start()
    expect(() => recovered.submit(input, 'owner', 'damaged')).toThrow('原文件已保留')
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
    expect(readFileSync(join(path, 'tasks.json'), 'utf8')).toBe('{损坏的任务文件')
    await recovered.stop()
  })
  it('生成结果先持久化为待审提案，显式批准后才修改原文', async () => {
    vi.mocked(completeModel).mockResolvedValue(
      response as Awaited<ReturnType<typeof completeModel>>,
    )
    const { engine, tasks, snapshot, input } = setup(),
      task = tasks.submit(input, 'owner', 'request')
    await vi.waitFor(() =>
      expect(tasks.list(snapshot.documentId, 'owner')[0]?.status).toBe('awaiting_review'),
    )
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
    expect(tasks.submit(input, 'owner', 'request').taskId).toBe(task.taskId)
    const result = tasks.list(snapshot.documentId, 'owner')[0]!,
      id = result.changeSetId as ChangeSetId
    engine.review({ changeSetId: id, reviewerPrincipalId: 'owner', decision: 'approve' })
    engine.commitChangeSet(id, { reviewerPrincipalId: 'owner', idempotencyKey: 'approve' })
    expect(tasks.list(snapshot.documentId, 'owner')[0]?.status).toBe('committed')
    expect(
      engine.inspect(snapshot.documentId).nodes.find((node) => node.nodeId === 'paragraph')?.text,
    ).toBe('会议明确了交付计划。')
  })
  it('取消后晚到的模型响应不会创建提案或修改文稿', async () => {
    let release!: (result: Awaited<ReturnType<typeof completeModel>>) => void
    vi.mocked(completeModel).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const { engine, tasks, snapshot, input } = setup(),
      task = tasks.submit(input, 'owner', 'cancel')
    await vi.waitFor(() => expect(completeModel).toHaveBeenCalledOnce())
    tasks.cancel(task.taskId, 'owner')
    release(response as Awaited<ReturnType<typeof completeModel>>)
    await tasks.stop()
    expect(engine.listChangeSets(snapshot.documentId)).toHaveLength(0)
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
    expect(tasks.list(snapshot.documentId, 'owner')[0]?.status).toBe('cancelled')
  })
  it('模型伪造原文校验值时失败，任务和原文均可恢复', async () => {
    vi.mocked(completeModel).mockResolvedValue({
      text: JSON.stringify({
        replacements: [{ nodeId: 'paragraph', expectedText: '不匹配的原文', text: '伪造内容' }],
      }),
    } as Awaited<ReturnType<typeof completeModel>>)
    const { engine, tasks, snapshot, input, path, models } = setup()
    tasks.submit(input, 'owner', 'invalid')
    await vi.waitFor(() =>
      expect(tasks.list(snapshot.documentId, 'owner')[0]?.status).toBe('failed'),
    )
    await tasks.stop()
    const restored = new ArcaOfficeTasks(join(path, 'tasks.json'), engine, models)
    expect(restored.list(snapshot.documentId, 'owner')[0]?.status).toBe('failed')
    expect(restored.list(snapshot.documentId, 'another-owner')).toEqual([])
    expect(engine.listChangeSets(snapshot.documentId)).toHaveLength(0)
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(snapshot.rootHash)
  })
})
