import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/appError'
import type { AgentInputRepository } from '../../repositories/agentInput.repo'

export type AgentInputStatus = 'pending' | 'answered' | 'skipped' | 'cancelled' | 'interrupted'

export interface AgentInputOption {
  id: string
  label: string
  description?: string
}

export interface AgentInputRequest {
  id: string
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  question: string
  context?: string
  options: AgentInputOption[]
  allowFreeText: boolean
  required: boolean
  status: AgentInputStatus
  selectedOptionIds: string[]
  responseMessage?: string
  createdAt: string
  resolvedAt?: string
}

export interface CreateAgentInput {
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  question: string
  context?: string
  options?: AgentInputOption[]
  allowFreeText?: boolean
  required?: boolean
}

export type AgentInputEventListener = (request: AgentInputRequest) => void | Promise<void>

/** Agent主动向用户求助时使用的持久化等待状态机。 */
export class AgentInputService {
  private readonly requests = new Map<string, AgentInputRequest>()
  private readonly requestedListeners = new Set<AgentInputEventListener>()
  private readonly resolvedListeners = new Set<AgentInputEventListener>()
  private readonly waiters = new Map<string, Set<(request: AgentInputRequest) => void>>()

  constructor(private readonly repository?: AgentInputRepository) {
    for (const request of repository?.list() ?? []) this.requests.set(request.id, request)
    if (repository) this.interruptPendingAfterRestart()
  }

  onRequested(listener: AgentInputEventListener): () => void {
    this.requestedListeners.add(listener)
    return () => this.requestedListeners.delete(listener)
  }

  onResolved(listener: AgentInputEventListener): () => void {
    this.resolvedListeners.add(listener)
    return () => this.resolvedListeners.delete(listener)
  }

  create(input: CreateAgentInput): AgentInputRequest {
    if (this.list({ status: 'pending', sessionId: input.sessionId }).length > 0) {
      throw new AppError('CONFLICT', {
        message: '当前对话已有一个等待用户回答的问题',
      })
    }
    const question = input.question.trim()
    if (!question) throw new AppError('VALIDATION_ERROR', { message: '问题不能为空' })
    const options = this.normalizeOptions(input.options ?? [])
    const allowFreeText = input.allowFreeText !== false
    if (!allowFreeText && options.length === 0) {
      throw new AppError('VALIDATION_ERROR', { message: '禁用自由回答时必须提供选项' })
    }
    const request: AgentInputRequest = {
      id: randomUUID(),
      agentId: input.agentId,
      channel: input.channel,
      sessionId: input.sessionId,
      threadId: input.threadId,
      taskId: input.taskId,
      question: question.slice(0, 2_000),
      context: input.context?.trim().slice(0, 2_000) || undefined,
      options,
      allowFreeText,
      required: input.required === true,
      status: 'pending',
      selectedOptionIds: [],
      createdAt: new Date().toISOString(),
    }
    this.requests.set(request.id, request)
    this.repository?.create(request)
    for (const listener of this.requestedListeners) void listener(request)
    return request
  }

  resolve(
    id: string,
    input: { selectedOptionIds?: string[]; message?: string; skipped?: boolean },
  ): AgentInputRequest {
    const request = this.get(id)
    if (!request) throw new AppError('NOT_FOUND', { message: '求助请求不存在' })
    if (request.status !== 'pending') {
      throw new AppError('CONFLICT', { message: `求助请求当前不可回答: ${request.status}` })
    }
    if (input.skipped) {
      if (request.required) throw new AppError('VALIDATION_ERROR', { message: '这个问题需要回答' })
      request.status = 'skipped'
    } else {
      const selected = [...new Set(input.selectedOptionIds ?? [])]
      const available = new Set(request.options.map((option) => option.id))
      if (selected.some((id) => !available.has(id))) {
        throw new AppError('VALIDATION_ERROR', { message: '回答包含无效选项' })
      }
      const message = input.message?.trim().slice(0, 4_000) || undefined
      if (message && !request.allowFreeText) {
        throw new AppError('VALIDATION_ERROR', { message: '这个问题不接受自由回答' })
      }
      if (selected.length === 0 && !message) {
        throw new AppError('VALIDATION_ERROR', { message: '请选择选项或填写回答' })
      }
      request.status = 'answered'
      request.selectedOptionIds = selected
      request.responseMessage = message
    }
    request.resolvedAt = new Date().toISOString()
    this.persist(request)
    this.finish(request)
    return request
  }

