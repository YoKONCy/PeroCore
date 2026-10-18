/**
 * attachmentService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AttachmentRepository, AttachmentRow } from '../../repositories/attachment.repo'
import type { ThreadRepository } from '../../repositories/thread.repo'
import { AppError } from '../../lib/appError'
import {
  imagePreviewsFromToolResult,
  resourceFromToolResult,
  type ResourceOrigin,
} from '@infos/shared'
import type { AttachmentKind } from '../../repositories/attachment.repo'
import { tokenCounter } from '../tokenizer/tokenCounter'
import type { PdfParserService } from '../integrations/pdfParserService'
import type { IntegrationSource } from '../integrations/integrationService'

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/xml',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'text/yaml',
  'text/x-python',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'text/css',
  'text/x-c',
  'text/x-c++',
  'text/x-java-source',
  'application/sql',
])
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_ATTACHMENT_TEXT_CHARS = 120_000
export const MAX_ATTACHMENT_TEXT_TOKENS = 30_000

export interface AttachmentDto {
  id: string
  threadId: string
  messageId: number | null
  kind: string
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  contextPolicy: string
  status: string
  tokenEstimate: number | null
  createdAt: string | null
  boundAt: string | null
  error?: string
  caption?: string
  origin?: ResourceOrigin
}

export class AttachmentService {
  private pdfJobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private disposed = false
  constructor(
    private readonly repo: AttachmentRepository,
    private readonly threadRepo: ThreadRepository,
    private readonly rootDir: string,
    private readonly pdfParser?: PdfParserService,
  ) {}

  async initialize(): Promise<void> {
    await this.repo.failInterruptedPdf()
  }
  async dispose(): Promise<void> {
    this.disposed = true
    for (const job of this.pdfJobs.values()) job.controller.abort()
    await Promise.allSettled([...this.pdfJobs.values()].map((job) => job.promise))
  }
  capabilities() {
    return this.pdfParser?.capabilities() ?? { pdf: false, maxPdfBytes: 0, sourceName: null }
  }

  async saveOutgoing(input: {
    threadId: string
    agentId: string
    pairId?: string
    callId: string
    bytes: Buffer
    name: string
    mimeType: string
    kind: AttachmentKind
    toolPreview?: boolean
    origin?: ResourceOrigin
    caption?: string
  }): Promise<AttachmentRow> {
    const existing = await this.repo.findOutgoingCall(input.threadId, input.callId)
    if (existing) return this.getActive(existing.id)
    const id = randomUUID()
    const storageKey = `${id.slice(0, 2)}/${id}`
    const target = this.resolveStoragePath(storageKey)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, input.bytes, { flag: 'wx' })
    try {
      return await this.repo.create({
        id,
        threadId: input.threadId,
        kind: input.kind,
        originalName: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
        storageKey,
        metadataJson: JSON.stringify({
          resource: {
            agentId: input.agentId,
            pairId: input.pairId,
            callId: input.callId,
            toolPreview: input.toolPreview,
            origin: input.origin,
            caption: input.caption,
          },
        }),
      })
    } catch (error) {
      await unlink(target).catch(() => undefined)
      throw error
    }
  }

  async outgoingCall(threadId: string, callId: string): Promise<AttachmentRow | undefined> {
    return this.repo.findOutgoingCall(threadId, callId)
  }

  async markResourceDelivered(id: string, agentId: string): Promise<void> {
    const row = await this.getActive(id)
    if (
      (JSON.parse(row.metadataJson) as { resource?: { agentId?: string } }).resource?.agentId !==
      agentId
    )
      throw new AppError('FORBIDDEN', { message: '资源与角色不匹配' })
    await this.repo.setResourceDelivered(id)
  }

  async bindOutgoing(
    threadId: string,
    agentId: string,
    pairId: string,
    messageId: number,
    calls: Array<{ name: string; result?: string; isError?: boolean }>,
  ): Promise<void> {
    const ids: string[] = []
    for (const call of calls) {
      const previews = imagePreviewsFromToolResult(call.name, call.result)
      const resource = call.isError ? null : resourceFromToolResult(call.name, call.result)
      for (const item of resource ? [...previews, resource] : previews) {
        if (!item?.id || ids.includes(item.id)) continue
        const row = await this.getActive(item.id)
        const metadata = JSON.parse(row.metadataJson) as {
          resource?: { agentId?: string; pairId?: string }
        }
        if (
          row.threadId === threadId &&
          row.messageId === null &&
          row.status === 'uploaded' &&
          metadata.resource?.agentId === agentId &&
          metadata.resource?.pairId === pairId
        )
          ids.push(row.id)
      }
    }
    if (ids.length) await this.repo.bind(ids, threadId, messageId)
  }

  async contentFile(id: string) {
    const row = await this.getActive(id)
    return { row, filePath: this.resolveStoragePath(row.storageKey) }
  }

  async upload(file: File, threadId: string): Promise<AttachmentDto> {
    if (!(await this.threadRepo.getThread(threadId)))
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const mimeType = file.type.toLowerCase().split(';')[0]!
    const kind =
      mimeType === 'application/pdf' || /\.pdf$/i.test(file.name)
        ? 'pdf'
        : IMAGE_MIMES.has(mimeType)
          ? 'image'
          : TEXT_MIMES.has(mimeType)
            ? 'text'
            : null
    if (!kind)
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        message: `不支持的附件类型 ${mimeType || '未知二进制'}；请选择图片、UTF-8 文本或已配置解析来源的 PDF`,
      })
    const pdfSource = kind === 'pdf' ? this.pdfParser?.capture() : undefined
    if (pdfSource && this.pdfJobs.size >= 8)
      throw new AppError('SERVICE_UNAVAILABLE', { message: '正在解析的 PDF 较多，请稍后上传' })
    if (kind === 'pdf' && !pdfSource)
      throw new AppError('NOT_CONFIGURED', { message: 'PDF 解析尚未启用' })
    const max =
      kind === 'pdf'
        ? this.capabilities().maxPdfBytes
        : kind === 'image'
          ? MAX_IMAGE_BYTES
          : MAX_TEXT_BYTES
    if (file.size > max)
      throw new AppError('BAD_REQUEST', {
        message: `${kind === 'image' ? '图片' : kind === 'pdf' ? 'PDF' : '文本'}附件超过 ${max / 1024 / 1024}MB 限制`,
      })

    const bytes = Buffer.from(await file.arrayBuffer())
    if (kind === 'pdf' && bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) < 0)
      throw new AppError('INVALID_FORMAT', { message: '文件不是有效的 PDF' })
    let extractedText: string | undefined
    let tokenEstimate: number | undefined
    if (kind === 'text') {
      try {
        extractedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
          message: '文本附件必须是有效 UTF-8，未知二进制内容不受支持',
        })
      }
      tokenEstimate = tokenCounter.countTokens(extractedText)
      if (
        extractedText.length > MAX_ATTACHMENT_TEXT_CHARS ||
        tokenEstimate > MAX_ATTACHMENT_TEXT_TOKENS
      ) {
        throw new AppError('BAD_REQUEST', {
          message: '文档内容超过首版上下文限制，首版暂不支持大文档，请缩小文件后重试',
        })
      }
    }

    const id = randomUUID()
    const storageKey = `${id.slice(0, 2)}/${id}`
    const target = this.resolveStoragePath(storageKey)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx' })
    try {
      const row = await this.repo.create({
        id,
        threadId,
        kind,
        originalName: file.name || '未命名文件',
        mimeType: kind === 'pdf' ? 'application/pdf' : mimeType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey,
        extractedText,
        tokenEstimate,
        status: kind === 'pdf' ? 'processing' : 'uploaded',
        metadataJson: pdfSource ? this.pdfMetadata(pdfSource) : '{}',
      })
      if (pdfSource) this.startPdf(row, bytes, pdfSource)
      return this.toDto(row)
    } catch (error) {
      await unlink(target).catch(() => undefined)
      throw error
    }
  }

  async getActive(id: string): Promise<AttachmentRow> {
    const row = await this.repo.findById(id)
    if (!row || row.status === 'deleted')
      throw new AppError('NOT_FOUND', { message: `附件不存在: ${id}` })
    return row
  }

  async readContent(id: string): Promise<{ row: AttachmentRow; bytes: Buffer }> {
    const row = await this.getActive(id)
    return { row, bytes: await readFile(this.resolveStoragePath(row.storageKey)) }
  }

  async validateForBinding(ids: string[], threadId: string): Promise<AttachmentRow[]> {
    if (ids.length > 5 || new Set(ids).size !== ids.length)
      throw new AppError('BAD_REQUEST', { message: '每轮最多绑定 5 个且不能重复的附件' })
    const rows = await this.repo.findByIds(ids)
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) => row.threadId !== threadId || row.status !== 'uploaded' || row.messageId !== null,
      )
    ) {
      throw new AppError('BAD_REQUEST', { message: '附件必须属于当前 Thread 且尚未绑定' })
    }
    return ids.map((id) => rows.find((row) => row.id === id)!)
  }

  async bind(ids: string[], threadId: string, messageId: number): Promise<AttachmentRow[]> {
    const rows = await this.validateForBinding(ids, threadId)
    if ((await this.repo.bind(ids, threadId, messageId)) !== ids.length)
      throw new AppError('BAD_REQUEST', { message: '附件绑定状态已变化，请重新上传后重试' })
    return rows
  }

  async deleteUnbound(id: string): Promise<void> {
    // 取消附件允许重复提交；已删除或不存在的附件无需再次清理。
    const row = await this.repo.findById(id)
    if (!row || row.status === 'deleted') return
    if (row.messageId !== null || !['uploaded', 'processing', 'failed'].includes(row.status))
      throw new AppError('BAD_REQUEST', { message: '仅允许删除未绑定附件' })
    if (!(await this.repo.markDeletedUnbound(id))) {
      const current = await this.repo.findById(id)
      if (!current || current.status === 'deleted') return
      throw new AppError('BAD_REQUEST', { message: '附件状态已变化，无法删除' })
    }
    this.pdfJobs.get(id)?.controller.abort()
    await unlink(this.resolveStoragePath(row.storageKey)).catch(() => undefined)
  }

  async listForMessages(messageIds: number[]): Promise<Map<number, AttachmentDto[]>> {
    const map = new Map<number, AttachmentDto[]>()
    for (const row of await this.repo.listByMessageIds(messageIds)) {
      if (row.messageId === null) continue
      // 读图快照只在工具卡片中呈现，避免恢复历史时再多出一张附件卡片。
      try {
        const metadata = JSON.parse(row.metadataJson) as { resource?: { toolPreview?: boolean } }
        if (metadata.resource?.toolPreview === true) continue
      } catch {
        /* 普通附件继续沿用原有展示。 */
      }
      const values = map.get(row.messageId) ?? []
      values.push(this.toDto(row))
      map.set(row.messageId, values)
    }
    return map
  }

  async purgeDeleted(id: string, storageKey: string): Promise<void> {
    const row = await this.repo.findById(id)
    if (row && (row.status !== 'deleted' || row.storageKey !== storageKey))
      throw new AppError('BAD_REQUEST', { message: '附件尚未进入永久清理范围' })
    this.pdfJobs.get(id)?.controller.abort()
    try {
      await unlink(this.resolveStoragePath(storageKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  resolveStoragePath(storageKey: string): string {
    if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}$/i.test(storageKey))
      throw new AppError('BAD_REQUEST', { message: '附件存储键非法' })
    const root = path.resolve(this.rootDir)
    const target = path.resolve(root, storageKey)
    if (!target.startsWith(`${root}${path.sep}`))
      throw new AppError('BAD_REQUEST', { message: '附件路径越界' })
    return target
  }

  toDto(row: AttachmentRow): AttachmentDto {
    let error: string | undefined
    let resource: { caption?: string; origin?: ResourceOrigin } | undefined
    try {
      const metadata = JSON.parse(row.metadataJson) as {
        pdf?: { error?: string }
        resource?: typeof resource
      }
      error = metadata.pdf?.error
      resource = metadata.resource
    } catch {
      /* 旧附件没有解析元数据。 */
    }
    return {
      id: row.id,
      threadId: row.threadId,
      messageId: row.messageId,
      kind: row.kind,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      contextPolicy: row.contextPolicy,
      status: row.status,
      tokenEstimate: row.tokenEstimate,
      createdAt: row.createdAt,
      boundAt: row.boundAt,
      error,
      caption: resource?.caption,
      origin: resource?.origin,
    }
  }

  async retryPdf(id: string): Promise<AttachmentDto> {
    if (this.pdfJobs.size >= 8)
      throw new AppError('SERVICE_UNAVAILABLE', { message: '正在解析的 PDF 较多，请稍后重试' })
    const row = await this.getActive(id)
    if (row.kind !== 'pdf' || row.status !== 'failed' || row.messageId !== null)
      throw new AppError('BAD_REQUEST', { message: '仅能重试尚未发送且解析失败的 PDF' })
    const source = this.pdfParser?.capture()
    if (!source) throw new AppError('NOT_CONFIGURED', { message: 'PDF 解析尚未启用' })
    const bytes = await readFile(this.resolveStoragePath(row.storageKey))
    if (!(await this.repo.setPdfProcessing(id, this.pdfMetadata(source))))
      throw new AppError('CONFLICT', { message: '附件状态已变化' })
    this.startPdf(row, bytes, source)
    return this.toDto(await this.getActive(id))
  }

  private pdfMetadata(source: IntegrationSource, error?: string): string {
    return JSON.stringify({
      pdf: { sourceId: source.id, provider: source.provider, sourceName: source.name, error },
    })
  }

  private startPdf(row: AttachmentRow, bytes: Buffer, source: IntegrationSource): void {
    const controller = new AbortController()
    if (this.disposed) controller.abort()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)])
    const promise = (async () => {
      try {
        signal.throwIfAborted()
        const result = await this.pdfParser!.parse(bytes, row.originalName, source, signal)
        signal.throwIfAborted()
        const tokenEstimate = tokenCounter.countTokens(result.text)
        if (
          result.text.length > MAX_ATTACHMENT_TEXT_CHARS ||
          tokenEstimate > MAX_ATTACHMENT_TEXT_TOKENS
        )
          throw new AppError('OUT_OF_RANGE', {
            message: 'PDF 文字超过 30K Token 附件预算，请拆分文件后上传',
          })
        await this.repo.finishPdf(row.id, {
          status: 'uploaded',
          extractedText: result.text,
          tokenEstimate,
          metadataJson: this.pdfMetadata(source),
        })
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : signal.aborted
              ? '解析已中断或超时，请重试'
              : 'PDF 解析失败，请检查来源配置或重试'
        await this.repo.finishPdf(row.id, {
          status: 'failed',
          metadataJson: this.pdfMetadata(source, message),
        })
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (this.pdfJobs.get(row.id)?.controller === controller) this.pdfJobs.delete(row.id)
      })
    this.pdfJobs.set(row.id, { controller, promise })
  }
}
