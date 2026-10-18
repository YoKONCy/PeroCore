import { and, eq, inArray, desc } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { applicationCalls } from '../database/schema'

export type ApplicationCall = typeof applicationCalls.$inferSelect
export class ApplicationCallRepository {
  constructor(private readonly db: DrizzleDb) {}
  get(id: string): ApplicationCall | undefined {
    return this.db.select().from(applicationCalls).where(eq(applicationCalls.id, id)).get()
  }
  byRun(appId: string, runId: string): ApplicationCall | undefined {
    return this.db
      .select()
      .from(applicationCalls)
      .where(and(eq(applicationCalls.appId, appId), eq(applicationCalls.runId, runId)))
      .get()
  }
  create(value: typeof applicationCalls.$inferInsert): ApplicationCall {
    this.db.insert(applicationCalls).values(value).onConflictDoNothing().run()
    return this.get(value.id)!
  }
  patch(id: string, patch: Partial<typeof applicationCalls.$inferInsert>): void {
    this.db
      .update(applicationCalls)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(applicationCalls.id, id))
      .run()
  }
  pending(appId: string): ApplicationCall[] {
    return this.db
      .select()
      .from(applicationCalls)
      .where(
        and(
          eq(applicationCalls.appId, appId),
          inArray(applicationCalls.deliveryStatus, ['pending', 'sending']),
        ),
      )
      .limit(100)
      .all()
  }
  list(appId: string, owner: string): ApplicationCall[] {
    return this.db
      .select()
      .from(applicationCalls)
      .where(and(eq(applicationCalls.appId, appId), eq(applicationCalls.agentId, owner)))
      .orderBy(desc(applicationCalls.createdAt))
      .limit(100)
      .all()
  }
}
