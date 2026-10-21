import { t as __t } from '../lib/i18n'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { pictoriaManifest, type Asset, type Run } from '@infos/pictoria'
import type { MessageResource, TaskOrigin } from '@infos/shared'
import type { AppContext } from '../container'
import type { ApplicationCall } from '../repositories/applicationCall.repo'
import { ApplicationCallRepository } from '../repositories/applicationCall.repo'
import {
  applicationCalls,
  messageAttachments,
  threads,
  threadMessages,
  kernelOutboxEvents,
} from '../database/schema'
import { ConversationSurfaceSession } from '../projections/conversationSurfaceSession'
import type { TaskDeliveryService } from '../services/task/taskDeliveryService'

type Dependencies = Pick<
  AppContext,
  | 'db'
  | 'threadService'
  | 'resourceService'
  | 'conversationProjection'
  | 'gatewayHub'
  | 'kernelOutboxRepo'
>
type SocialDelivery = {
  authorize: (origin: TaskOrigin) => Promise<string | undefined>
  delivery: TaskDeliveryService
}

/** 交付重试独立于生成执行；本地落消息与附件绑定使用同一事务。 */
export class PictoriaDelivery {
  constructor(
    private readonly deps: Dependencies,
    private readonly calls: ApplicationCallRepository,
    private readonly deliveryRoot: string,
    private readonly asset: (owner: string, id: string) => Promise<{ info: Asset; bytes: Buffer }>,
    private readonly socialProvider: () => SocialDelivery | undefined,
  ) {}
  private get social() {
    return this.socialProvider()
  }
  async deliver(call: ApplicationCall, run: Run): Promise<void> {
    const origin = (JSON.parse(call.requestJson) as { origin?: TaskOrigin }).origin
    if (origin) {
      if (!this.social || !(await this.social.delivery.applicationReady(origin, call.agentId)))
        throw new Error('原社交通道暂不可用，等待绑定与连接恢复')
      const resources: Array<{
        type: 'image' | 'video' | 'audio' | 'file'
        localPath: string
        name: string
      }> = []
      await mkdir(this.deliveryRoot, { recursive: true })
      for (const id of assetIds(run.result)) {
        const { info, bytes } = await this.asset(call.agentId, id)
        const localPath = path.join(this.deliveryRoot, info.id)
        await writeFile(localPath, bytes)
        const type =
          info.mimeType.startsWith('image/') && info.mimeType !== 'image/svg+xml'
            ? 'image'
            : info.mimeType.startsWith('video/')
              ? 'video'
              : info.mimeType.startsWith('audio/')
                ? 'audio'
                : 'file'
        resources.push({ type, localPath, name: info.name })
      }
      const content =
        Object.values(run.result ?? {})
          .filter((value) => typeof value === 'string')
          .join('\n') || (resources.length ? '作品已完成。' : '创作状态已更新。')
      this.calls.patch(call.id, { deliveryStatus: 'sending' })
      try {
        await this.social.delivery.sendApplicationResources(
          origin,
          call.agentId,
          content,
          resources,
        )
        this.calls.patch(call.id, { deliveryStatus: 'sent' })
      } catch (error) {
        this.calls.patch(call.id, {
          deliveryStatus: 'uncertain',
          error: '外部发送结果未确认，请核验后处理',
        })
        throw error
      }
      return
    }
    const thread = await this.deps.threadService.getThread(call.threadId)
    if (!thread || thread.agentId !== call.agentId) throw new Error('原会话已不存在或归属已改变')
    const resources: Array<MessageResource & { id: string }> = []
    for (const id of assetIds(run.result)) {
      const { info, bytes } = await this.asset(call.agentId, id)
      resources.push(
        await this.deps.resourceService.importApplicationOutput(
          { agentId: call.agentId, threadId: call.threadId },
          {
            appId: pictoriaManifest.id,
            runId: run.id,
            assetId: id,
            bytes,
            name: info.name,
            mimeType: info.mimeType,
          },
        ),
      )
    }
    const text = Object.entries(run.result ?? {})
      .filter(([, value]) => typeof value === 'string')
      .map(([, value]) => value)
      .join('\n')
    this.deps.db.transaction((tx) => {
      const latest = tx
        .select()
        .from(applicationCalls)
        .where(eq(applicationCalls.id, call.id))
        .get()
      if (latest?.messageId) return
      const target = tx
        .select()
        .from(threads)
        .where(and(eq(threads.id, call.threadId), eq(threads.agentId, call.agentId)))
        .get()
      if (!target || target.status === 'deleted') throw new Error('原会话已不可写入')
      const message = tx
        .insert(threadMessages)
        .values({
          threadId: call.threadId,
          role: 'assistant',
          agentId: call.agentId,
          content:
            text ||
            (resources.length
              ? '作品已完成。'
              : run.state === 'cancelled'
                ? '创作已取消。'
                : '创作未完成，请查看执行记录。'),
          metadataJson: JSON.stringify({
            kind: 'application_result',
            appId: pictoriaManifest.id,
            runId: run.id,
            projectId: run.projectId,
          }),
          scorerStatus: 'skipped',
          status: 'active',
        })
        .returning({ id: threadMessages.id })
        .get()!
      for (const resource of resources)
        tx.update(messageAttachments)
          .set({ messageId: message.id, status: 'bound', boundAt: new Date().toISOString() })
          .where(
            and(
              eq(messageAttachments.id, resource.id),
              eq(messageAttachments.threadId, call.threadId),
            ),
          )
          .run()
      tx.update(threads)
        .set({
          messageCount: sql`${threads.messageCount} + 1`,
          lastMessageAt: new Date().toISOString(),
        })
        .where(eq(threads.id, call.threadId))
        .run()
      tx.update(applicationCalls)
        .set({ messageId: message.id, deliveryStatus: 'sent', updatedAt: new Date().toISOString() })
        .where(eq(applicationCalls.id, call.id))
        .run()
      const event = this.deps.kernelOutboxRepo.createEvent({
        protocolVersion: 1,
        type: 'conversation.message.committed',
        durability: 'durable',
        principalId: call.agentId,
        correlationId: call.id,
        payload: {
          threadId: call.threadId,
          messageId: message.id,
          role: 'assistant',
          status: 'active',
        },
      })
      tx.insert(kernelOutboxEvents).values(this.deps.kernelOutboxRepo.toRow(event)).run()
    })
    this.deps.conversationProjection.invalidate(call.threadId)
    const snapshot = await this.deps.conversationProjection.getSnapshot(call.threadId)
    const messageId = String(this.calls.get(call.id)?.messageId)
    const message = snapshot.messages.find((item) => item.messageId === messageId)
    const surface = snapshot.surfaces.find((item) => item.messageId === messageId)
    if (message && surface) {
      const session = new ConversationSurfaceSession(
        call.threadId,
        call.agentId,
        `application:${run.id}`,
      )
      const open = session.open()
      if (open.operation.type === 'surface.open') open.operation.nodes = []
      await this.deps.gatewayHub.pushBusiness(
        'surface',
        { frame: open },
        { type: 'thread_subscribers', threadId: call.threadId },
      )
      await this.deps.gatewayHub.pushBusiness(
        'surface',
        { frame: session.commit(snapshot, message, surface) },
        { type: 'thread_subscribers', threadId: call.threadId },
      )
    }
    await this.deps.gatewayHub.pushNotification({
      notificationId: `application:${call.id}`,
      createdAt: run.updatedAt,
      title:
        run.state === 'completed'
          ? __t('server.applications', '作品已完成')
          : __t('server.applications', '创作状态更新'),
      body: run.name,
      source: 'task',
      principalId: call.agentId,
      important: true,
      target: {
        kind: 'application',
        agentId: call.agentId,
        threadId: call.threadId ?? undefined,
        applicationCallId: call.id,
      },
      level: run.state === 'failed' ? 'error' : 'success',
    })
  }
}

export function assetIds(value: unknown): string[] {
  const result = new Set<string>()
  const visit = (item: unknown, depth = 0): void => {
    if (depth > 32) throw new Error('素材结构嵌套过深')
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (!item || typeof item !== 'object') return
    const object = item as Record<string, unknown>
    if (typeof object.assetId === 'string') result.add(object.assetId)
    else Object.values(object).forEach((entry) => visit(entry, depth + 1))
  }
  visit(value)
  if (result.size > 20) throw new Error('结果资源超过 20 项限制')
  return [...result]
}
