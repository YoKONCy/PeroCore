import { randomBytes } from 'node:crypto'
import type { ResourceContext, ResourceService } from './resourceService'
import type { AttachmentService } from './attachmentService'
import type { ThreadService } from '../thread/threadService'
import { AppError } from '../../lib/appError'

type Ticket = {
  context: ResourceContext
  entry: string
  attachmentId?: string
  workspace: boolean
  expiresAt: number
}

/** 随机短期票据只开放工作区预览资源，页面始终处于不具备同源身份的 sandbox。 */
export class HtmlPreviewService {
  private readonly tickets = new Map<string, Ticket>()
  constructor(
    private readonly resources: ResourceService,
    private readonly attachments: AttachmentService,
    private readonly threads: ThreadService,
  ) {}

  /** 工具与前端共用票据表；资源解析负责核对当前角色、会话和工作区边界。 */
  async issueForTool(context: ResourceContext, source: string) {
    context.signal?.throwIfAborted()
    const value = source.replace(/^resource:/i, '')
    const suffixAt = value.search(/[?#]/)
    const file = suffixAt < 0 ? value : value.slice(0, suffixAt)
    const suffix = suffixAt < 0 ? '' : value.slice(suffixAt)
    const resource = await this.resources.resolveReference(context, file)
    const result = resource.id
      ? await this.issue({ id: resource.id })
      : await this.issue({ ...context, source: file })
    context.signal?.throwIfAborted()
    return { path: result.path + suffix }
  }

  async issue(input: {
    id?: string
    agentId?: string
    threadId?: string
    source?: string
    taskId?: string
  }) {
    let ticket: Ticket
    let mimeType: string
    let sizeBytes: number
    if (input.id) {
      const { row } = await this.attachments.contentFile(input.id)
      const thread = await this.threads.getThread(row.threadId)
      if (!thread) throw new AppError('NOT_FOUND', { message: '原会话已不存在' })
      const origin = this.attachments.toDto(row).origin
      ticket = {
        context: { agentId: thread.agentId, threadId: row.threadId, taskId: origin?.taskId },
        entry:
          origin?.type === 'workspace'
            ? origin.value
            : row.originalName.replaceAll('\\', '/').split('/').pop()!,
        attachmentId: row.id,
        workspace: origin?.type === 'workspace',
        expiresAt: Date.now() + 30 * 60_000,
      }
      mimeType = row.mimeType
      sizeBytes = row.sizeBytes
    } else {
      if (!input.agentId || !input.threadId || !input.source)
        throw new AppError('BAD_REQUEST', { message: 'HTML 文件缺少所属会话' })
      const context = { agentId: input.agentId, threadId: input.threadId, taskId: input.taskId }
      const { resource } = await this.resources.referenceFile(context, input.source)
      ticket = {
        context,
        entry: resource.origin!.value,
        workspace: true,
        expiresAt: Date.now() + 30 * 60_000,
      }
      mimeType = resource.mimeType
      sizeBytes = resource.sizeBytes
    }
    if (
      !['text/html', 'application/xhtml+xml'].includes(mimeType) &&
      !/\.html?$/i.test(ticket.entry)
    )
      throw new AppError('BAD_REQUEST', { message: '此文件不是 HTML 页面' })
    if (sizeBytes > 10 * 1024 * 1024)
      throw new AppError('BAD_REQUEST', { message: 'HTML 页面超过 10 MB 限制' })
    for (const [key, value] of this.tickets)
      if (value.expiresAt <= Date.now()) this.tickets.delete(key)
    if (this.tickets.size >= 64) this.tickets.delete(this.tickets.keys().next().value!)
    const token = randomBytes(32).toString('hex')
    this.tickets.set(token, ticket)
    return {
      path: `/html-previews/${token}/${ticket.entry.split('/').map(encodeURIComponent).join('/')}`,
    }
  }

  async resolve(token: string, rawPath: string) {
    const ticket = this.tickets.get(token)
    if (!ticket || ticket.expiresAt <= Date.now()) {
      this.tickets.delete(token)
      throw new AppError('NOT_FOUND', { message: '预览已过期，请从聊天重新打开' })
    }
    if (!(await this.threads.getThread(ticket.context.threadId)))
      throw new AppError('NOT_FOUND', { message: '原会话已不存在' })
    const entry = decodeURIComponent(rawPath)
    if (
      !entry ||
      entry.includes('\\') ||
      entry.split('/').some((part) => part === '..' || part === '.' || !part)
    )
      throw new AppError('BAD_REQUEST', { message: '预览资源路径无效' })
    if (ticket.attachmentId) {
      const { row, filePath } = await this.attachments.contentFile(ticket.attachmentId)
      if (entry === ticket.entry) return { filePath, mimeType: 'text/html', name: row.originalName }
    }
    if (!ticket.workspace)
      throw new AppError('NOT_FOUND', { message: '此附件没有关联的工作区资源' })
    const { resource, filePath } = await this.resources.referenceFile(
      ticket.context,
      `workspace:${encodeURIComponent(entry)}`,
    )
    return { filePath, mimeType: resource.mimeType, name: resource.name }
  }
}
