import { and, eq, isNull, lte, or, sql, inArray } from 'drizzle-orm'
import type { KernelEventEnvelope, TaskDeliveryPort, TaskOrigin } from '@infos/shared'
import type { DrizzleDb } from '../../database'
import {
  backgroundTasks,
  taskDeliveries,
  threads,
  threadMessages,
  durableNotifications,
  kernelOutboxEvents,
} from '../../database/schema'
import type { BackgroundTaskRow } from '../../repositories/backgroundTask.repo'
import type { GatewayHub } from '../gateway/gatewayHub'
import { readTaskLifecycle } from './taskLifecycle'
import { createLogger } from '../../lib/logger'
import { AppError } from '../../lib/appError'
import { KernelOutboxRepository } from '../../kernel/kernelOutboxRepository'

const logger = createLogger('TaskDelivery')

/** 领域 Outbox 只落投递记录；外部离线不会阻塞内核事件发布。 */
export class TaskDeliveryService {
  private port?: TaskDeliveryPort
  private running = false
  constructor(
    private readonly db: DrizzleDb,
    private readonly gateway: GatewayHub,
    private readonly authorize: (origin: TaskOrigin) => Promise<string | undefined>,
  ) {}

  register(port: TaskDeliveryPort): () => void {
    this.port = port
    return () => {
      if (this.port === port) this.port = undefined
    }
  }

  async applicationReady(origin: TaskOrigin, agentId: string): Promise<boolean> {
    return (
      (await this.authorize(origin)) === agentId &&
      Boolean(this.port?.sendResources) &&
      (await this.port!.ready(origin).catch(() => false))
    )
  }

  async sendApplicationResources(
    origin: TaskOrigin,
    agentId: string,
    content: string,
    resources: Parameters<NonNullable<TaskDeliveryPort['sendResources']>>[2],
  ): Promise<void> {
    if (!(await this.applicationReady(origin, agentId))) throw new Error('原社交绑定或连接已不可用')
    await this.port!.sendResources!(origin, content, resources)
  }

