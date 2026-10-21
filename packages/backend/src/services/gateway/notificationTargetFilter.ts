import { and, eq, inArray } from 'drizzle-orm'
import type { NotificationMetadata } from '@infos/shared'
import type { DrizzleDb } from '../../database/connection'
import {
  durableNotifications,
  threads,
  threadMessages,
  backgroundTasks,
  applicationCalls,
} from '../../database/schema'
import type { NotificationIdentity } from './gatewayHub'

/** 撤回、删除后的结果不再补收；分页游标仍按原扫描位置前进。 */
export function createNotificationTargetFilter(db: DrizzleDb) {
  return async (principalId: string, items: NotificationIdentity[]): Promise<string[]> => {
    const hidden: string[] = []
    for (let offset = 0; offset < items.length; offset += 100) {
      const batch = items.slice(offset, offset + 100)
      const records = db
        .select({
          id: durableNotifications.notificationId,
          metadata: durableNotifications.metadataJson,
        })
        .from(durableNotifications)
        .where(
          and(
            eq(durableNotifications.principalId, principalId),
            inArray(
              durableNotifications.notificationId,
              batch.map((item) => item.notificationId),
            ),
          ),
        )
        .all()
        .map((record) => ({
          id: record.id,
          target: (JSON.parse(record.metadata) as NotificationMetadata).target,
        }))
      const conversationTargets = records.filter((record) => record.target?.kind === 'conversation')
      const threadIds = conversationTargets.flatMap((record) =>
        record.target?.threadId ? [record.target.threadId] : [],
      )
      const messageIds = conversationTargets.flatMap((record) => {
        const id = Number(record.target?.messageId)
        return Number.isSafeInteger(id) && id > 0 ? [id] : []
      })
      const activeThreads = new Set<string>(
        threadIds.length
          ? db
              .select({ id: threads.id })
              .from(threads)
              .where(
                and(
                  eq(threads.agentId, principalId),
                  eq(threads.status, 'active'),
                  inArray(threads.id, threadIds),
                ),
              )
              .all()
              .map((row) => row.id)
          : [],
      )
      const activeMessages = new Map<string, string>(
        messageIds.length
          ? db
              .select({ id: threadMessages.id, threadId: threadMessages.threadId })
              .from(threadMessages)
              .where(
                and(eq(threadMessages.status, 'active'), inArray(threadMessages.id, messageIds)),
              )
              .all()
              .map((row): [string, string] => [String(row.id), row.threadId])
          : [],
      )
      const taskIds = records.flatMap((record) =>
        record.target?.kind === 'task' && record.target.taskId ? [record.target.taskId] : [],
      )
      const tasks = new Set(
        taskIds.length
          ? db
              .select({ id: backgroundTasks.id })
              .from(backgroundTasks)
              .where(
                and(eq(backgroundTasks.agentId, principalId), inArray(backgroundTasks.id, taskIds)),
              )
              .all()
              .map((row) => row.id)
          : [],
      )
      const callIds = records.flatMap((record) =>
        record.target?.applicationCallId ? [record.target.applicationCallId] : [],
      )
      const calls = new Set(
        callIds.length
          ? db
              .select({ id: applicationCalls.id })
              .from(applicationCalls)
              .where(
                and(
                  eq(applicationCalls.agentId, principalId),
                  inArray(applicationCalls.id, callIds),
                ),
              )
              .all()
              .map((row) => row.id)
          : [],
      )
      for (const { id, target } of records) {
        if (!target) continue
        if (
          target.agentId !== principalId ||
          (target.kind === 'conversation' &&
            (!target.threadId ||
              !activeThreads.has(target.threadId) ||
              (target.messageId !== undefined &&
                activeMessages.get(target.messageId) !== target.threadId))) ||
          (target.kind === 'task' && target.taskId && !tasks.has(target.taskId)) ||
          (target.applicationCallId && !calls.has(target.applicationCallId))
        )
          hidden.push(id)
      }
    }
    return hidden
  }
}
