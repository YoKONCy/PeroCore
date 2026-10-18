import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArcaApplicationHost } from '../src/applicationHost'
import { ArcaCollaborationAuthority } from '../src/collaborationAuthority'
import { ArcaApplication } from '../src/application'
import { arcaManifest } from '../src/manifest'
import type { DocumentId, DocumentNode, ProposeChangeSetInput } from '@infos/document-engine'

const directories: string[] = []
const hosts: ArcaApplicationHost[] = []
const applications: ArcaApplication[] = []
function directory() {
  const value = mkdtempSync(path.join(tmpdir(), 'arca-closure-'))
  directories.push(value)
  return value
}
afterEach(async () => {
  await Promise.all([
    ...hosts.splice(0).map((host) => host.stop()),
    ...applications.splice(0).map((application) => application.stop()),
  ])
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true })
})
function setup() {
  const dataPath = directory(),
    application = new ArcaApplication(dataPath)
  applications.push(application)
  const snapshot = application.documents.importMarkdown({
    documentId: 'document' as DocumentId,
    authorityNodeId: 'arca-test' as never,
    ownerPrincipalId: 'human:test',
    actorPrincipalId: 'human:test',
    title: '范围校验',
    markdown: '# 第一节\n\n前保留 中间 后保留\n\n# 第二节\n\n另一节正文',
    idempotencyKey: 'import',
  })
  const paragraphs = ['前保留 中间 后保留', '另一节正文'].map(
    (text) => snapshot.nodes.find((node) => node.type === 'paragraph' && node.text === text)!,
  )
  const authority = new ArcaCollaborationAuthority(
    application.documents,
    path.join(dataPath, 'grants.json'),
    'instance-1',
  )
  return { application, snapshot, paragraphs, authority, dataPath }
}
function proposal(
  snapshot: ReturnType<typeof setup>['snapshot'],
  node: DocumentNode,
  value: string,
): ProposeChangeSetInput {
  return {
    documentId: snapshot.documentId,
    baseRevisionId: snapshot.revisionId,
    actorPrincipalId: 'pero',
    actorKind: 'agent',
    intent: '替换文字',
    explanation: '改善表达',
    risk: 'low',
    operations: [
      {
        operationId: randomUUID() as never,
        documentId: snapshot.documentId,
        baseRevisionId: snapshot.revisionId,
        actorPrincipalId: 'pero',
        timestamp: '2026-10-17T00:00:00.000Z',
        type: 'text.replace',
        nodeId: node.nodeId,
        expectedGeneration: node.generation,
        value,
      },
    ],
  }
}

