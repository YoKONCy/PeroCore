import { createHash, randomUUID } from 'node:crypto'
import type { ToolApprovalRepository } from '../../repositories/toolApproval.repo'

export type ApprovalDecision =
  | 'allow_once'
  | 'allow_session'
  | 'allow_always'
  | 'deny_once'
  | 'deny_always'

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'

export interface ApprovalRequest {
  id: string
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  toolName: string
  argsSummary: Record<string, unknown>
  argsFingerprint: string
  reason: string
  status: ApprovalStatus
  decision?: ApprovalDecision
  /** 用户决策附言（同意/拒绝时写给 Agent 的理由，可选） */
  resolutionMessage?: string
  createdAt: string
  expiresAt: string
  resolvedAt?: string
}

export interface CreateApprovalInput {
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  toolName: string
  args: Record<string, unknown>
  reason: string
  ttlMs?: number
}

export type ApprovalEventListener = (request: ApprovalRequest) => void | Promise<void>

/** SQLite 持久化的工具审批状态机与审计服务。 */
export class ApprovalService {
  private readonly requests = new Map<string, ApprovalRequest>()
  private readonly sessionGrants = new Set<string>()
  private readonly permanentGrants = new Set<string>()
  private readonly permanentDenials = new Set<string>()
  private readonly listeners = new Set<ApprovalEventListener>()
  private readonly resolvedListeners = new Set<ApprovalEventListener>()
  private readonly resolutionWaiters = new Map<string, Set<(request: ApprovalRequest) => void>>()

  constructor(private readonly repository?: ToolApprovalRepository) {
    for (const request of repository?.list() ?? []) this.requests.set(request.id, request)
    for (const request of repository?.listEffectiveDecisions() ?? []) {
      const key = this.grantKey(request.agentId, request.toolName)
      if (request.decision === 'allow_always') {
        this.permanentGrants.add(key)
        this.permanentDenials.delete(key)
      }
      if (request.decision === 'deny_always') {
        this.permanentDenials.add(key)
        this.permanentGrants.delete(key)
      }
    }
    this.expirePending()
  }

  onRequested(listener: ApprovalEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 订阅审批完成事件，供 Gateway 立即同步所有前端。 */
  onResolved(listener: ApprovalEventListener): () => void {
    this.resolvedListeners.add(listener)
    return () => this.resolvedListeners.delete(listener)
  }

  create(input: CreateApprovalInput): ApprovalRequest {
    this.expirePending()
    const fingerprint = this.fingerprint(input.args)
    const existing =
      this.repository?.findPending({
        agentId: input.agentId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        argsFingerprint: fingerprint,
      }) ??
      [...this.requests.values()].find(
        (request) =>
          request.status === 'pending' &&
          request.agentId === input.agentId &&
          request.sessionId === input.sessionId &&
          request.toolName === input.toolName &&
          request.argsFingerprint === fingerprint,
      )
    if (existing) {
      this.requests.set(existing.id, existing)
      return existing
    }

    const now = Date.now()
    const request: ApprovalRequest = {
      id: randomUUID(),
      agentId: input.agentId,
      channel: input.channel,
      sessionId: input.sessionId,
      threadId: input.threadId,
      taskId: input.taskId,
      toolName: input.toolName,
      argsSummary: this.sanitizeArgs(input.args),
      argsFingerprint: fingerprint,
      reason: input.reason,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(10_000, input.ttlMs ?? 5 * 60_000)).toISOString(),
    }
    this.requests.set(request.id, request)
    this.repository?.create(request)
    this.audit(request, 'requested', { reason: request.reason, argsSummary: request.argsSummary })
    for (const listener of this.listeners) void listener(request)
    return request
  }

