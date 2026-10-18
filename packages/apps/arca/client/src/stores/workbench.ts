/**
 * workbench — 响应式状态仓储
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { defineStore } from 'pinia'
import type { OfficeSelection } from '@infos/document-engine/office'
import type { KernelNodeId, ApplicationTaskSnapshot } from '@infos/shared'
import type {
  DocumentCommitReceipt,
  DocumentNode,
  DocumentNodeId,
  DocumentNodeType,
  DocumentProjection,
  DocumentSemanticDiff,
  PresentationProjection,
  DocumentSnapshot,
  OutlineNode,
  SemanticDocument,
} from '@infos/document-engine'
import {
  arcaCollaborationClient,
  type ArcaCollaborationAgent,
  type ArcaCollaborationTask,
} from '../services/collaboration'
import { DocumentDraftStore, type PersistedDocumentDraft } from '../services/draftStore'
import { resolveArcaEndpoint } from '../services/discovery'
import { arcaPreferenceStore } from '../services/settings'
import { ArcaBrowserTransport } from '../services/transport'

export type ClientConnectionState =
  | 'idle'
  | 'discovering'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'error'

interface SurfaceBootstrap {
  documents: SemanticDocument[]
  authorityState: 'writable' | 'authority_conflict' | 'unavailable'
  activeDocument: null | {
    snapshot: DocumentSnapshot
    outline: DocumentProjection<OutlineNode[]>
    markdown: DocumentProjection<string> & { format: 'markdown' }
  }
}

interface ClientComment {
  commentId: string
  documentId: string
  nodeId: string
  revisionId: string
  authorPrincipalId: string
  body: string
  status: 'open' | 'resolved'
  createdAt: string
  resolvedBy?: string
  anchor?: { quote: string }
  anchorState?: 'attached' | 'missing' | 'ambiguous'
  currentRange?: { start: number; end: number }
}

interface ClientChangeSet {
  changeSetId: string
  documentId: string
  baseRevisionId: string
  actorPrincipalId: string
  intent: string
  explanation: string
  risk: 'low' | 'medium' | 'high' | 'executable'
  status: string
  updatedAt: string
}

interface ClientRevisionEntry {
  restorable?: boolean
  revision: {
    revisionId: string
    sequence: number
    actorPrincipalId: string
    intent: string
    committedAt: string
  }
}

interface SurfaceSession {
  sessionId: string
  token: string
  principalId: string
  connectionGeneration: number
  expiresAt: string
}

const draftStore = new DocumentDraftStore()
const clientNodeId = `arca-client-${crypto.randomUUID()}` as KernelNodeId
const principalId = 'human:local-user'

export const useWorkbenchStore = defineStore('arca-workbench', {
  state: () => ({
    connection: 'idle' as ClientConnectionState,
    connectSequence: 0,
    endpoint: undefined as string | undefined,
    hostNodeId: undefined as string | undefined,
    hostOnline: false,
    kernelOnline: false,
    authority: 'unknown' as 'unknown' | 'writable' | 'read-only' | 'unavailable' | 'conflict',
    documents: [] as SemanticDocument[],
    activeDocument: null as SurfaceBootstrap['activeDocument'],
    activeNavigator: 'documents' as
      | 'documents'
      | 'outline'
      | 'search'
      | 'assets'
      | 'tasks'
      | 'export'
      | null,
    contextStudio: null as 'properties' | 'intelligence' | 'review' | 'comments' | 'history' | null,
    themePreference: (localStorage.getItem('arca-theme-preference') ?? 'system') as
      | 'light'
      | 'dark'
      | 'system',
    resolvedTheme: 'light' as 'light' | 'dark',
    hostTheme: undefined as 'light' | 'dark' | undefined,
    focusMode: false,
    errorMessage: '',
    reconnectAttempt: 0,
    transport: undefined as ArcaBrowserTransport | undefined,
    session: undefined as SurfaceSession | undefined,
    drafts: [] as PersistedDocumentDraft[],
    officeDirty: false,
    applicationStopping: false,
    applicationStopped: false,
    foregroundOperations: 0,
    officeCharacterCount: undefined as number | undefined,
    pendingChangeSets: [] as ClientChangeSet[],
    selectedChangeSet: undefined as ClientChangeSet | undefined,
    semanticDiff: undefined as DocumentSemanticDiff | undefined,
    comments: [] as ClientComment[],
    collaborationAvailable: false,
    collaborationAgents: [] as ArcaCollaborationAgent[],
    collaborationTasks: [] as ArcaCollaborationTask[],
    localCollaborationTasks: [] as ArcaCollaborationTask[],
    collaborationBusy: false,
    revisions: [] as ClientRevisionEntry[],
    searchQuery: '',
    presentation: undefined as PresentationProjection | undefined,
    surfaceMode: 'document' as 'document' | 'presentation',
    packageState: 'idle' as 'idle' | 'exporting' | 'importing' | 'completed' | 'failed',
    lastReceipt: undefined as DocumentCommitReceipt | undefined,
    editState: 'idle' as 'idle' | 'dirty' | 'saving' | 'saved' | 'conflicted' | 'failed',
    reconnectTimer: undefined as number | undefined,
  }),
  getters: {
    activeDocumentId: (state): string | undefined => state.activeDocument?.snapshot.documentId,
    documentTitle: (state): string => state.activeDocument?.snapshot.document.title ?? 'Arca',
    revisionLabel: (state) => {
      const revision = state.activeDocument?.snapshot.revisionId
      return revision ? String(revision).slice(0, 8) : '—'
    },
    wordCount: (state) =>
      state.officeCharacterCount ??
      state.activeDocument?.snapshot.nodes.reduce(
        (sum, node) => sum + [...(node.text ?? String(node.attributes.text ?? ''))].length,
        0,
      ) ??
      0,
    searchResults: (state): DocumentNode[] => {
      const query = state.searchQuery.trim().toLocaleLowerCase()
      if (!query) return []
      return (state.activeDocument?.snapshot.nodes ?? []).filter((node) =>
        node.text?.toLocaleLowerCase().includes(query),
      )
    },
  },
  actions: {
    async invokeModelAuthority(operation: string, input: Record<string, unknown> = {}) {
      if (!this.transport || !this.session)
        throw new Error('ARCA_HOST_UNAVAILABLE: Arca Host未连接')
      return this.transport.invoke(
        operation,
        { ...input, surfaceSessionToken: this.session.token },
        { providerId: 'infos.arca.model-authority', idempotencyKey: crypto.randomUUID() },
      )
    },
    async connect(endpoint = resolveArcaEndpoint()): Promise<void> {
      if (this.applicationStopping || this.applicationStopped) return
      const sequence = ++this.connectSequence
      this.connection = 'discovering'
      this.errorMessage = ''
      if (!endpoint) {
        this.connection = 'offline'
        this.hostOnline = false
        this.session = undefined
        this.authority = 'unavailable'
        return
      }
      this.endpoint = endpoint
      this.connection = this.reconnectAttempt ? 'reconnecting' : 'connecting'
      const transport = new ArcaBrowserTransport(clientNodeId)
      transport.onDisconnect(() => {
        if (this.transport !== transport || sequence !== this.connectSequence) return
        this.hostOnline = false
        this.session = undefined
        this.authority = 'unavailable'
        this.scheduleReconnect()
      })
      try {
        const hello = await transport.connect(endpoint)
        if (sequence !== this.connectSequence) {
          await transport.close()
          return
        }
        const offer = hello.offers.find(
          (candidate) => candidate.capabilityType === 'document.semantic',
        )
        if (!offer) throw new Error('ARCA_DOCUMENT_OFFER_MISSING')
        this.transport = transport
        this.hostNodeId = hello.descriptor.nodeId
        const challenge = (await transport.invoke('surface.session.challenge', {
          clientNodeId,
          principalId,
        })) as { challengeId: string; nonce: string }
        if (sequence !== this.connectSequence) {
          await transport.close()
          return
        }
        const session = (await transport.invoke('surface.session.complete', {
          ...challenge,
          clientNodeId,
          principalId,
        })) as SurfaceSession
        if (sequence !== this.connectSequence) {
          await transport.close()
          return
        }
        this.session = session
        this.hostOnline = true
        this.authority = 'writable'
        const bootstrap = (await transport.invoke('surface.bootstrap', {
          documentId: this.activeDocumentId,
        })) as SurfaceBootstrap
        if (sequence !== this.connectSequence) {
          await transport.close()
          return
        }
        this.applyBootstrap(bootstrap)
        this.connection = 'ready'
        this.reconnectAttempt = 0
        await this.loadChangeSets()
        await this.loadComments()
        await this.loadCollaborationTasks()
        await this.loadRevisions()
        if (sequence !== this.connectSequence) return
        this.restoreDrafts()
      } catch (error) {
        await transport.close()
        if (sequence !== this.connectSequence) return
        if (this.transport === transport) this.transport = undefined
        this.hostOnline = false
        this.session = undefined
        this.authority = 'unavailable'
        this.connection = 'error'
        this.errorMessage = error instanceof Error ? error.message : String(error)
      }
    },
    async openDocument(documentId: string): Promise<void> {
      if (!this.transport) return
      const bootstrap = (await this.transport.invoke('surface.bootstrap', {
        documentId,
      })) as SurfaceBootstrap
      this.applyBootstrap(bootstrap)
      await this.loadChangeSets()
      await this.loadComments()
      await this.loadCollaborationTasks()
      await this.loadRevisions()
      this.restoreDrafts()
    },
    saveDraft(nodeId: DocumentNodeId, value: string): void {
      const snapshot = this.activeDocument?.snapshot
      const node = snapshot?.nodes.find((candidate) => candidate.nodeId === nodeId)
      if (!snapshot || !node) return
      const draft: PersistedDocumentDraft = {
        protocolVersion: 1,
        documentId: snapshot.documentId,
        nodeId,
        baseRevisionId: snapshot.revisionId,
        expectedGeneration: node.generation,
        value,
        updatedAt: new Date().toISOString(),
      }
      draftStore.save(draft)
      this.drafts = this.drafts.filter((candidate) => candidate.nodeId !== nodeId)
      this.drafts.push(draft)
      this.editState = 'dirty'
    },
    async commitDraft(nodeId: DocumentNodeId): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      const session = this.session
      const draft = this.drafts.find((candidate) => candidate.nodeId === nodeId)
      if (!snapshot || !session || !draft || !this.transport) return
      if (draft.baseRevisionId !== snapshot.revisionId) {
        this.editState = 'conflicted'
        return
      }
      this.editState = 'saving'
      const idempotencyKey = `human-edit:${snapshot.documentId}:${crypto.randomUUID()}`
      try {
        this.lastReceipt = (await this.transport.invoke(
          'document.edit_text',
          {
            ...draft,
            transactionId: idempotencyKey,
            surfaceSessionToken: session.token,
          },
          { idempotencyKey },
        )) as DocumentCommitReceipt
        draftStore.remove(snapshot.documentId, nodeId)
        this.drafts = this.drafts.filter((candidate) => candidate.nodeId !== nodeId)
        this.editState = 'saved'
        await this.openDocument(snapshot.documentId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.errorMessage = message
        this.editState = message.includes('REVISION_CONFLICT') ? 'conflicted' : 'failed'
      }
    },
    restoreDrafts(): void {
      const documentId = this.activeDocument?.snapshot.documentId
      this.drafts = documentId ? draftStore.list(documentId) : []
      if (this.drafts.length) this.editState = 'dirty'
    },
    async createDocument(title: string, language = 'zh-CN'): Promise<string | undefined> {
      if (!this.transport || !this.session || !title.trim()) return
      const snapshot = (await this.transport.invoke(
        'document.create',
        { title: title.trim(), language, surfaceSessionToken: this.session.token },
        { idempotencyKey: `create-document:${crypto.randomUUID()}` },
      )) as DocumentSnapshot
      const root = snapshot.nodes.find((node) => node.nodeId === snapshot.document.rootNodeId)
      if (root) {
        const key = `create-first-block:${crypto.randomUUID()}`
        await this.transport.invoke(
          'document.node.insert',
          {
            documentId: snapshot.documentId,
            surfaceSessionToken: this.session.token,
            nodeId: crypto.randomUUID(),
            type: 'paragraph',
            parentId: root.nodeId,
            parentGeneration: root.generation,
            orderKey: '0001',
            text: '',
            attributes: {},
            intent: '创建首个正文块',
          },
          { idempotencyKey: key },
        )
      }
      await this.openDocument(snapshot.documentId)
      return snapshot.documentId
    },
    async renameDocument(title: string, documentId?: string): Promise<void> {
      documentId ??= this.activeDocumentId
      if (!this.transport || !this.session || !documentId) throw new Error('请先连接应用')
      if (!title.trim()) throw new Error('请输入文稿名称')
      await this.transport.invoke(
        'document.rename',
        { documentId, title: title.trim(), surfaceSessionToken: this.session.token },
        { idempotencyKey: crypto.randomUUID() },
      )
      await this.refreshDocumentIndex()
      if (this.activeDocumentId === documentId) await this.openDocument(documentId)
    },
    async insertNodeAfter(
      reference: DocumentNode,
      type: Exclude<DocumentNodeType, 'document-root'>,
    ): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      if (!snapshot || !reference.parentId) return
      const parent = snapshot.nodes.find((node) => node.nodeId === reference.parentId)
      if (!parent) return
      const siblings = snapshot.nodes
        .filter((node) => node.parentId === parent.nodeId)
        .sort((left, right) => left.orderKey.localeCompare(right.orderKey))
      const last = siblings.at(-1)?.orderKey ?? '0000'
      const orderKey = `${last}~${Date.now().toString(36)}`
      await this.invokeSurfaceMutation('document.node.insert', {
        nodeId: crypto.randomUUID(),
        type,
        parentId: parent.nodeId,
        parentGeneration: parent.generation,
        orderKey,
        text: type === 'heading' ? '新标题' : '',
        attributes: type === 'heading' ? { level: 2 } : {},
      })
    },
    async deleteNode(node: DocumentNode): Promise<void> {
      await this.invokeSurfaceMutation('document.node.delete', {
        nodeId: node.nodeId,
        expectedGeneration: node.generation,
        recursive: true,
      })
    },
    async moveNode(node: DocumentNode, edge: 'start' | 'end'): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      if (!snapshot || !node.parentId) return
      const parent = snapshot.nodes.find((candidate) => candidate.nodeId === node.parentId)
      if (!parent) return
      await this.invokeSurfaceMutation('document.node.move', {
        nodeId: node.nodeId,
        expectedGeneration: node.generation,
        newParentId: parent.nodeId,
        newParentGeneration: parent.generation,
        newOrderKey:
          edge === 'start' ? `!${Date.now().toString(36)}` : `~${Date.now().toString(36)}`,
      })
    },
    async invokeSurfaceMutation(operation: string, input: Record<string, unknown>): Promise<void> {
      if (!this.transport || !this.session || !this.activeDocumentId) return
      this.editState = 'saving'
      const key = `surface:${operation}:${crypto.randomUUID()}`
      try {
        this.lastReceipt = (await this.transport.invoke(
          operation,
          { ...input, documentId: this.activeDocumentId, surfaceSessionToken: this.session.token },
          { idempotencyKey: key },
        )) as DocumentCommitReceipt
        this.editState = 'saved'
        await this.openDocument(this.activeDocumentId)
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error)
        this.editState = 'failed'
        throw error
      }
    },
    async loadRevisions(): Promise<void> {
      if (!this.transport || !this.activeDocumentId) {
        this.revisions = []
        return
      }
      const result: unknown = await this.transport.invoke('document.revision.list', {
        documentId: this.activeDocumentId,
      })
      this.revisions = result as ClientRevisionEntry[]
    },
    async loadChangeSets(): Promise<void> {
      const documentId = this.activeDocument?.snapshot.documentId
      if (!this.transport || !documentId) {
        this.pendingChangeSets = []
        return
      }
      const result = await this.transport.invoke('document.changeset.list', { documentId })
      this.pendingChangeSets = (result as ClientChangeSet[]).filter(
        (changeSet) => !['committed', 'rejected', 'superseded'].includes(changeSet.status),
      )
    },
    async loadCollaborationTasks(): Promise<void> {
      const documentId = this.activeDocumentId
      if (!documentId) {
        this.collaborationAvailable = false
        this.collaborationTasks = []
        return
      }
      const localModelId = arcaPreferenceStore.load().modelConfigId
      this.collaborationAvailable = Boolean(localModelId && this.transport && this.session)
      this.collaborationAgents = this.collaborationAvailable
        ? [{ id: 'arca-local', name: 'Arca 本地模型' }]
        : []
      if (this.transport && this.session) {
        try {
          const tasks = (await this.transport.invoke(
            'task.list',
            { documentId, surfaceSessionToken: this.session.token },
            { providerId: 'infos.arca.tasks' },
          )) as ApplicationTaskSnapshot<ArcaCollaborationTask>[]
          this.localCollaborationTasks = tasks.flatMap((task) => (task.result ? [task.result] : []))
          if (this.localCollaborationTasks.some((task) => task.status === 'awaiting_review'))
            await this.loadChangeSets()
        } catch (error) {
          this.errorMessage = error instanceof Error ? error.message : '协作任务暂时无法读取'
        }
      }
      if (this.transport && this.session && localModelId) {
        this.collaborationAvailable = true
        this.collaborationAgents = [{ id: 'arca-local', name: 'Arca本地模型' }]
      }
      if (!arcaCollaborationClient.available()) {
        this.kernelOnline = false
        this.collaborationTasks = [...this.localCollaborationTasks]
        return
      }
      try {
        const status = await arcaCollaborationClient.status()
        this.kernelOnline = true
        this.collaborationAvailable ||= status.available
        if (status.available)
          this.collaborationAgents = [
            ...this.collaborationAgents,
            ...status.agents.filter((agent) => agent.id !== 'arca-local'),
          ]
        const kernelTasks = status.available ? await arcaCollaborationClient.list(documentId) : []
        this.collaborationTasks = [...this.localCollaborationTasks, ...kernelTasks]
        if (kernelTasks.some((task) => task.status === 'awaiting_review')) {
          await this.loadChangeSets()
        }
      } catch {
        this.kernelOnline = false
        this.collaborationTasks = [...this.localCollaborationTasks]
        this.collaborationAvailable = Boolean(localModelId && this.transport && this.session)
      }
    },
    async createCollaborationTask(input: {
      instruction: string
      scope: 'selection' | 'section' | 'document'
      selection?: OfficeSelection
      nodeId?: string
      agentId: string
      requirements?: string
    }): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      if (!snapshot || !this.collaborationAvailable) return
      this.collaborationBusy = true
      const localModelId = arcaPreferenceStore.load().modelConfigId
      try {
        if (input.agentId === 'arca-local' && localModelId && this.transport && this.session) {
          const payload = {
            documentId: snapshot.documentId,
            baseRevisionId: snapshot.revisionId,
            ...input,
            modelId: localModelId,
          }
          const storageKey = `arca.task.pending:${this.endpoint}:${snapshot.documentId}`
          const serialized = JSON.stringify(payload)
          let pending: { key: string; payload: string } | undefined
          try {
            pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? undefined
          } catch {
            /* 损坏的请求记录由下一次提交替换。 */
          }
          if (!pending || pending.payload !== serialized)
            pending = { key: crypto.randomUUID(), payload: serialized }
          localStorage.setItem(storageKey, JSON.stringify(pending))
          await this.transport.invoke(
            'task.submit',
            {
              operation: 'office.collaborate',
              input: payload,
              surfaceSessionToken: this.session.token,
            },
            { idempotencyKey: pending.key, providerId: 'infos.arca.tasks' },
          )
          localStorage.removeItem(storageKey)
          await this.loadCollaborationTasks()
          return
        }
        await arcaCollaborationClient.create({
          documentId: snapshot.documentId,
          baseRevisionId: snapshot.revisionId,
          ...input,
        })
        await this.loadCollaborationTasks()
      } finally {
        this.collaborationBusy = false
      }
    },
    async cancelCollaborationTask(taskId: string): Promise<void> {
      if (
        this.localCollaborationTasks.some((task) => task.taskId === taskId) &&
        this.transport &&
        this.session
      ) {
        await this.transport.invoke(
          'task.cancel',
          { taskId, surfaceSessionToken: this.session.token },
          { idempotencyKey: `cancel:${taskId}`, providerId: 'infos.arca.tasks' },
        )
      } else await arcaCollaborationClient.cancel(taskId)
      await this.loadCollaborationTasks()
    },
    async retryCollaborationTask(taskId: string): Promise<void> {
      if (!this.transport || !this.session) return
      await this.transport.invoke(
        'task.retry',
        { taskId, surfaceSessionToken: this.session.token },
        { idempotencyKey: crypto.randomUUID(), providerId: 'infos.arca.tasks' },
      )
      await this.loadCollaborationTasks()
    },
    async restoreRevision(revisionId: string): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      if (!this.transport || !this.session || !snapshot) return
      await this.transport.invoke(
        'document.restore_revision',
        {
          documentId: snapshot.documentId,
          baseRevisionId: snapshot.revisionId,
          revisionId,
          timestamp: new Date().toISOString(),
          surfaceSessionToken: this.session.token,
        },
        { idempotencyKey: crypto.randomUUID() },
      )
      await this.openDocument(snapshot.documentId)
    },
    async refreshDocumentIndex(): Promise<void> {
      if (this.transport)
        this.documents = (await this.transport.invoke('document.list', {})) as SemanticDocument[]
    },
    async setDocumentStatus(documentId: string, status: SemanticDocument['status']): Promise<void> {
      if (!this.transport || !this.session) return
      const snapshot = (await this.transport.invoke('document.inspect', {
        documentId,
      })) as DocumentSnapshot
      await this.transport.invoke(
        'document.set_status',
        {
          documentId,
          status,
          baseRevisionId: snapshot.revisionId,
          timestamp: new Date().toISOString(),
          surfaceSessionToken: this.session.token,
        },
        { idempotencyKey: crypto.randomUUID() },
      )
      await this.refreshDocumentIndex()
      if (this.activeDocumentId === documentId) await this.openDocument(documentId)
    },
    async duplicateDocument(documentId: string): Promise<string | undefined> {
      if (!this.transport || !this.session) return
      const source = (await this.transport.invoke('document.inspect', {
        documentId,
      })) as DocumentSnapshot
      const copy = (await this.transport.invoke(
        'document.duplicate',
        {
          documentId,
          baseRevisionId: source.revisionId,
          title: `${source.document.title}（副本）`,
          surfaceSessionToken: this.session.token,
        },
        { idempotencyKey: crypto.randomUUID() },
      )) as DocumentSnapshot
      await this.refreshDocumentIndex()
      return copy.documentId
    },
    async loadComments(): Promise<void> {
      const documentId = this.activeDocument?.snapshot.documentId
      if (!this.transport || !documentId) {
        this.comments = []
        return
      }
      this.comments = (await this.transport.invoke('document.comment.list', {
        documentId,
      })) as ClientComment[]
    },
    async createComment(
      nodeId: string,
      body: string,
      range?: { start: number; end: number },
    ): Promise<void> {
      const snapshot = this.activeDocument?.snapshot
      if (!this.transport || !this.session || !snapshot || !body.trim()) return
      const key = `comment:${crypto.randomUUID()}`
      await this.transport.invoke(
        'document.comment.create',
        {
          documentId: snapshot.documentId,
          nodeId,
          revisionId: snapshot.revisionId,
          body,
          ...(range ? { range } : {}),
          surfaceSessionToken: this.session.token,
        },
        { idempotencyKey: key },
      )
      await this.loadComments()
    },
    async resolveComment(commentId: string): Promise<void> {
      if (!this.transport || !this.session) return
      await this.transport.invoke(
        'document.comment.resolve',
        { commentId, surfaceSessionToken: this.session.token },
        { idempotencyKey: `resolve-comment:${commentId}` },
      )
      await this.loadComments()
    },
    async togglePresentation(): Promise<void> {
      const documentId = this.activeDocument?.snapshot.documentId
      if (!this.transport || !documentId) return
      if (this.surfaceMode === 'presentation') {
        this.surfaceMode = 'document'
        return
      }
      this.presentation = (await this.transport.invoke('document.project_presentation', {
        documentId,
      })) as PresentationProjection
      this.surfaceMode = 'presentation'
    },
    async exportProject(): Promise<void> {
      if (!this.transport || !this.activeDocumentId) return
      this.packageState = 'exporting'
      try {
        const result = (await this.transport.invoke('project.package.export', {
          title: this.documentTitle,
          documentIds: [this.activeDocumentId],
          historyMode: 'full',
        })) as { base64: string }
        const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))
        const url = URL.createObjectURL(
          new Blob([bytes], { type: 'application/vnd.infos.arca-project+zip' }),
        )
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${this.documentTitle.replace(/[\\/:*?"<>|]/g, '_')}.arca`
        anchor.click()
        URL.revokeObjectURL(url)
        this.packageState = 'completed'
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error)
        this.packageState = 'failed'
      }
    },
    async importProject(file: File): Promise<void> {
      if (!this.transport || !this.session) return
      this.packageState = 'importing'
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        await this.transport.invoke(
          'project.package.import',
          { base64: btoa(binary), surfaceSessionToken: this.session.token },
          { idempotencyKey: `import-project:${crypto.randomUUID()}` },
        )
        this.packageState = 'completed'
        await this.openDocument(this.activeDocumentId ?? '')
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error)
        this.packageState = 'failed'
      }
    },
    async selectChangeSet(changeSetId: string): Promise<void> {
      if (!this.transport) return
      const existing = (await this.transport.invoke('document.changeset.get', {
        changeSetId,
      })) as ClientChangeSet
      if (existing.status === 'proposed')
        await this.transport.invoke(
          'document.changeset.validate',
          { changeSetId },
          { idempotencyKey: crypto.randomUUID() },
        )
      const [changeSet, diff] = await Promise.all([
        this.transport.invoke('document.changeset.get', { changeSetId }),
        this.transport.invoke('document.changeset.diff', { changeSetId }),
      ])
      this.selectedChangeSet = changeSet as ClientChangeSet
      this.semanticDiff = diff as DocumentSemanticDiff
      this.contextStudio = 'review'
    },
    async reviewChangeSet(
      changeSetId: string,
      decision: 'approve' | 'reject' | 'request_changes',
      message = '',
    ): Promise<void> {
      if (!this.transport || !this.session) return
      const reviewKey = `review:${changeSetId}:${decision}:${crypto.randomUUID()}`
      await this.transport.invoke(
        'document.changeset.review',
        { changeSetId, decision, message, surfaceSessionToken: this.session.token },
        { idempotencyKey: reviewKey },
      )
      if (decision === 'approve') {
        this.lastReceipt = (await this.transport.invoke(
          'document.changeset.commit',
          { changeSetId, surfaceSessionToken: this.session.token },
          { idempotencyKey: `commit:${changeSetId}` },
        )) as DocumentCommitReceipt
      }
      if (this.activeDocumentId) await this.openDocument(this.activeDocumentId)
      this.selectedChangeSet = undefined
      this.semanticDiff = undefined
    },
    scheduleReconnect(): void {
      if (this.applicationStopping || this.applicationStopped) return
      if (this.reconnectTimer !== undefined || !this.endpoint) return
      this.connection = 'reconnecting'
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5))
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = undefined
        void this.reconnect().then(() => {
          if (this.connection !== 'ready') this.scheduleReconnect()
        })
      }, delay)
    },
    async disconnect(): Promise<void> {
      this.connectSequence += 1
      if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
      const transport = this.transport
      this.transport = undefined
      this.endpoint = undefined
      this.hostOnline = false
      this.session = undefined
      this.authority = 'unavailable'
      this.connection = 'offline'
      await transport?.close()
    },
    async reconnect(endpoint?: string): Promise<void> {
      const target = endpoint ?? this.endpoint ?? resolveArcaEndpoint()
      this.reconnectAttempt += 1
      await this.disconnect()
      await this.connect(target)
    },
    applyBootstrap(bootstrap: SurfaceBootstrap): void {
      this.documents = bootstrap.documents
      this.activeDocument = bootstrap.activeDocument
      this.authority =
        bootstrap.authorityState === 'authority_conflict' ? 'conflict' : bootstrap.authorityState
    },
    toggleNavigator(value: NonNullable<typeof this.activeNavigator>): void {
      this.activeNavigator = this.activeNavigator === value ? null : value
    },
    toggleStudio(value: NonNullable<typeof this.contextStudio>): void {
      this.contextStudio = this.contextStudio === value ? null : value
    },
    applyTheme(): void {
      // 明确选择优先；跟随模式才采用宿主或系统主题。
      this.resolvedTheme =
        this.themePreference === 'system'
          ? (this.hostTheme ??
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
          : this.themePreference
      document.documentElement.dataset.theme = this.resolvedTheme
    },
    cycleTheme(): void {
      const order = ['system', 'light', 'dark'] as const
      this.themePreference = order[(order.indexOf(this.themePreference) + 1) % order.length]!
      localStorage.setItem('arca-theme-preference', this.themePreference)
      this.applyTheme()
    },
    toggleFocusMode(): void {
      this.focusMode = !this.focusMode
    },
  },
})