describe('Arca 架构收口', () => {
  it('每项声明的应用能力都存在实际 Provider，停止重复调用共用清理结果', async () => {
    const host = new ArcaApplicationHost({ dataPath: directory() })
    hosts.push(host)
    await host.start()
    for (const offered of arcaManifest.offeredCapabilities)
      expect(host.nodeHost.offers()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capabilityType: offered.capabilityType,
            operations: expect.arrayContaining([...offered.operations]),
          }),
        ]),
      )
    const first = host.stop()
    expect(host.stop()).toBe(first)
    await first
  })
  it('同一数据目录拒绝第二个 Host，释放后允许重新打开', async () => {
    const dataPath = directory(),
      first = new ArcaApplicationHost({ dataPath })
    hosts.push(first)
    expect(() => new ArcaApplicationHost({ dataPath })).toThrow('已有运行中的应用')
    await first.stop()
    const second = new ArcaApplicationHost({ dataPath })
    hosts.push(second)
    await second.start()
  })
  it('独立 Host 提供自身页面入口与控制端点，并拒绝匿名停止', async () => {
    const host = new ArcaApplicationHost({
      dataPath: directory(),
      standalone: true,
      httpPort: 0,
      developmentUi: true,
    })
    hosts.push(host)
    const result = await host.start({ loopbackPort: 0 })
    expect(new URL(host.browserUrl!).searchParams.get('standalone')).toBe('1')
    expect(new URL(host.browserUrl!).searchParams.has('kernelOrigin')).toBe(false)
    const response = await fetch(`http://127.0.0.1:${result.httpPort}/shutdown`, { method: 'POST' })
    expect(response.status).toBe(403)
  })
  it('选区提案只暴露并替换授权文字，重复验证不会失败', () => {
    const { application, snapshot, paragraphs, authority, dataPath } = setup()
    const node = paragraphs[0]!,
      collaborationId = randomUUID()
    authority.create({
      collaborationId,
      agentId: 'pero',
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      scope: 'selection',
      selection: {
        revisionId: snapshot.revisionId,
        anchor: { nodeId: node.nodeId, offset: 4 },
        focus: { nodeId: node.nodeId, offset: 6 },
      },
    })
    const scoped = authority.inspect(collaborationId, 'pero')
    expect(scoped.nodes.map((item) => item.text).join('')).toBe('中间')
    expect(JSON.stringify(scoped)).not.toContain('另一节正文')
    const proposed = authority.propose(collaborationId, 'pero', proposal(snapshot, node, '新内容'))
    expect(proposed.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text.replace', value: '前保留 新内容 后保留' }),
      ]),
    )
    expect(
      proposed.operations.every(
        (operation) => 'nodeId' in operation && operation.nodeId === node.nodeId,
      ),
    ).toBe(true)
    expect(authority.validate(collaborationId, 'pero', proposed.changeSetId).status).toBe(
      'validated',
    )
    expect(authority.validate(collaborationId, 'pero', proposed.changeSetId).status).toBe(
      'validated',
    )
    expect(
      application.documents
        .inspect(snapshot.documentId)
        .nodes.find((item) => item.nodeId === node.nodeId)?.text,
    ).toBe(node.text)
    expect(readFileSync(path.join(dataPath, 'grants.json'), 'utf8')).not.toContain('__arcaHostAuth')
  })
  it('章节授权拒绝另一节的修改，同一角色并发任务使用不同提案 ID', () => {
    const { snapshot, paragraphs, authority } = setup()
    const firstId = randomUUID(),
      secondId = randomUUID()
    for (const collaborationId of [firstId, secondId])
      authority.create({
        collaborationId,
        agentId: 'pero',
        documentId: snapshot.documentId,
        baseRevisionId: snapshot.revisionId,
        scope: 'section',
        nodeId: paragraphs[0]!.nodeId,
      })
    expect(() =>
      authority.propose(firstId, 'pero', proposal(snapshot, paragraphs[1]!, '越界')),
    ).toThrow('授权章节')
    const first = authority.propose(
      firstId,
      'pero',
      proposal(snapshot, paragraphs[0]!, '第一份修改'),
    )
    const second = authority.propose(
      secondId,
      'pero',
      proposal(snapshot, paragraphs[0]!, '第二份修改'),
    )
    expect(first.changeSetId).not.toBe(second.changeSetId)
    expect(() => authority.validate(firstId, 'pero', second.changeSetId)).toThrow('当前任务')
  })
  it('撤销及实例重启后拒绝迟到的角色写入，持久提案仍能读取', () => {
    const { application, snapshot, paragraphs, authority, dataPath } = setup()
    const collaborationId = randomUUID()
    authority.create({
      collaborationId,
      agentId: 'pero',
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      scope: 'document',
    })
    const input = proposal(snapshot, paragraphs[0]!, '修改')
    authority.propose(collaborationId, 'pero', input)
    authority.revoke(collaborationId)
    expect(() => authority.propose(collaborationId, 'pero', input)).toThrow('有效的文稿协作授权')
    const restored = new ArcaCollaborationAuthority(
      application.documents,
      path.join(dataPath, 'grants.json'),
      'instance-2',
    )
    expect(restored.get(collaborationId)?.proposal?.status).toBe('rejected')
    expect(() => restored.require(collaborationId, 'pero')).toThrow('有效的文稿协作授权')
  })
})