  waitForResolution(id: string, signal?: AbortSignal): Promise<AgentInputRequest> {
    const current = this.get(id)
    if (!current) return Promise.reject(new Error(`求助请求不存在: ${id}`))
    if (current.status !== 'pending') return Promise.resolve(current)
    return new Promise<AgentInputRequest>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        this.waiters.get(id)?.delete(done)
      }
      const done = (request: AgentInputRequest) => {
        cleanup()
        resolve(request)
      }
      const abort = () => {
        cleanup()
        this.cancel(id, '当前ReAct已停止，求助请求已取消。')
        reject(new Error('用户回答等待已取消'))
      }
      const waiters = this.waiters.get(id) ?? new Set()
      waiters.add(done)
      this.waiters.set(id, waiters)
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }

  get(id: string): AgentInputRequest | undefined {
    const request = this.requests.get(id) ?? this.repository?.get(id)
    if (request) this.requests.set(id, request)
    return request
  }

  list(
    filter: {
      status?: AgentInputStatus
      agentId?: string
      sessionId?: string
      threadId?: string
    } = {},
  ): AgentInputRequest[] {
    if (this.repository) return this.repository.list(filter)
    return [...this.requests.values()].filter(
      (request) =>
        (!filter.status || request.status === filter.status) &&
        (!filter.agentId || request.agentId === filter.agentId) &&
        (!filter.sessionId || request.sessionId === filter.sessionId) &&
        (!filter.threadId || request.threadId === filter.threadId),
    )
  }

  cancelAllPending(message = '服务正在关闭，待回答问题已自动取消。'): void {
    for (const request of this.list({ status: 'pending' })) this.cancel(request.id, message)
  }

  private cancel(id: string, message: string): void {
    const request = this.get(id)
    if (!request || request.status !== 'pending') return
    request.status = 'cancelled'
    request.responseMessage = message
    request.resolvedAt = new Date().toISOString()
    this.persist(request)
    this.finish(request)
  }

  private interruptPendingAfterRestart(): void {
    for (const request of this.repository?.list({ status: 'pending' }) ?? []) {
      request.status = 'interrupted'
      request.responseMessage = '服务已重启，旧问题已中断。'
      request.resolvedAt = new Date().toISOString()
      this.persist(request)
    }
  }

  private finish(request: AgentInputRequest): void {
    for (const listener of this.resolvedListeners) void listener(request)
    for (const waiter of this.waiters.get(request.id) ?? []) waiter(request)
    this.waiters.delete(request.id)
  }

  private persist(request: AgentInputRequest): void {
    this.requests.set(request.id, request)
    this.repository?.update(request)
  }

  private normalizeOptions(options: AgentInputOption[]): AgentInputOption[] {
    if (options.length > 4) throw new AppError('VALIDATION_ERROR', { message: '最多提供四个选项' })
    const ids = new Set<string>()
    return options.map((option) => {
      const id = option.id.trim().slice(0, 80)
      const label = option.label.trim().slice(0, 80)
      if (!id || !label || ids.has(id)) {
        throw new AppError('VALIDATION_ERROR', { message: '选项ID和标题必须非空且ID不可重复' })
      }
      ids.add(id)
      return {
        id,
        label,
        description: option.description?.trim().slice(0, 240) || undefined,
      }
    })
  }
}
