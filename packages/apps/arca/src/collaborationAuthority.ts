import { t as __t } from './i18n'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type {
  DocumentId,
  RevisionId,
  ChangeSetId,
  ProposeChangeSetInput,
  SqliteDocumentEngine,
  OfficeSelection,
  DocumentOperation,
} from '@infos/document-engine'
import {
  compileOfficeEdit,
  officeContent,
  runsOf,
  setNodeRuns,
  sliceRuns,
} from '@infos/document-engine'

export interface ArcaCollaborationGrantInput {
  collaborationId: string
  agentId: string
  documentId: string
  baseRevisionId: string
  scope: 'selection' | 'section' | 'document'
  nodeId?: string
  selection?: OfficeSelection
}
interface Grant extends ArcaCollaborationGrantInput {
  instanceId: string
  expiresAt: number
  revoked: boolean
  allowedNodeIds: string[]
  ranges: Array<{ nodeId: string; start: number; end: number; text: string }>
  changeSetId: string
}

/** 任务范围由文稿权威端校验，角色提示词不能扩大授权。 */
export class ArcaCollaborationAuthority {
  private readonly grants = new Map<string, Grant>()
  constructor(
    private readonly engine: SqliteDocumentEngine,
    private readonly file: string,
    private readonly instanceId: string,
  ) {
    if (!existsSync(file)) return
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { version: number; grants: Grant[] }
    if (stored.version !== 1 || !Array.isArray(stored.grants))
      throw new Error('Arca 协作授权文件损坏')
    for (const grant of stored.grants) this.grants.set(grant.collaborationId, grant)
  }
  create(input: ArcaCollaborationGrantInput) {
    if (
      !/^[a-f0-9-]{36}$/.test(input.collaborationId) ||
      !input.agentId ||
      !['selection', 'section', 'document'].includes(input.scope)
    )
      throw new Error('协作授权参数无效')
    const previous = this.grants.get(input.collaborationId)
    if (previous) {
      if (
        previous.instanceId !== this.instanceId ||
        JSON.stringify(this.identity(previous)) !== JSON.stringify(this.identity(input))
      )
        throw new Error('协作标识已用于其他请求')
      if (previous.revoked || previous.expiresAt <= Date.now())
        throw new Error('协作授权已失效，请重新发起')
      return this.project(previous)
    }
    const snapshot = this.engine.inspect(input.documentId as DocumentId)
    if (snapshot.revisionId !== input.baseRevisionId || snapshot.document.status !== 'active')
      throw new Error('文稿状态或基础版本已改变')
    const children = (id: string) =>
      snapshot.nodes
        .filter((node) => node.parentId === id)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
    const allowed = new Set<string>()
    const visit = (id: string) => {
      allowed.add(id)
      for (const child of children(id)) visit(child.nodeId)
    }
    const ranges: Grant['ranges'] = []
    if (input.scope === 'document') visit(snapshot.document.rootNodeId)
    else if (input.scope === 'section') {
      const selected = snapshot.nodes.find((node) => node.nodeId === input.nodeId)
      if (!selected) throw new Error('协作章节不存在')
      if (selected.type === 'section') visit(selected.nodeId)
      else {
        const siblings = children(selected.parentId ?? snapshot.document.rootNodeId)
        let start = siblings.findIndex((node) => node.nodeId === selected.nodeId)
        while (start > 0 && siblings[start]?.type !== 'heading') start--
        if (siblings[start]?.type !== 'heading') visit(selected.nodeId)
        else {
          const level = Number(siblings[start]!.attributes.level ?? 1)
          let end = start + 1
          while (
            end < siblings.length &&
            !(
              siblings[end]!.type === 'heading' &&
              Number(siblings[end]!.attributes.level ?? 1) <= level
            )
          )
            end++
          for (const node of siblings.slice(start, end)) visit(node.nodeId)
        }
      }
    } else {
      const selection = input.selection
      if (!selection || selection.revisionId !== input.baseRevisionId)
        throw new Error('协作选区版本无效')
      const ordered: typeof snapshot.nodes = []
      const order = (id: string) => {
        for (const node of children(id)) {
          if (typeof node.text === 'string') ordered.push(node)
          order(node.nodeId)
        }
      }
      order(snapshot.document.rootNodeId)
      let start = selection.anchor,
        end = selection.focus
      let a = ordered.findIndex((node) => node.nodeId === start.nodeId),
        b = ordered.findIndex((node) => node.nodeId === end.nodeId)
      if (a > b || (a === b && start.offset > end.offset)) {
        ;[start, end] = [end, start]
        ;[a, b] = [b, a]
      }
      if (a < 0 || b < 0 || (a === b && start.offset === end.offset))
        throw new Error('协作选区为空或无效')
      for (const node of ordered.slice(a, b + 1)) {
        const text = node.text ?? '',
          from = node.nodeId === start.nodeId ? start.offset : 0,
          to = node.nodeId === end.nodeId ? end.offset : text.length
        if (
          !Number.isInteger(from) ||
          !Number.isInteger(to) ||
          from < 0 ||
          to < from ||
          to > text.length
        )
          throw new Error('协作选区超出正文边界')
        const dividesCharacter = (offset: number) =>
          offset > 0 &&
          offset < text.length &&
          /[\uD800-\uDBFF]/.test(text[offset - 1]!) &&
          /[\uDC00-\uDFFF]/.test(text[offset]!)
        if (dividesCharacter(from) || dividesCharacter(to))
          throw new Error('协作选区不能截断 Unicode 字符')
        allowed.add(node.nodeId)
        ranges.push({ nodeId: node.nodeId, start: from, end: to, text: text.slice(from, to) })
      }
    }
    const grant: Grant = {
      ...this.identity(input),
      instanceId: this.instanceId,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      revoked: false,
      allowedNodeIds: [...allowed],
      ranges,
      changeSetId: `arca-collaboration:${input.collaborationId}`,
    }
    this.grants.set(input.collaborationId, grant)
    try {
      this.persist()
    } catch (error) {
      this.grants.delete(input.collaborationId)
      throw error
    }
    return this.project(grant)
  }
  get(id: string) {
    const grant = this.grants.get(id)
    return grant ? this.project(grant) : null
  }
  revoke(id: string): void {
    const grant = this.grants.get(id)
    if (!grant) return
    grant.revoked = true
    this.persist()
    const proposal = this.engine
      .listChangeSets(grant.documentId as DocumentId)
      .find((item) => item.changeSetId === grant.changeSetId)
    if (
      proposal &&
      ['proposed', 'validated', 'approved', 'conflicted', 'failed'].includes(proposal.status)
    )
      this.engine.review({
        changeSetId: proposal.changeSetId,
        reviewerPrincipalId: 'application:infos.arca',
        decision: 'reject',
        message: __t('apps.arca.ui', '协作任务已取消或失效'),
      })
  }
  close(): void {
    for (const grant of this.grants.values())
      if (grant.instanceId === this.instanceId) grant.revoked = true
    this.persist()
  }
  require(id: unknown, principal: string): Grant {
    const grant = typeof id === 'string' ? this.grants.get(id) : undefined
    if (
      !grant ||
      grant.revoked ||
      grant.instanceId !== this.instanceId ||
      grant.expiresAt <= Date.now() ||
      (principal !== grant.agentId && principal !== `agent:${grant.agentId}`)
    )
      throw new Error('当前任务没有有效的文稿协作授权')
    return grant
  }
  inspect(id: unknown, principal: string) {
    const grant = this.require(id, principal)
    const snapshot = this.engine.snapshotAt(
      grant.documentId as DocumentId,
      grant.baseRevisionId as RevisionId,
    )
    return {
      ...snapshot,
      nodes: snapshot.nodes
        .filter((node) => grant.allowedNodeIds.includes(node.nodeId))
        .map((node) => {
          const range = grant.ranges.find((item) => item.nodeId === node.nodeId)
          return range
            ? {
                ...node,
                text: range.text,
                attributes: {},
                selectionRange: { start: range.start, end: range.end },
              }
            : node
        }),
      collaborationId: grant.collaborationId,
      changeSetId: grant.changeSetId,
      scope: grant.scope,
    }
  }
  propose(id: unknown, principal: string, proposed: ProposeChangeSetInput) {
    const grant = this.require(id, principal)
    if (
      proposed.documentId !== grant.documentId ||
      proposed.baseRevisionId !== grant.baseRevisionId ||
      (proposed.changeSetId && proposed.changeSetId !== grant.changeSetId)
    )
      throw new Error('提案不属于当前协作任务')
    const baseline = this.engine.snapshotAt(
      grant.documentId as DocumentId,
      grant.baseRevisionId as RevisionId,
    )
    const allowed = new Set(grant.allowedNodeIds),
      seen = new Set<string>()
    if (!Array.isArray(proposed.operations) || !proposed.operations.length)
      throw new Error('协作提案不能为空')
    let operations: DocumentOperation[] = proposed.operations.map((operation) => {
      if (
        operation.documentId !== grant.documentId ||
        operation.baseRevisionId !== grant.baseRevisionId
      )
        throw new Error('提案操作跨越了授权文稿或版本')
      if (grant.scope === 'selection') {
        if (operation.type !== 'text.replace' || seen.has(operation.nodeId))
          throw new Error('选区协作只允许逐节点文字替换')
        const range = grant.ranges.find((item) => item.nodeId === operation.nodeId)
        const node = baseline.nodes.find((item) => item.nodeId === operation.nodeId)
        if (!range || !node || typeof operation.value !== 'string')
          throw new Error('提案超出授权选区')
        seen.add(operation.nodeId)
        // 模型只提交选区替换文本，权威端保留选区外正文。
        return {
          ...operation,
          value:
            (node.text ?? '').slice(0, range.start) +
            operation.value +
            (node.text ?? '').slice(range.end),
          actorPrincipalId: principal,
          correlationId: grant.collaborationId,
        }
      }
      if (operation.type === 'document.set_status') throw new Error('协作任务不能归档或删除文稿')
      if (operation.type === 'document.rename') {
        if (grant.scope !== 'document') throw new Error('章节协作不能修改文稿标题')
      } else if (operation.type === 'node.insert') {
        if (!allowed.has(operation.node.parentId) || allowed.has(operation.node.nodeId))
          throw new Error('新增节点超出授权范围')
        allowed.add(operation.node.nodeId)
      } else {
        if (!allowed.has(operation.nodeId)) throw new Error('提案超出授权章节')
        if (
          grant.scope === 'section' &&
          operation.nodeId === grant.nodeId &&
          ['node.delete', 'node.move'].includes(operation.type)
        )
          throw new Error('章节协作不能移除或移动授权根节点')
        if (operation.type === 'node.move' && !allowed.has(operation.newParentId))
          throw new Error('不能移动节点到授权范围外')
      }
      return { ...operation, actorPrincipalId: principal, correlationId: grant.collaborationId }
    })
    if (grant.scope === 'selection') {
      const content = officeContent(baseline)
      for (const operation of proposed.operations) {
        if (operation.type !== 'text.replace') throw new Error('选区仅支持文字替换')
        const range = grant.ranges.find((item) => item.nodeId === operation.nodeId)!
        const node = content.nodes.find((item) => item.nodeId === operation.nodeId)!
        const runs = runsOf(node)
        setNodeRuns(node, [
          ...sliceRuns(runs, 0, range.start),
          { text: operation.value, marks: sliceRuns(runs, range.start, range.start + 1)[0]?.marks },
          ...sliceRuns(runs, range.end, Infinity),
        ])
      }
      operations = compileOfficeEdit(
        baseline,
        {
          documentId: grant.documentId as DocumentId,
          baseRevisionId: grant.baseRevisionId as RevisionId,
          transactionId: `scope:${grant.collaborationId}`,
          timestamp: new Date(grant.expiresAt - 24 * 60 * 60 * 1000).toISOString(),
          intent: proposed.intent,
          content,
        },
        principal,
      )
        .operations // 排除编译器附带的根格式迁移，选区授权只覆盖实际替换的文字节点。
        .filter(
          (operation) =>
            (operation.type === 'text.replace' || operation.type === 'attribute.set') &&
            seen.has(operation.nodeId),
        )
        .map((operation) => ({ ...operation, correlationId: grant.collaborationId }))
    }
    const existing = this.engine
      .listChangeSets(grant.documentId as DocumentId)
      .find((item) => item.changeSetId === grant.changeSetId)
    if (existing) {
      if (
        JSON.stringify(existing.operations) !== JSON.stringify(operations) ||
        existing.intent !== proposed.intent
      )
        throw new Error('此协作任务已提交不同的提案')
      return existing
    }
    return this.engine.propose({
      ...proposed,
      changeSetId: grant.changeSetId as ChangeSetId,
      actorPrincipalId: principal,
      actorKind: 'agent',
      operations,
    })
  }
  validate(id: unknown, principal: string, changeSetId: unknown) {
    const grant = this.require(id, principal)
    if (changeSetId !== grant.changeSetId) throw new Error('只能验证当前任务的提案')
    const proposal = this.engine.getChangeSet(grant.changeSetId as ChangeSetId)
    if (proposal.status === 'committed') return proposal
    if (proposal.status === 'validated' || proposal.status === 'approved') {
      if (this.engine.inspect(grant.documentId as DocumentId).revisionId !== grant.baseRevisionId)
        throw new Error('文稿版本已改变，请重新发起协作')
      return proposal
    }
    if (proposal.status !== 'proposed') throw new Error('当前提案已失效或被拒绝')
    return this.engine.validate(grant.changeSetId as ChangeSetId)
  }
  private identity(input: ArcaCollaborationGrantInput): ArcaCollaborationGrantInput {
    return {
      collaborationId: input.collaborationId,
      agentId: input.agentId,
      documentId: input.documentId,
      baseRevisionId: input.baseRevisionId,
      scope: input.scope,
      nodeId: input.nodeId,
      selection: input.selection,
    }
  }
  private project(grant: Grant) {
    const proposal = this.engine
      .listChangeSets(grant.documentId as DocumentId)
      .find((item) => item.changeSetId === grant.changeSetId)
    return {
      ...this.identity(grant),
      instanceId: grant.instanceId,
      changeSetId: grant.changeSetId,
      ranges: grant.ranges,
      revoked: grant.revoked,
      expiresAt: grant.expiresAt,
      proposal: proposal ?? null,
    }
  }
  private persist(): void {
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, grants: [...this.grants.values()] }), {
      mode: 0o600,
      flush: true,
    })
    renameSync(temporary, this.file)
  }
}
