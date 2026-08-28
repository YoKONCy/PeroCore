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
import { tokenCounter } from '../tokenizer/tokenCounter'

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
}

export class AttachmentService {
  constructor(
    private readonly repo: AttachmentRepository,
    private readonly threadRepo: ThreadRepository,
    private readonly rootDir: string,
  ) {}

  async upload(file: File, threadId: string): Promise<AttachmentDto> {
    if (!(await this.threadRepo.getThread(threadId)))
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const mimeType = file.type.toLowerCase().split(';')[0]!
    const kind = IMAGE_MIMES.has(mimeType) ? 'image' : TEXT_MIMES.has(mimeType) ? 'text' : null
    if (!kind)
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        message: `不支持的附件类型 ${mimeType || '未知二进制'}；首版不支持 PDF、HTML、SVG、压缩包和可执行文件`,
      })
    const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    if (file.size > max)
      throw new AppError('BAD_REQUEST', {
        message: `${kind === 'image' ? '图片' : '文本'}附件超过 ${max / 1024 / 1024}MB 限制`,
      })

    const bytes = Buffer.from(await file.arrayBuffer())
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
        mimeType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey,
        extractedText,
        tokenEstimate,
      })
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
    const row = await this.getActive(id)
    if (row.messageId !== null || row.status !== 'uploaded')
      throw new AppError('BAD_REQUEST', { message: '仅允许删除未绑定附件' })
    if (!(await this.repo.markDeletedUnbound(id)))
      throw new AppError('BAD_REQUEST', { message: '附件状态已变化，无法删除' })
    await unlink(this.resolveStoragePath(row.storageKey)).catch(() => undefined)
  }

  async listForMessages(messageIds: number[]): Promise<Map<number, AttachmentDto[]>> {
    const map = new Map<number, AttachmentDto[]>()
    for (const row of await this.repo.listByMessageIds(messageIds)) {
      if (row.messageId === null) continue
      const values = map.get(row.messageId) ?? []
      values.push(this.toDto(row))
      map.set(row.messageId, values)
    }
    return map
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
    }
  }
}
