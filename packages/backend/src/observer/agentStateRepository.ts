import { randomUUID } from 'node:crypto'
import { desc, eq, inArray } from 'drizzle-orm'
import type { KernelEventEnvelope } from '@infos/shared'
import type { DrizzleDb } from '../database'
import {
  agentStateMeasurements,
  observerPolicies,
  observerProcessedEvents,
} from '../database/schema'

export interface AgentStateMeasurement {
  id: string
  agentId: string
  metric: string
  value: number
  confidence: number
  sourceEventId: string
  sourceEventType: string
  explanation: string
  observedAt: string
}

export interface ObserverPolicy {
  agentId: string
  enabled: boolean
  injectContext: boolean
  updatedAt: string
}

/** Observer派生测量与隐私策略的SQLite权威仓库。 */
export class AgentStateRepository {
  constructor(private readonly db: DrizzleDb) {}

  async commitEvent(
    event: KernelEventEnvelope<string, unknown>,
    measurements: Omit<
      AgentStateMeasurement,
      'id' | 'sourceEventId' | 'sourceEventType' | 'observedAt'
    >[],
  ): Promise<boolean> {
    return this.db.transaction((tx) => {
      const inserted = tx
        .insert(observerProcessedEvents)
        .values({ eventId: event.eventId, processedAt: new Date().toISOString() })
        .onConflictDoNothing()
        .returning({ eventId: observerProcessedEvents.eventId })
        .all()
      if (!inserted.length) return false
      if (measurements.length) {
        tx.insert(agentStateMeasurements)
          .values(
            measurements.map((measurement) => ({
              id: randomUUID(),
              ...measurement,
              sourceEventId: event.eventId,
              sourceEventType: event.type,
              observedAt: event.occurredAt,
            })),
          )
          .run()
      }
      return true
    })
  }

  async latest(agentId: string, limit = 100): Promise<AgentStateMeasurement[]> {
    return this.db
      .select()
      .from(agentStateMeasurements)
      .where(eq(agentStateMeasurements.agentId, agentId))
      .orderBy(desc(agentStateMeasurements.observedAt))
      .limit(Math.max(1, Math.min(1000, limit)))
  }

  async getPolicy(agentId: string): Promise<ObserverPolicy> {
    const row = await this.db
      .select()
      .from(observerPolicies)
      .where(eq(observerPolicies.agentId, agentId))
      .limit(1)
    return (
      row[0] ?? {
        agentId,
        enabled: true,
        injectContext: false,
        updatedAt: new Date(0).toISOString(),
      }
    )
  }

  async setPolicy(
    agentId: string,
    input: { enabled: boolean; injectContext: boolean },
  ): Promise<void> {
    await this.db
      .insert(observerPolicies)
      .values({ agentId, ...input, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: observerPolicies.agentId,
        set: { ...input, updatedAt: new Date().toISOString() },
      })
  }

  async deleteAgent(agentId: string): Promise<number> {
    return this.db.transaction((tx) => {
      const rows = tx
        .select({ sourceEventId: agentStateMeasurements.sourceEventId })
        .from(agentStateMeasurements)
        .where(eq(agentStateMeasurements.agentId, agentId))
        .all()
      const deleted = tx
        .delete(agentStateMeasurements)
        .where(eq(agentStateMeasurements.agentId, agentId))
        .returning({ id: agentStateMeasurements.id })
        .all()
      const eventIds = [...new Set(rows.map((row) => row.sourceEventId))]
      if (eventIds.length) {
        tx.delete(observerProcessedEvents)
          .where(inArray(observerProcessedEvents.eventId, eventIds))
          .run()
      }
      tx.delete(observerPolicies).where(eq(observerPolicies.agentId, agentId)).run()
      return deleted.length
    })
  }

  async exportAgent(
    agentId: string,
  ): Promise<{ policy: ObserverPolicy; measurements: AgentStateMeasurement[] }> {
    const [policy, measurements] = await Promise.all([
      this.getPolicy(agentId),
      this.latest(agentId, 1000),
    ])
    return { policy, measurements }
  }

  async aggregate(
    agentId: string,
  ): Promise<Record<string, { value: number; confidence: number; samples: number }>> {
    const measurements = await this.latest(agentId, 500)
    const grouped = new Map<string, AgentStateMeasurement[]>()
    for (const item of measurements)
      grouped.set(item.metric, [...(grouped.get(item.metric) ?? []), item])
    return Object.fromEntries(
      [...grouped].map(([metric, values]) => {
        const weight = values.reduce((sum, item) => sum + item.confidence, 0) || 1
        return [
          metric,
          {
            value: values.reduce((sum, item) => sum + item.value * item.confidence, 0) / weight,
            confidence: Math.min(1, weight / Math.max(1, values.length)),
            samples: values.length,
          },
        ]
      }),
    )
  }
}
