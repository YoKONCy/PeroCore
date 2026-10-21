import { eq, and, desc, asc, gt, inArray, sql } from 'drizzle-orm'
import type {
  DeliveryAudience,
  NotificationMetadata,
  NotificationReceipt,
  DeviceNotificationPage,
} from '@infos/shared'
import type { DrizzleDb } from '../database/connection'
import {
  durableNotifications,
  notificationFeed,
  notificationDeviceReceipts,
} from '../database/schema'

/** 系统通知只携带预览，完整结果通过目标页面读取。 */
function notificationPreview(value: string, limit: number): string {
  if (value.length <= limit) return value
  let end = limit - 1
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${value.slice(0, end)}…`
}

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
  metadata?: NotificationMetadata
  expiresAt?: string
}

export class DurableNotificationRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(record: DurableNotificationRecord): boolean {
    return this.db.transaction((tx) => {
      const result = tx
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
          metadataJson: JSON.stringify(record.metadata ?? {}),
          expiresAt:
            record.expiresAt ??
            new Date(Date.parse(record.createdAt) + 7 * 86_400_000).toISOString(),
        })
        .onConflictDoNothing()
        .run()
      if (result.changes === 1) {
        tx.insert(notificationFeed).values({ notificationId: record.notificationId }).run()
      }
      return result.changes === 1
    })
  }

  /** 业务侧撤销或实际已读；设备收到、展示时改用 acknowledgeDevice。 */
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

  /** 回执使用传输层认证得到的设备身份，不能由客户端声明其他设备。 */
  acknowledgeDevice(
    deviceId: string,
    receipts: NotificationReceipt[],
    principalId?: string,
  ): number {
    return this.db.transaction((tx) => {
      let accepted = 0
      const now = new Date().toISOString()
      for (const receipt of receipts) {
        const notification = tx
          .select()
          .from(durableNotifications)
          .where(
            and(
              eq(durableNotifications.notificationId, receipt.notificationId),
              eq(durableNotifications.revision, receipt.revision),
              ...(principalId ? [eq(durableNotifications.principalId, principalId)] : []),
            ),
          )
          .get()
        if (!notification) continue
        tx.insert(notificationDeviceReceipts)
          .values({
            deviceId,
            notificationId: receipt.notificationId,
            revision: receipt.revision,
            receivedAt: now,
            presentedAt: receipt.state === 'presented' ? now : null,
            readAt: receipt.state === 'read' ? now : null,
          })
          .onConflictDoUpdate({
            target: [
              notificationDeviceReceipts.deviceId,
              notificationDeviceReceipts.notificationId,
            ],
            set: {
              revision: receipt.revision,
              receivedAt: sql`CASE WHEN ${notificationDeviceReceipts.revision} = ${receipt.revision} THEN ${notificationDeviceReceipts.receivedAt} ELSE ${now} END`,
              presentedAt:
                receipt.state === 'presented'
                  ? now
                  : sql`CASE WHEN ${notificationDeviceReceipts.revision} = ${receipt.revision} THEN ${notificationDeviceReceipts.presentedAt} ELSE NULL END`,
              readAt:
                receipt.state === 'read'
                  ? now
                  : sql`CASE WHEN ${notificationDeviceReceipts.revision} = ${receipt.revision} THEN ${notificationDeviceReceipts.readAt} ELSE NULL END`,
            },
          })
          .run()
        if (receipt.state === 'read' && notification.status === 'unread') {
          tx.update(durableNotifications)
            .set({ status: 'read', readAt: now, revision: receipt.revision + 1 })
            .where(
              and(
                eq(durableNotifications.notificationId, receipt.notificationId),
                eq(durableNotifications.revision, receipt.revision),
              ),
            )
            .run()
        }
        accepted += 1
      }
      return accepted
    })
  }

  latestSequence(): number {
    return (
      this.db
        .select({ value: sql<number>`coalesce(max(${notificationFeed.sequence}), 0)` })
        .from(notificationFeed)
        .get()?.value ?? 0
    )
  }

  /** 从 SQL 层排除后台专用、过期及本机已收到的通知，避免界面重连扫描全部回复历史。 */
  pendingDesktop(deviceId: string, principalId: string): DurableNotificationRecord[] {
    const rows = this.db
      .select({ notification: durableNotifications })
      .from(durableNotifications)
      .leftJoin(
        notificationDeviceReceipts,
        and(
          eq(notificationDeviceReceipts.notificationId, durableNotifications.notificationId),
          eq(notificationDeviceReceipts.deviceId, deviceId),
        ),
      )
      .where(
        and(
          eq(durableNotifications.principalId, principalId),
          eq(durableNotifications.status, 'unread'),
          sql`coalesce(json_extract(${durableNotifications.metadataJson}, '$.delivery'), 'all') <> 'background'`,
          sql`coalesce(julianday(${durableNotifications.expiresAt}), julianday(${durableNotifications.createdAt}) + 7) > julianday('now')`,
          sql`(${notificationDeviceReceipts.revision} IS NULL OR ${notificationDeviceReceipts.revision} <> ${durableNotifications.revision})`,
        ),
      )
      .orderBy(desc(durableNotifications.createdAt))
      .all()
    return rows.map(({ notification }) => this.fromRow(notification))
  }

  /** 页游标按扫描位置前进，过期、已读和本设备已收到的项目不会阻塞补收。 */
  page(deviceId: string, afterSequence: number, limit: number): DeviceNotificationPage {
    const latestSequence = this.latestSequence()
    if (afterSequence > latestSequence)
      return {
        notifications: [],
        nextSequence: 0,
        latestSequence,
        hasMore: false,
        resetRequired: true,
      }
    const rows = this.db
      .select({
        sequence: notificationFeed.sequence,
        notification: durableNotifications,
        receivedRevision: notificationDeviceReceipts.revision,
      })
      .from(notificationFeed)
      .innerJoin(
        durableNotifications,
        eq(durableNotifications.notificationId, notificationFeed.notificationId),
      )
      .leftJoin(
        notificationDeviceReceipts,
        and(
          eq(notificationDeviceReceipts.notificationId, notificationFeed.notificationId),
          eq(notificationDeviceReceipts.deviceId, deviceId),
        ),
      )
      .where(
        and(
          gt(notificationFeed.sequence, afterSequence),
          sql`${notificationFeed.sequence} <= ${latestSequence}`,
        ),
      )
      .orderBy(asc(notificationFeed.sequence))
      .limit(limit + 1)
      .all()
    const scanned = rows.slice(0, limit)
    const now = Date.now()
    return {
      notifications: scanned.flatMap(({ sequence, notification: row, receivedRevision }) => {
        const expiresAt =
          row.expiresAt ?? new Date(Date.parse(row.createdAt) + 7 * 86_400_000).toISOString()
        if (
          row.status !== 'unread' ||
          receivedRevision === row.revision ||
          Date.parse(expiresAt) <= now
        )
          return []
        const metadata = JSON.parse(row.metadataJson) as NotificationMetadata
        return [
          {
            sequence,
            notificationId: row.notificationId,
            principalId: row.principalId,
            revision: row.revision,
            title: notificationPreview(row.title, 200),
            body: row.body ? notificationPreview(row.body, 1000) : undefined,
            level: row.level as DurableNotificationRecord['level'],
            createdAt: row.createdAt,
            expiresAt,
            source: metadata.source,
            target: metadata.target,
            presentation: 'notify' as const,
          },
        ]
      }),
      nextSequence: scanned.at(-1)?.sequence ?? afterSequence,
      latestSequence,
      hasMore: rows.length > limit,
      resetRequired: false,
    }
  }

  /** 旧界面仍显示普通重要通知，但不同设备之间不共享展示回执。 */
  pendingForDevice<T extends Pick<DurableNotificationRecord, 'notificationId' | 'revision'>>(
    deviceId: string,
    records: T[],
  ): T[] {
    if (!records.length) return []
    const receipts = this.db
      .select()
      .from(notificationDeviceReceipts)
      .where(
        and(
          eq(notificationDeviceReceipts.deviceId, deviceId),
          inArray(
            notificationDeviceReceipts.notificationId,
            records.map((record) => record.notificationId),
          ),
        ),
      )
      .all()
    const received = new Map(receipts.map((receipt) => [receipt.notificationId, receipt.revision]))
    return records.filter((record) => received.get(record.notificationId) !== record.revision)
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
          sql`coalesce(julianday(${durableNotifications.expiresAt}), julianday(${durableNotifications.createdAt}) + 7) > julianday('now')`,
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
    return rows.map((row) => this.fromRow(row))
  }

  private fromRow(row: typeof durableNotifications.$inferSelect): DurableNotificationRecord {
    return {
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
      metadata: JSON.parse(row.metadataJson) as NotificationMetadata,
      expiresAt: row.expiresAt ?? undefined,
    }
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
    const row = this.db
      .select()
      .from(durableNotifications)
      .where(eq(durableNotifications.notificationId, notificationId))
      .get()
    return row ? this.fromRow(row) : null
  }
}
