import { eq, and, desc, inArray } from 'drizzle-orm'
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

  create(record: DurableNotificationRecord): boolean {
    const result = this.db
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
    return result.changes === 1
  }

  /** 通知展示回执只影响通知自身，不替用户修改任务状态或任务中心的未读标记。 */
  acknowledge(
    principalId: string,
    receipts: Array<{ notificationId: string; revision: number }>,
  ): number {
    return this.db.transaction((tx) => {
      let changed = 0
      for (const receipt of receipts) {
        changed += tx
          .update(durableNotifications)
          .set({ status: 'read', readAt: new Date().toISOString(), revision: receipt.revision + 1 })
          .where(
            and(
              eq(durableNotifications.principalId, principalId),
              eq(durableNotifications.notificationId, receipt.notificationId),
              eq(durableNotifications.revision, receipt.revision),
              eq(durableNotifications.status, 'unread'),
            ),
          )
          .run().changes
      }
      return changed
    })
  }

  unreadIds(principalId: string, notificationIds: string[]): Set<string> {
    if (!notificationIds.length) return new Set()
    const rows = this.db
      .select({ id: durableNotifications.notificationId })
      .from(durableNotifications)
      .where(
        and(
          eq(durableNotifications.principalId, principalId),
          eq(durableNotifications.status, 'unread'),
          inArray(durableNotifications.notificationId, notificationIds),
        ),
      )
      .all()
    return new Set(rows.map((row) => row.id))
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
