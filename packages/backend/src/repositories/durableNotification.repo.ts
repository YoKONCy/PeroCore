import { eq, and, desc } from 'drizzle-orm'
import type { DeliveryAudience } from '@infos/shared'
import type { DrizzleDb } from '../database/connection'
import { durableNotifications } from '../database/schema'

export interface DurableNotificationRecord {
  notificationId: string
  principalId: string
  audience: DeliveryAudience
  title: string
  body?: string
  level: 'info' | 'success' | 'warning' | 'error'
  status: 'unread' | 'read'
  revision: number
  createdAt: string
  readAt?: string
}

export class DurableNotificationRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(record: DurableNotificationRecord): void {
    this.db
      .insert(durableNotifications)
      .values({
        notificationId: record.notificationId,
        principalId: record.principalId,
        audienceJson: JSON.stringify(record.audience),
        title: record.title,
        body: record.body,
        level: record.level,
        status: record.status,
        revision: record.revision,
        createdAt: record.createdAt,
        readAt: record.readAt,
      })
      .onConflictDoNothing()
      .run()
  }

  list(principalId: string, status?: 'unread' | 'read'): DurableNotificationRecord[] {
    const rows = this.db
      .select()
      .from(durableNotifications)
      .where(
        status
          ? and(
              eq(durableNotifications.principalId, principalId),
              eq(durableNotifications.status, status),
            )
          : eq(durableNotifications.principalId, principalId),
      )
      .orderBy(desc(durableNotifications.createdAt))
      .all()
    return rows.map((row) => ({
      notificationId: row.notificationId,
      principalId: row.principalId,
      audience: JSON.parse(row.audienceJson) as DeliveryAudience,
      title: row.title,
      body: row.body ?? undefined,
      level: row.level as DurableNotificationRecord['level'],
      status: row.status as DurableNotificationRecord['status'],
      revision: row.revision,
      createdAt: row.createdAt,
      readAt: row.readAt ?? undefined,
    }))
  }

  markRead(notificationId: string, expectedRevision: number): DurableNotificationRecord | null {
    const readAt = new Date().toISOString()
    const result = this.db
      .update(durableNotifications)
      .set({ status: 'read', readAt, revision: expectedRevision + 1 })
      .where(
        and(
          eq(durableNotifications.notificationId, notificationId),
          eq(durableNotifications.revision, expectedRevision),
        ),
      )
      .run()
    if (result.changes !== 1) return null
    return this.db
      .select()
      .from(durableNotifications)
      .where(eq(durableNotifications.notificationId, notificationId))
      .get() as unknown as DurableNotificationRecord
  }
}
