import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentAddressedBlobStore,
  DocumentExportService,
  InMemoryDocumentEngine,
  asKernelNodeId,
  createProgrammableIslandDescriptor,
  importMarkdown,
  projectHtml,
  type DocumentId,
  type DocumentNodeId,
  type JsonValue,
  type OperationId,
} from '../src'

const roots: string[] = []
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'infos-document-content-'))
  roots.push(value)
  return value
}
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })))

describe('Document内容模型与导出链', () => {
  it('Markdown导入应生成Inline AST与Source Range，HTML投影必须安全转义', () => {
    const engine = new InMemoryDocumentEngine()
    const markdown =
      '# 标题\n\n你好 **主人**，[安全](https://example.com) [危险](javascript:alert(1)) <script>x</script>'
    const snapshot = importMarkdown(engine, {
      documentId: 'content-document' as DocumentId,
      authorityNodeId: asKernelNodeId('node-local'),
      ownerPrincipalId: 'owner',
      title: '内容模型',
      actorPrincipalId: 'owner',
      idempotencyKey: 'import-content',
      markdown,
    })
    const heading = snapshot.nodes.find((node) => node.type === 'heading')!
    const paragraph = snapshot.nodes.find((node) => node.type === 'paragraph')!
    expect(heading.attributes.sourceRange).toEqual(
      expect.objectContaining({
        start: expect.objectContaining({ offset: 0, line: 1, column: 1 }),
      }),
    )
    expect(paragraph.attributes.inlineAst).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'strong' }),
        expect.objectContaining({ type: 'link', href: 'https://example.com' }),
        expect.objectContaining({ type: 'link', href: '#blocked' }),
      ]),
    )
    const html = projectHtml(engine, snapshot.documentId).content
    expect(html).toContain('<strong>主人</strong>')
    expect(html).toContain('href="#blocked"')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('可编程岛应只保存内容寻址声明并强制禁止网络', () => {
    const engine = new InMemoryDocumentEngine()
    const snapshot = engine.createDocument({
      documentId: 'island-document' as DocumentId,
      authorityNodeId: asKernelNodeId('node-local'),
      ownerPrincipalId: 'owner',
      title: '可编程岛',
    })
    const hash = 'a'.repeat(64)
    const descriptor = createProgrammableIslandDescriptor({
      runtime: 'worker',
      sourceBlobId: `sha256:${hash}`,
      sourceHash: hash,
      entrypoint: 'main.js',
      permissions: ['render', 'input'],
    })
    engine.transact({
      transactionId: 'insert-island',
      documentId: snapshot.documentId,
      actorPrincipalId: 'owner',
      baseRevisionId: snapshot.revisionId,
      intent: '插入可编程岛声明',
      idempotencyKey: 'insert-island',
      operations: [
        {
          operationId: 'insert-island' as OperationId,
          documentId: snapshot.documentId,
          actorPrincipalId: 'owner',
          baseRevisionId: snapshot.revisionId,
          timestamp: new Date(0).toISOString(),
          type: 'node.insert',
          parentGeneration: 1,
          node: {
            nodeId: 'island' as DocumentNodeId,
            type: 'programmable-island',
            parentId: snapshot.document.rootNodeId,
            orderKey: 'a',
            attributes: descriptor as unknown as Record<string, JsonValue>,
          },
        },
      ],
    })
    const island = engine
      .inspect(snapshot.documentId)
      .nodes.find((node) => node.nodeId === 'island')!
    expect(island.attributes).toMatchObject({
      runtime: 'worker',
      network: 'none',
      status: 'declared',
    })
    expect(projectHtml(engine, snapshot.documentId).content).toContain(
      'data-programmable-island="blocked"',
    )
    expect(() =>
      createProgrammableIslandDescriptor({
        runtime: 'worker',
        sourceBlobId: 'file:unsafe',
        sourceHash: hash,
        entrypoint: 'main.js',
        permissions: ['render'],
      }),
    ).toThrow('内容寻址')
  })

  it('统一导出服务应覆盖文本、Markdown、HTML、演示、Checkpoint和Portable Package', () => {
    const engine = new InMemoryDocumentEngine()
    const snapshot = importMarkdown(engine, {
      documentId: 'export-document' as DocumentId,
      authorityNodeId: asKernelNodeId('node-local'),
      ownerPrincipalId: 'owner',
      title: '导出文档',
      actorPrincipalId: 'owner',
      idempotencyKey: 'import-export',
      markdown: '# 第一页\n\n正文',
    })
    const service = new DocumentExportService(engine, new ContentAddressedBlobStore(root()))
    expect(service.export(snapshot.documentId, 'plain-text').format).toBe('plain-text')
    expect(service.export(snapshot.documentId, 'markdown').format).toBe('markdown')
    expect(service.export(snapshot.documentId, 'html').format).toBe('html')
    expect(service.export(snapshot.documentId, 'presentation').format).toBe('presentation')
    expect(service.export(snapshot.documentId, 'checkpoint')).toMatchObject({
      format: 'checkpoint',
      contentType: 'application/json',
    })
    const portable = service.export(snapshot.documentId, 'portable-project', { title: '导出工程' })
    expect(portable).toMatchObject({ format: 'portable-project', contentType: 'application/zip' })
    expect(portable.content.readUInt32LE(0)).toBe(0x04034b50)
  })
})