  resolve(id: string, decision: ApprovalDecision, message?: string): ApprovalRequest {
    this.expirePending()
    const request = this.get(id)
    if (!request) throw new Error(`审批请求不存在: ${id}`)
    if (request.status !== 'pending') throw new Error(`审批请求当前不可决策: ${request.status}`)
    request.decision = decision
    request.resolutionMessage = message?.trim() ? message.trim().slice(0, 2_000) : undefined
    request.resolvedAt = new Date().toISOString()
    request.status = decision.startsWith('allow_') ? 'approved' : 'denied'

    const key = this.grantKey(request.agentId, request.toolName)
    if (decision === 'allow_session')
      this.sessionGrants.add(this.sessionKey(request.sessionId, request.toolName))
    if (decision === 'allow_always') {
      this.permanentGrants.add(key)
      this.permanentDenials.delete(key)
    }
    if (decision === 'deny_always') {
      this.permanentDenials.add(key)
      this.permanentGrants.delete(key)
    }
    this.persist(request)
    this.audit(request, 'resolved', { decision, message: request.resolutionMessage })
    for (const listener of this.resolvedListeners) void listener(request)
    for (const waiter of this.resolutionWaiters.get(request.id) ?? []) waiter(request)
    this.resolutionWaiters.delete(request.id)
    return request
  }

