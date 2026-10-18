import type { DocumentSnapshot } from '@infos/document-engine'
import {
  officeContent,
  validateOfficeContent,
  type OfficeContent,
  type OfficeEditRequest,
  type OfficeEditResult,
} from '@infos/document-engine/office'

interface SavedDraft {
  version: 1
  baseline: DocumentSnapshot
  content: OfficeContent
  pending?: OfficeEditRequest
  dirty: boolean
  recoveryRaw?: string
}
export type OfficeSaveState = 'saved' | 'dirty' | 'saving' | 'conflicted' | 'failed'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 草稿、在途请求和基础版本一并保护；未知回执重试使用原事务标识。 */
export class OfficeSession {
  baseline: DocumentSnapshot
  content: OfficeContent
  state: OfficeSaveState = 'saved'
  error = ''
  unreadableDraft = ''
  readonly history: OfficeContent[] = []
  readonly future: OfficeContent[] = []
  private pending?: OfficeEditRequest
  private dirty = false
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private sequence = 0
  private detached = false
  private coalesce = { key: '', at: 0 }
  private readonly key: string
  private serializedContent?: { value: OfficeContent; json: string }
  private serializedBaseline?: { value: DocumentSnapshot; json: string }
  private serializedPending?: { value: OfficeEditRequest; json: string }

