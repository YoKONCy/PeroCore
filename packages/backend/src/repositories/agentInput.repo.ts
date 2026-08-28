import { and, asc, eq } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { agentInputRequests } from '../database/schema'
import type { AgentInputRequest, AgentInputStatus } from '../services/execution/agentInputService'

/** Agent求助请求持久化仓储。 */
export class AgentInputRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(request: AgentInputRequest): void {
    this.db.insert(agentInputRequests).values(this.toRow(request)).run()
  }

  update(request: AgentInputRequest): void {
    this.db
      .update(agentInputRequests)
      .set({
        status: request.status,
        selectedOptionIdsJson: JSON.stringify(request.selectedOptionIds),
        responseMessage: request.responseMessage ?? null,
        resolvedAt: request.resolvedAt ?? null,
      })
      .where(eq(agentInputRequests.id, request.id))
      .run()
  }

  get(id: string): AgentInputRequest | undefined {
    const row = this.db.select().from(agentInputRequests).where(eq(agentInputRequests.id, id)).get()
    return row ? this.fromRow(row) : undefined
  }

  list(
    filter: {
      status?: AgentInputStatus
      agentId?: string
      sessionId?: string
      threadId?: string
    } = {},
  ): AgentInputRequest[] {
    const conditions = []
    if (filter.status) conditions.push(eq(agentInputRequests.status, filter.status))
    if (filter.agentId) conditions.push(eq(agentInputRequests.agentId, filter.agentId))
    if (filter.sessionId) conditions.push(eq(agentInputRequests.sessionId, filter.sessionId))
    if (filter.threadId) conditions.push(eq(agentInputRequests.threadId, filter.threadId))
    const rows = conditions.length
      ? this.db
          .select()
          .from(agentInputRequests)
          .where(and(...conditions))
          .orderBy(asc(agentInputRequests.createdAt))
          .all()
      : this.db.select().from(agentInputRequests).orderBy(asc(agentInputRequests.createdAt)).all()
    return rows.map((row) => this.fromRow(row))
  }

  private toRow(request: AgentInputRequest) {
    return {
      id: request.id,
      agentId: request.agentId,
      channel: request.channel,
      sessionId: request.sessionId,
      threadId: request.threadId,
      taskId: request.taskId ?? null,
      question: request.question,
      context: request.context ?? null,
      optionsJson: JSON.stringify(request.options),
      allowFreeText: request.allowFreeText,
      required: request.required,
      status: request.status,
      selectedOptionIdsJson: JSON.stringify(request.selectedOptionIds),
      responseMessage: request.responseMessage ?? null,
      createdAt: request.createdAt,
      resolvedAt: request.resolvedAt ?? null,
    }
  }

  private fromRow(row: typeof agentInputRequests.$inferSelect): AgentInputRequest {
    return {
      id: row.id,
      agentId: row.agentId,
      channel: row.channel,
      sessionId: row.sessionId,
      threadId: row.threadId,
      taskId: row.taskId ?? undefined,
      question: row.question,
      context: row.context ?? undefined,
      options: JSON.parse(row.optionsJson) as AgentInputRequest['options'],
      allowFreeText: row.allowFreeText,
      required: row.required,
      status: row.status as AgentInputStatus,
      selectedOptionIds: JSON.parse(row.selectedOptionIdsJson) as string[],
      responseMessage: row.responseMessage ?? undefined,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? undefined,
    }
  }
}