  /** 等待审批决策；用于保持原工具调用并在用户决策后原地续行。 */
  waitForResolution(id: string, signal?: AbortSignal): Promise<ApprovalRequest> {
    const current = this.get(id)
    if (!current) return Promise.reject(new Error(`审批请求不存在: ${id}`))
    if (current.status !== 'pending') return Promise.resolve(current)
    return new Promise<ApprovalRequest>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.resolutionWaiters.get(id)?.delete(done)
      }
      const done = (request: ApprovalRequest) => {
        cleanup()
        resolve(request)
      }
      const abort = () => {
        cleanup()
        reject(new Error('审批等待已取消'))
      }
      const waiters = this.resolutionWaiters.get(id) ?? new Set()
      waiters.add(done)
      this.resolutionWaiters.set(id, waiters)
      const timer = setTimeout(
        () => {
          cleanup()
          const latest = this.get(id)
          if (latest) resolve(latest)
          else reject(new Error(`审批请求不存在: ${id}`))
        },
        Math.max(1, Date.parse(current.expiresAt) - Date.now() + 50),
      )
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }

  get(id: string): ApprovalRequest | undefined {
    this.expirePending()
    const request = this.requests.get(id) ?? this.repository?.get(id)
    if (request) this.requests.set(id, request)
    return request
  }

  list(
    filter: { status?: ApprovalStatus; agentId?: string; sessionId?: string } = {},
  ): ApprovalRequest[] {
    this.expirePending()
    if (this.repository) return this.repository.list(filter)
    return [...this.requests.values()].filter(
      (request) =>
        (!filter.status || request.status === filter.status) &&
        (!filter.agentId || request.agentId === filter.agentId) &&
        (!filter.sessionId || request.sessionId === filter.sessionId),
    )
  }

  listAudit(filter: { approvalId?: string; sessionId?: string } = {}) {
    return this.repository?.listAudit(filter) ?? []
  }

  /** 查找同工具同参数最近一次带附言的拒绝决策（用于把用户理由回传给 Agent）。 */
  findDeniedMessage(input: {
    agentId: string
    sessionId: string
    toolName: string
    args: Record<string, unknown>
  }): string | undefined {
    const fingerprint = this.fingerprint(input.args)
    return this.list({ status: 'denied', agentId: input.agentId })
      .filter(
        (request) =>
          request.toolName === input.toolName &&
          (request.decision === 'deny_always' ||
            (request.sessionId === input.sessionId && request.argsFingerprint === fingerprint)),
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
      ?.resolutionMessage
  }

  /** 消费一次性拒绝，把用户附言作为下一次同参数调用的工具观察回传给 Agent。 */
  consumeDeniedOnce(input: {
    agentId: string
    sessionId: string
    toolName: string
    args: Record<string, unknown>
  }): string | undefined {
    const fingerprint = this.fingerprint(input.args)
    const request = this.list({
      status: 'denied',
      agentId: input.agentId,
      sessionId: input.sessionId,
    })
      .filter(
        (candidate) =>
          candidate.decision === 'deny_once' &&
          candidate.toolName === input.toolName &&
          candidate.argsFingerprint === fingerprint,
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
    if (!request) return undefined
    request.status = 'consumed'
    this.persist(request)
    this.audit(request, 'consumed', {
      decision: request.decision,
      message: request.resolutionMessage,
    })
    return request.resolutionMessage ?? '用户拒绝了本次工具调用。'
  }

  authorize(input: {
    approvalId?: string
    agentId: string
    sessionId: string
    toolName: string
    args: Record<string, unknown>
  }): 'allow' | 'deny' | 'none' {
    this.expirePending()
    const permanentKey = this.grantKey(input.agentId, input.toolName)
    if (this.permanentDenials.has(permanentKey)) return 'deny'
    if (this.permanentGrants.has(permanentKey)) return 'allow'
    if (this.sessionGrants.has(this.sessionKey(input.sessionId, input.toolName))) return 'allow'
    const fingerprint = this.fingerprint(input.args)
    let request = input.approvalId ? this.get(input.approvalId) : undefined
    if (!request) {
      request =
        this.repository?.findApprovedOnce({
          agentId: input.agentId,
          sessionId: input.sessionId,
          toolName: input.toolName,
          argsFingerprint: fingerprint,
        }) ??
        [...this.requests.values()].find(
          (candidate) =>
            candidate.status === 'approved' &&
            candidate.decision === 'allow_once' &&
            candidate.agentId === input.agentId &&
            candidate.sessionId === input.sessionId &&
            candidate.toolName === input.toolName &&
            candidate.argsFingerprint === fingerprint,
        )
    }
    if (!request || request.status !== 'approved') return 'none'
    if (
      request.agentId !== input.agentId ||
      request.sessionId !== input.sessionId ||
      request.toolName !== input.toolName ||
      request.argsFingerprint !== fingerprint
    )
      return 'deny'
    if (request.decision === 'allow_once') {
      request.status = 'consumed'
      this.persist(request)
      this.audit(request, 'consumed', { argsFingerprint: fingerprint })
    }
    return 'allow'
  }

  clearSession(sessionId: string): void {
    for (const key of this.sessionGrants)
      if (key.startsWith(`${sessionId}:`)) this.sessionGrants.delete(key)
    for (const request of this.requests.values()) {
      if (request.sessionId === sessionId && request.status === 'pending') {
        request.status = 'expired'
        this.persist(request)
        this.audit(request, 'session_cleared', {})
        for (const waiter of this.resolutionWaiters.get(request.id) ?? []) waiter(request)
        this.resolutionWaiters.delete(request.id)
      }
    }
  }

  private expirePending(): void {
    if (this.repository) {
      for (const request of this.repository.expirePending(new Date().toISOString())) {
        this.requests.set(request.id, request)
        this.audit(request, 'expired', {})
        for (const waiter of this.resolutionWaiters.get(request.id) ?? []) waiter(request)
        this.resolutionWaiters.delete(request.id)
      }
      return
    }
    const now = Date.now()
    for (const request of this.requests.values()) {
      if (request.status === 'pending' && Date.parse(request.expiresAt) <= now)
        request.status = 'expired'
    }
  }

  private persist(request: ApprovalRequest): void {
    this.requests.set(request.id, request)
    this.repository?.update(request)
  }

  private audit(
    request: ApprovalRequest,
    event: 'requested' | 'resolved' | 'consumed' | 'expired' | 'session_cleared',
    detail: Record<string, unknown>,
  ): void {
    this.repository?.appendAudit({
      approvalId: request.id,
      event,
      agentId: request.agentId,
      sessionId: request.sessionId,
      toolName: request.toolName,
      detail,
    })
  }

  private fingerprint(args: Record<string, unknown>): string {
    return createHash('sha256').update(this.stableStringify(args)).digest('hex')
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableStringify(object[key])}`)
        .join(',')}}`
    }
    return JSON.stringify(value)
  }

  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sensitive = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential/i
    const seen = new WeakSet<object>()
    const sanitize = (value: unknown, key = '', depth = 0): unknown => {
      if (sensitive.test(key)) return '[已隐藏]'
      if (depth > 12) return '[嵌套过深]'
      if (typeof value === 'string') {
        const redacted = value
          .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
          .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏]')
        return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted
      }
      if (!value || typeof value !== 'object') return value
      if (seen.has(value)) return '[循环引用]'
      seen.add(value)
      if (Array.isArray(value)) return value.map((item) => sanitize(item, '', depth + 1))
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
          childKey,
          sanitize(childValue, childKey, depth + 1),
        ]),
      )
    }
    return sanitize(args) as Record<string, unknown>
  }

  private sessionKey(sessionId: string, toolName: string): string {
    return `${sessionId}:${toolName}`
  }
  private grantKey(agentId: string, toolName: string): string {
    return `${agentId}:${toolName}`
  }
}