  /** 内容只通过事务替换；撤销栈共享不可变快照，序列化结果随对象身份复用。 */
  private contentJson(): string {
    if (this.serializedContent?.value !== this.content)
      this.serializedContent = { value: this.content, json: JSON.stringify(this.content) }
    return this.serializedContent.json
  }
  constructor(
    snapshot: DocumentSnapshot,
    endpoint: string,
    private readonly send: (request: OfficeEditRequest) => Promise<OfficeEditResult>,
    private readonly changed: () => void,
    private readonly saved: (snapshot: DocumentSnapshot) => void,
  ) {
    this.baseline = copy(snapshot)
    this.content = officeContent(snapshot)
    this.key = `arca.office.v1:${endpoint}:${snapshot.documentId}`
    let raw: string | null = null
    try {
      raw = localStorage.getItem(this.key)
      const draft = raw ? (JSON.parse(raw) as SavedDraft) : null
      if (draft && draft.version !== 1) throw new Error('草稿版本不受支持')
      if (
        draft?.version === 1 &&
        draft.baseline.documentId === snapshot.documentId &&
        (draft.dirty || draft.pending)
      ) {
        validateOfficeContent(draft.content, draft.baseline.document.rootNodeId)
        if (draft.pending) {
          if (
            draft.pending.documentId !== snapshot.documentId ||
            draft.pending.baseRevisionId !== draft.baseline.revisionId
          )
            throw new Error('草稿请求与基础版本不一致')
          validateOfficeContent(draft.pending.content, draft.baseline.document.rootNodeId)
        }
        this.baseline = draft.baseline
        this.content = draft.content
        this.pending = draft.pending
        this.dirty = draft.dirty
        this.state = 'dirty'
      }
      this.unreadableDraft = draft?.recoveryRaw ?? ''
    } catch {
      this.unreadableDraft = raw ?? ''
      this.error = '草稿缓存无法读取，原始缓存已保留，请先下载草稿备份核对'
      this.state = 'failed'
    }
  }
  get hasChanges(): boolean {
    return this.dirty || !!this.pending
  }
  get recoverable(): boolean {
    try {
      const draft = JSON.parse(localStorage.getItem(this.key) ?? 'null') as SavedDraft | null
      return (
        !!draft &&
        draft.version === 1 &&
        JSON.stringify(draft.content) === this.contentJson() &&
        draft.baseline.documentId === this.baseline.documentId
      )
    } catch {
      return false
    }
  }
  mutate(intent: string, edit: (content: OfficeContent) => void, coalesceKey = ''): void {
    const before = this.content,
      previousJson = this.contentJson(),
      next = JSON.parse(previousJson) as OfficeContent
    edit(next)
    const nextJson = JSON.stringify(next)
    if (previousJson === nextJson) return
    if (!coalesceKey || this.coalesce.key !== coalesceKey || Date.now() - this.coalesce.at > 800) {
      this.history.push(before)
      if (this.history.length > 60) this.history.shift()
    }
    this.coalesce = { key: coalesceKey, at: Date.now() }
    this.future.length = 0
    this.content = next
    this.serializedContent = { value: next, json: nextJson }
    this.intent = intent
    this.markDirty()
  }
  private intent = '编辑办公文稿'
  undo(): void {
    const target = this.history.pop()
    if (!target) return
    this.future.push(this.content)
    this.content = target
    this.coalesce.key = ''
    this.markDirty()
  }
  redo(): void {
    const target = this.future.pop()
    if (!target) return
    this.history.push(this.content)
    this.content = target
    this.coalesce.key = ''
    this.markDirty()
  }
  private markDirty(): void {
    this.sequence++
    this.dirty = true
    if (this.state !== 'conflicted') this.state = 'dirty'
    if (!this.persist()) return
    this.changed()
    clearTimeout(this.timer)
    if (!this.detached && this.state !== 'conflicted')
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {})
      }, 650)
  }
  private persist(): boolean {
    try {
      if (this.serializedBaseline?.value !== this.baseline)
        this.serializedBaseline = { value: this.baseline, json: JSON.stringify(this.baseline) }
      if (this.pending && this.serializedPending?.value !== this.pending)
        this.serializedPending = { value: this.pending, json: JSON.stringify(this.pending) }
      if (!this.pending) this.serializedPending = undefined
      const pending = this.pending ? `,"pending":${this.serializedPending!.json}` : ''
      const recovery = this.unreadableDraft
        ? `,"recoveryRaw":${JSON.stringify(this.unreadableDraft)}`
        : ''
      // 保持每次编辑立即落盘与原有草稿格式，只复用未变的基础版本和正文编码。
      localStorage.setItem(
        this.key,
        `{"version":1,"baseline":${this.serializedBaseline.json},"content":${this.contentJson()},"dirty":${this.dirty}${pending}${recovery}}`,
      )
      return true
    } catch {
      this.state = 'failed'
      this.error = '本地草稿存储失败，尚未关闭的内容仍保留在当前页面，请复制备份'
      this.changed()
      return false
    }
  }
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.running) return this.running
    const task = this.submit().finally(() => {
      this.running = undefined
    })
    this.running = task
    return task
  }
  private async submit(): Promise<void> {
    if (this.state === 'conflicted') throw new Error(this.error || '请先处理文稿版本冲突')
    while (this.hasChanges) {
      if (!this.pending)
        this.pending = {
          documentId: this.baseline.documentId,
          baseRevisionId: this.baseline.revisionId,
          transactionId: `office:${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          intent: this.intent,
          content: copy(this.content),
        }
      if (!this.persist()) throw new Error(this.error)
      const request = this.pending,
        sequence = this.sequence
      this.state = 'saving'
      this.error = ''
      this.changed()
      try {
        const response = await this.send(request)
        if (
          response.snapshot.documentId !== this.baseline.documentId ||
          (response.receipt && response.receipt.status !== 'committed')
        )
          throw new Error('保存回执与文稿不一致')
        this.baseline = copy(response.snapshot)
        this.pending = undefined
        // 重启恢复或失败重试时，在途请求可能比当前草稿旧，不能仅凭本轮序号相同判定已保存。
        this.dirty = this.contentJson() !== JSON.stringify(request.content)
        if (this.sequence === sequence && !this.dirty)
          this.content = officeContent(response.snapshot)
        this.state = this.dirty ? 'dirty' : 'saved'
        if (!this.persist()) throw new Error(this.error)
        this.saved(response.snapshot)
        this.changed()
      } catch (error) {
        this.error = error instanceof Error ? error.message : '保存失败，草稿已保留'
        this.state = /REVISION_CONFLICT|GENERATION|版本冲突/.test(this.error)
          ? 'conflicted'
          : 'failed'
        this.persist()
        this.changed()
        throw error
      }
    }
  }
  adopt(snapshot: DocumentSnapshot): void {
    if (snapshot.documentId !== this.baseline.documentId) return
    if (snapshot.revisionId === this.baseline.revisionId) return
    if (this.pending) {
      void this.flush().catch(() => {})
      return
    }
    if (this.hasChanges) {
      this.state = 'conflicted'
      this.error = '文稿出现新修订，当前草稿已保留，请核对后恢复或另存'
      this.changed()
      return
    }
    this.baseline = copy(snapshot)
    this.content = officeContent(snapshot)
    this.history.length = 0
    this.future.length = 0
    this.persist()
    this.changed()
  }
  discard(snapshot: DocumentSnapshot): void {
    if (this.running) throw new Error('提交仍在进行中，请等待回执后再处理草稿')
    this.baseline = copy(snapshot)
    this.content = officeContent(snapshot)
    this.pending = undefined
    this.dirty = false
    this.history.length = 0
    this.future.length = 0
    this.state = 'saved'
    this.error = ''
    this.persist()
    this.changed()
  }
  suspend(): void {
    this.detached = true
    clearTimeout(this.timer)
  }
  resume(): void {
    this.detached = false
    if (this.hasChanges && this.state !== 'conflicted')
      this.timer = setTimeout(() => void this.flush().catch(() => {}), 800)
  }
  detach(): void {
    const suspended = this.detached
    this.suspend()
    if (!suspended && this.hasChanges && this.state !== 'conflicted')
      void this.flush().catch(() => {})
  }
}
