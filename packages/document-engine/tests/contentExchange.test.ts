import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentAddressedBlobStore,
  DocumentEngineError,
  InMemoryDocumentEngine,
  asKernelNodeId,
  importMarkdown,
  projectMarkdown,
  type DocumentId,
} from '@infos/document-engine'

const directories: string[] = []
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infos-document-content-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('Markdown 与 Blob A3/A4', () => {
  it('应将受限 Markdown 原子导入为语义图并确定性投影', () => {
    const engine = new InMemoryDocumentEngine()
    const documentId = 'markdown-document' as DocumentId
    const snapshot = importMarkdown(engine, {
      documentId,
      authorityNodeId: asKernelNodeId('application-node'),
      ownerPrincipalId: 'owner',
      actorPrincipalId: 'agent:writer',
      title: 'Markdown',
      idempotencyKey: 'markdown-import',
      markdown: '# 标题\n\n第一段\n第二行\n\n- 甲\n- 乙\n\n> 引用\n\n```ts\nconst value = 1\n```',
    })
    expect(snapshot.journalSequence).toBe(1)
    expect(projectMarkdown(engine, documentId).content).toBe(
      '# 标题\n\n第一段 第二行\n\n- 甲\n- 乙\n\n> 引用\n\n```ts\nconst value = 1\n```',
    )
    expect(projectMarkdown(engine, documentId).contentHash).toBe(
      projectMarkdown(engine, documentId).contentHash,
    )
  })

  it('无效 Markdown 不应留下空 Document Authority', () => {
    const engine = new InMemoryDocumentEngine()
    const documentId = 'invalid-markdown' as DocumentId
    expect(() =>
      importMarkdown(engine, {
        documentId,
        authorityNodeId: asKernelNodeId('application-node'),
        ownerPrincipalId: 'owner',
        actorPrincipalId: 'agent:writer',
        title: '无效',
        idempotencyKey: 'invalid',
        markdown: '```ts\n未闭合',
      }),
    ).toThrowError(DocumentEngineError)
    expect(() => engine.inspect(documentId)).toThrowError(DocumentEngineError)
  })

  it('Blob 应按内容寻址、去重并验证摘要', () => {
    const root = temporaryDirectory()
    const store = new ContentAddressedBlobStore(root)
    const first = store.put(Buffer.from('同一内容'))
    const second = store.put(Buffer.from('同一内容'))
    expect(second).toEqual(first)
    expect(store.has(first.blobId)).toBe(true)
    expect(store.get(first.blobId).toString()).toBe('同一内容')
  })

  it('Blob 文件被篡改后应 fail-closed', () => {
    const root = temporaryDirectory()
    const store = new ContentAddressedBlobStore(root)
    const descriptor = store.put(Buffer.from('原内容'))
    const digest = descriptor.sha256
    writeFileSync(join(root, digest.slice(0, 2), digest.slice(2, 4), digest), '篡改')
    expect(() => store.get(descriptor.blobId)).toThrowError(DocumentEngineError)
  })
})
