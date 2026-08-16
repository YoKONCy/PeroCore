import { and, asc, eq, lte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DrizzleDb } from '../database'
import { toolApprovalAuditLogs, toolApprovalRequests } from '../database/schema'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
} from '../services/execution/approvalService'

export type ApprovalAuditEvent =
  | 'requested'
  | 'resolved'
  | 'consumed'
  | 'expired'
  | 'session_cleared'

export interface ApprovalAuditRecord {
  id: string
  approvalId: string | null
  event: ApprovalAuditEvent
  agentId: string
  sessionId: string
  toolName: string
  detail: Record<string, unknown>
  createdAt: string
}

/** SQLite 审批请求与 append-only 审计仓储。 */
export class ToolApprovalRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(request: ApprovalRequest): void {
    this.db.insert(toolApprovalRequests).values(this.toRow(request)).run()
  }

  update(request: ApprovalRequest): void {
    this.db
      .update(toolApprovalRequests)
      .set({
        status: request.status,
        decision: request.decision ?? null,
        resolutionMessage: request.resolutionMessage ?? null,
        resolvedAt: request.resolvedAt ?? null,
      })
      .where(eq(toolApprovalRequests.id, request.id))
      .run()
  }

  get(id: string): ApprovalRequest | undefined {
    const row = this.db
      .select()
      .from(toolApprovalRequests)
      .where(eq(toolApprovalRequests.id, id))
      .get()
    return row ? this.fromRow(row) : undefined
  }

  list(
    filter: { status?: ApprovalStatus; agentId?: string; sessionId?: string } = {},
  ): ApprovalRequest[] {
    const conditions = []
    if (filter.status) conditions.push(eq(toolApprovalRequests.status, filter.status))
    if (filter.agentId) conditions.push(eq(toolApprovalRequests.agentId, filter.agentId))
    if (filter.sessionId) conditions.push(eq(toolApprovalRequests.sessionId, filter.sessionId))
    const rows = conditions.length
      ? this.db
          .select()
          .from(toolApprovalRequests)
          .where(and(...conditions))
          .orderBy(asc(toolApprovalRequests.createdAt))
          .all()
      : this.db
          .select()
          .from(toolApprovalRequests)
          .orderBy(asc(toolApprovalRequests.createdAt))
          .all()
    return rows.map((row) => this.fromRow(row))
  }

  findPending(input: {
    agentId: string
    sessionId: string
    toolName: string
    argsFingerprint: string
  }): ApprovalRequest | undefined {
    const row = this.db
      .select()
      .from(toolApprovalRequests)
      .where(
        and(
          eq(toolApprovalRequests.status, 'pending'),
          eq(toolApprovalRequests.agentId, input.agentId),
          eq(toolApprovalRequests.sessionId, input.sessionId),
          eq(toolApprovalRequests.toolName, input.toolName),
          eq(toolApprovalRequests.argsFingerprint, input.argsFingerprint),
        ),
      )
      .get()
    return row ? this.fromRow(row) : undefined
  }

  findApprovedOnce(input: {
    agentId: string
    sessionId: string
    toolName: string
    argsFingerprint: string
  }): ApprovalRequest | undefined {
    const row = this.db
      .select()
      .from(toolApprovalRequests)
      .where(
        and(
          eq(toolApprovalRequests.status, 'approved'),
          eq(toolApprovalRequests.decision, 'allow_once'),
          eq(toolApprovalRequests.agentId, input.agentId),
          eq(toolApprovalRequests.sessionId, input.sessionId),
          eq(toolApprovalRequests.toolName, input.toolName),
          eq(toolApprovalRequests.argsFingerprint, input.argsFingerprint),
        ),
      )
      .get()
    return row ? this.fromRow(row) : undefined
  }

  expirePending(nowIso: string): ApprovalRequest[] {
    const expired = this.db
      .select()
      .from(toolApprovalRequests)
      .where(
        and(
          eq(toolApprovalRequests.status, 'pending'),
          lte(toolApprovalRequests.expiresAt, nowIso),
        ),
      )
      .all()
      .map((row) => this.fromRow(row))
    for (const request of expired) {
      request.status = 'expired'
      this.update(request)
    }
    return expired
  }

  appendAudit(input: Omit<ApprovalAuditRecord, 'id' | 'createdAt'>): ApprovalAuditRecord {
    const record: ApprovalAuditRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    this.db
      .insert(toolApprovalAuditLogs)
      .values({
        id: record.id,
        approvalId: record.approvalId,
        event: record.event,
        agentId: record.agentId,
        sessionId: record.sessionId,
        toolName: record.toolName,
        detailJson: JSON.stringify(record.detail),
        createdAt: record.createdAt,
      })
      .run()
    return record
  }

  listAudit(filter: { approvalId?: string; sessionId?: string } = {}): ApprovalAuditRecord[] {
    const conditions = []
    if (filter.approvalId) conditions.push(eq(toolApprovalAuditLogs.approvalId, filter.approvalId))
    if (filter.sessionId) conditions.push(eq(toolApprovalAuditLogs.sessionId, filter.sessionId))
    const rows = conditions.length
      ? this.db
          .select()
          .from(toolApprovalAuditLogs)
          .where(and(...conditions))
          .orderBy(asc(toolApprovalAuditLogs.createdAt))
          .all()
      : this.db
          .select()
          .from(toolApprovalAuditLogs)
          .orderBy(asc(toolApprovalAuditLogs.createdAt))
          .all()
    return rows.map((row) => ({
      id: row.id,
      approvalId: row.approvalId,
      event: row.event as ApprovalAuditEvent,
      agentId: row.agentId,
      sessionId: row.sessionId,
      toolName: row.toolName,
      detail: JSON.parse(row.detailJson) as Record<string, unknown>,
      createdAt: row.createdAt,
    }))
  }

  private toRow(request: ApprovalRequest) {
    return {
      id: request.id,
      agentId: request.agentId,
      channel: request.channel,
      sessionId: request.sessionId,
      threadId: request.threadId,
      taskId: request.taskId ?? null,
      toolName: request.toolName,
      argsSummaryJson: JSON.stringify(request.argsSummary),
      argsFingerprint: request.argsFingerprint,
      reason: request.reason,
      status: request.status,
      decision: request.decision ?? null,
      resolutionMessage: request.resolutionMessage ?? null,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      resolvedAt: request.resolvedAt ?? null,
    }
  }

  private fromRow(row: typeof toolApprovalRequests.$inferSelect): ApprovalRequest {
    return {
      id: row.id,
      agentId: row.agentId,
      channel: row.channel,
      sessionId: row.sessionId,
      threadId: row.threadId,
      taskId: row.taskId ?? undefined,
      toolName: row.toolName,
      argsSummary: JSON.parse(row.argsSummaryJson) as Record<string, unknown>,
      argsFingerprint: row.argsFingerprint,
      reason: row.reason,
      status: row.status as ApprovalStatus,
      decision: row.decision as ApprovalDecision | undefined,
      resolutionMessage: row.resolutionMessage ?? undefined,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt ?? undefined,
    }
  }
}