  enqueue(event: KernelEventEnvelope<string, unknown>): void {
    if (event.type !== 'task.notification') return
    const task = event.payload as BackgroundTaskRow
    const state = readTaskLifecycle(task.lifecycleJson, task.instruction)
    const channels = [
      'app',
      ...(state.origin ? ['social'] : []),
      ...(task.status === 'completed' &&
      task.completionAction === 'send_to_chat' &&
      task.targetThreadId
        ? ['chat']
        : []),
    ]
    const now = new Date().toISOString()
    this.db.transaction((tx) => {
      for (const channel of channels)
        tx.insert(taskDeliveries)
          .values({
            id: `${event.eventId}:${channel}`,
            taskId: task.id,
            channel,
            payloadJson: JSON.stringify(task),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run()
    })
  }

  recover(): void {
    const now = new Date().toISOString()
    this.db
      .update(taskDeliveries)
      .set({ status: 'uncertain', lastError: '发送过程中服务中断，请核验是否送达', updatedAt: now })
      .where(and(eq(taskDeliveries.channel, 'social'), eq(taskDeliveries.status, 'sending')))
      .run()
    this.db
      .update(taskDeliveries)
      .set({ status: 'pending', updatedAt: now })
      .where(
        and(
          or(eq(taskDeliveries.channel, 'app'), eq(taskDeliveries.channel, 'chat')),
          eq(taskDeliveries.status, 'sending'),
        ),
      )
      .run()
  }

  list(taskId: string) {
    return this.db
      .select({
        id: taskDeliveries.id,
        channel: taskDeliveries.channel,
        status: taskDeliveries.status,
        attempts: taskDeliveries.attempts,
        lastError: taskDeliveries.lastError,
      })
      .from(taskDeliveries)
      .where(eq(taskDeliveries.taskId, taskId))
      .all()
  }

  resolve(taskId: string, id: string, decision: 'sent' | 'retry'): void {
    const result = this.db
      .update(taskDeliveries)
      .set({
        status: decision === 'sent' ? 'sent' : 'pending',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(taskDeliveries.id, id),
          eq(taskDeliveries.taskId, taskId),
          or(eq(taskDeliveries.status, 'uncertain'), eq(taskDeliveries.status, 'failed')),
        ),
      )
      .returning()
      .get()
    if (!result) throw new AppError('CONFLICT', { message: '投递状态已变化，请刷新后再处理' })
  }

  markRead(taskId: string): void {
    const ids = this.db
      .select({ id: taskDeliveries.id })
      .from(taskDeliveries)
      .where(eq(taskDeliveries.taskId, taskId))
      .all()
      .map((row) => row.id)
    if (ids.length)
      this.db
        .update(durableNotifications)
        .set({
          status: 'read',
          readAt: new Date().toISOString(),
          revision: sql`${durableNotifications.revision} + 1`,
        })
        .where(
          and(
            inArray(durableNotifications.notificationId, ids),
            eq(durableNotifications.status, 'unread'),
          ),
        )
        .run()
  }

  async flush(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const rows = this.db
        .select()
        .from(taskDeliveries)
        .where(
          and(
            eq(taskDeliveries.status, 'pending'),
            or(
              isNull(taskDeliveries.nextAttemptAt),
              lte(taskDeliveries.nextAttemptAt, new Date().toISOString()),
            ),
          ),
        )
        .limit(50)
        .all()
      for (const row of rows) {
        const task = JSON.parse(row.payloadJson) as BackgroundTaskRow
        const current = this.db
          .select()
          .from(backgroundTasks)
          .where(eq(backgroundTasks.id, task.id))
          .get()
        if (!current || current.revision !== task.revision || current.status !== task.status) {
          this.set(row.id, { status: 'superseded' })
          continue
        }
        const state = readTaskLifecycle(task.lifecycleJson, task.instruction)
        const title = `${task.status === 'completed' ? '任务完成' : task.status === 'waiting_input' ? '需要你的决定' : task.status === 'blocked' ? '任务需要处理' : '任务失败'} · ${task.title}`
        const body =
          task.status === 'waiting_input'
            ? (task.inputQuestion ?? state.continuation)
            : (task.result ?? task.errorMessage ?? state.continuation)
        const text = `${title}\n${body}\n任务：${task.id}\n修订：${task.revision}`
        const port = this.port
        if (row.channel === 'social') {
          // 在记录发送中之前检查离线与绑定；这些失败可以安全重试。
          if (!state.origin || (await this.authorize(state.origin)) !== task.agentId) {
            this.set(row.id, {
              status: 'failed',
              lastError: '来源账号绑定已改变，停止向旧会话投递',
            })
            continue
          }
          if (!port || !(await port.ready(state.origin).catch(() => false))) {
            this.set(row.id, {
              nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
              lastError: '社交通道离线，等待重连',
            })
            continue
          }
        }
        const claimed = this.db
          .update(taskDeliveries)
          .set({
            status: 'sending',
            attempts: row.attempts + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(taskDeliveries.id, row.id), eq(taskDeliveries.status, 'pending')))
          .returning()
          .get()
        if (!claimed) continue
        try {
          if (row.channel === 'social') await port!.send(state.origin!, text)
          else if (row.channel === 'chat') {
            // 回填消息与投递结算同事务，重启后不重复追加。
            this.db.transaction((tx) => {
              const target = tx
                .select()
                .from(threads)
                .where(
                  and(
                    eq(threads.id, task.targetThreadId!),
                    eq(threads.purpose, 'conversation'),
                    eq(threads.agentId, task.agentId),
                    eq(threads.status, 'active'),
                  ),
                )
                .get()
              if (!target) throw new Error('任务结果的目标会话不存在或归属已改变')
              const application = JSON.parse(task.metadataJson ?? '{}') as Record<string, unknown>
              const message = tx
                .insert(threadMessages)
                .values({
                  threadId: target.id,
                  role: application.kind === 'arca.collaboration' ? 'assistant' : 'system',
                  agentId: task.agentId,
                  content: application.kind === 'arca.collaboration' ? (task.result ?? text) : text,
                  metadataJson: JSON.stringify({
                    kind:
                      application.kind === 'arca.collaboration'
                        ? 'application_result'
                        : 'background_task_result',
                    taskId: task.id,
                    deliveryId: row.id,
                    ...(application.kind === 'arca.collaboration'
                      ? {
                          appId: 'infos.arca',
                          documentId: application.documentId,
                          changeSetId: application.changeSetId,
                        }
                      : {}),
                  }),
                  scorerStatus: application.kind === 'arca.collaboration' ? 'skipped' : 'pending',
                  status: 'active',
                })
                .returning({ id: threadMessages.id })
                .get()!
              tx.update(threads)
                .set({
                  messageCount: sql`${threads.messageCount} + 1`,
                  lastMessageAt: new Date().toISOString(),
                })
                .where(eq(threads.id, target.id))
                .run()
              tx.update(taskDeliveries)
                .set({ status: 'sent', updatedAt: new Date().toISOString() })
                .where(eq(taskDeliveries.id, row.id))
                .run()
              const outbox = new KernelOutboxRepository(this.db)
              const event = outbox.createEvent({
                protocolVersion: 1,
                type: 'conversation.message.committed',
                durability: 'durable',
                principalId: task.agentId,
                correlationId: task.id,
                payload: {
                  threadId: target.id,
                  messageId: message.id,
                  role: application.kind === 'arca.collaboration' ? 'assistant' : 'system',
                  status: 'active',
                },
              })
              tx.insert(kernelOutboxEvents).values(outbox.toRow(event)).run()
            })
          } else
            await this.gateway.pushNotification({
              title,
              body,
              source: 'task',
              principalId: task.agentId,
              important: true,
              notificationId: row.id,
              createdAt: task.completedAt ?? row.createdAt,
              level:
                task.status === 'completed'
                  ? 'success'
                  : task.status === 'failed'
                    ? 'error'
                    : 'warning',
            })
          this.set(row.id, { status: 'sent', lastError: null, nextAttemptAt: null })
        } catch (error) {
          // 外部发送超时不能证明未发送；保留不确定状态，不盲目重复发消息。
          this.set(row.id, {
            status:
              row.channel === 'social' ? 'uncertain' : row.attempts >= 7 ? 'failed' : 'pending',
            lastError: error instanceof Error ? error.message : String(error),
            nextAttemptAt: new Date(
              Date.now() + Math.min(60_000, 1000 * 2 ** row.attempts),
            ).toISOString(),
          })
          logger.warn(`任务结果投递失败: ${row.id}, ${error}`)
        }
      }
    } finally {
      this.running = false
    }
  }

  private set(id: string, patch: Partial<typeof taskDeliveries.$inferInsert>): void {
    this.db
      .update(taskDeliveries)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(taskDeliveries.id, id))
      .run()
  }
}
