import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { DEFAULT_CHARACTER_STATE, normalizeCharacterState } from '@infos/shared'
import {
  threadCharacterStateEvents as events,
  threads,
  threadMessages,
  groupChatMessages,
} from '../../database/schema'
import type { DrizzleDb } from '../../database'
import { AppError } from '../../lib/appError'

const TEMP_TEXT_TTL_MS = 6 * 60 * 60 * 1000
const MAX_TEMP_LINES_PER_POOL = 12
const mergeLines = (before: string[], after: string[]) =>
  [...new Set([...before, ...after].map((line) => line.trim()).filter(Boolean))].slice(
    -MAX_TEMP_LINES_PER_POOL,
  )

export interface PetStateUpdateData {
  mood?: string
  vibe?: string
  mind?: string
  clickMessages?: Record<string, string[]>
  idleMessages?: string[]
  backMessages?: string[]
}

export interface PetStateScope {
  threadId: string
  pairId?: string
  toolCallId?: string
  signal?: AbortSignal
}

export interface PetStateData {
  agentId: string
  threadId: string
  revision: number
  mood: string
  vibe: string
  mind: string
  clickMessagesJson: string
  idleMessagesJson: string
  backMessagesJson: string
  textExpiresAt: string | null
  updatedAt: string | null
}

/** 状态归属 Thread × Agent；按剩余变更重放，删除中间轮次不会覆盖后续有效字段。 */
export class PetStateService {
  private publish?: (payload: Record<string, unknown>) => Promise<void>
  constructor(private db: DrizzleDb) {}

  setPublisher(publish: NonNullable<PetStateService['publish']>): void {
    this.publish = publish
  }

  async get(agentId: string, threadId?: string): Promise<PetStateData | null> {
    if (!threadId) return null
    const thread = this.db
      .select({ agentId: threads.agentId, channel: threads.channel, status: threads.status })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get()
    if (!thread || (thread.channel !== 'group' && thread.agentId !== agentId)) return null
    const rows = this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.threadId, threadId),
          or(eq(events.agentId, agentId), eq(events.agentId, '*')),
        ),
      )
      .orderBy(asc(events.id))
      .all()
    const state: PetStateData = {
      agentId,
      threadId,
      revision: rows.at(-1)?.id ?? 0,
      ...DEFAULT_CHARACTER_STATE,
      clickMessagesJson: '{}',
      idleMessagesJson: '[]',
      backMessagesJson: '[]',
      textExpiresAt: null,
      updatedAt: null,
    }
    if (thread.status === 'deleted') return state
    const retracted = new Set(rows.filter((row) => row.kind === 'retract').map((row) => row.pairId))
    const clearedThrough = rows.filter((row) => row.kind === 'clear').at(-1)?.id ?? 0
    let click: Record<string, string[]> = {},
      idle: string[] = [],
      back: string[] = []
    for (const row of rows) {
      if (
        row.kind !== 'update' ||
        row.id <= clearedThrough ||
        (row.pairId && retracted.has(row.pairId))
      )
        continue
      const patch = JSON.parse(row.patchJson) as PetStateUpdateData
      Object.assign(state, normalizeCharacterState(patch))
      if (patch.clickMessages || patch.idleMessages || patch.backMessages) {
        if (!state.textExpiresAt || Date.parse(state.textExpiresAt) <= Date.parse(row.createdAt)) {
          click = {}
          idle = []
          back = []
        }
        for (const [part, lines] of Object.entries(patch.clickMessages ?? {}))
          click[part] = mergeLines(click[part] ?? [], lines)
        idle = mergeLines(idle, patch.idleMessages ?? [])
        back = mergeLines(back, patch.backMessages ?? [])
        state.textExpiresAt = new Date(Date.parse(row.createdAt) + TEMP_TEXT_TTL_MS).toISOString()
      }
      state.updatedAt = row.createdAt
    }
    if (this.hasActiveTemporaryTexts(state)) {
      state.clickMessagesJson = JSON.stringify(click)
      state.idleMessagesJson = JSON.stringify(idle)
      state.backMessagesJson = JSON.stringify(back)
    } else state.textExpiresAt = null
    return state
  }

  hasActiveTemporaryTexts(state: PetStateData | null): boolean {
    return !!state?.textExpiresAt && Date.parse(state.textExpiresAt) > Date.now()
  }

  async update(
    agentId: string,
    data: PetStateUpdateData,
    scope?: PetStateScope,
  ): Promise<string | null> {
    if (!scope?.threadId || !scope.pairId)
      throw new AppError('INVALID_PARAMETER', {
        message: '角色状态更新缺少会话或消息轮次标识，无法建立可撤回记录',
      })
    scope.signal?.throwIfAborted()
    // 全部检查与写入同步完成，不在检查后让出执行权，避免撤回与旧工具竞态。
    this.db.transaction((tx) => {
      const thread = tx
        .select({
          agentId: threads.agentId,
          channel: threads.channel,
          status: threads.status,
          platform: threads.platform,
          platformIdentifier: threads.platformIdentifier,
        })
        .from(threads)
        .where(eq(threads.id, scope.threadId))
        .get()
      if (
        !thread ||
        thread.status === 'deleted' ||
        (thread.channel !== 'group' && thread.agentId !== agentId)
      )
        throw new AppError('FORBIDDEN', { message: '该会话不存在、已删除或不属于当前角色' })
      if (
        scope.pairId &&
        tx
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.threadId, scope.threadId),
              eq(events.kind, 'retract'),
              eq(events.pairId, scope.pairId),
            ),
          )
          .get()
      )
        throw new AppError('CONFLICT', { message: '对应消息已撤回，不能重新写入角色状态' })
      const activePair =
        thread.platform === 'stronghold'
          ? tx
              .select({ id: groupChatMessages.id })
              .from(groupChatMessages)
              .where(
                and(
                  eq(
                    groupChatMessages.roomId,
                    (thread.platformIdentifier ?? '').slice(0, -(thread.agentId.length + 1)),
                  ),
                  eq(groupChatMessages.pairId, scope.pairId!),
                ),
              )
              .get()
          : tx
              .select({ id: threadMessages.id })
              .from(threadMessages)
              .where(
                and(
                  eq(threadMessages.threadId, scope.threadId),
                  eq(threadMessages.pairId, scope.pairId!),
                  eq(threadMessages.status, 'active'),
                ),
              )
              .get()
      if (!activePair) throw new AppError('CONFLICT', { message: '状态来源消息不存在或已撤回' })
      const patch: PetStateUpdateData = {
        ...normalizeCharacterState(data),
        clickMessages: data.clickMessages,
        idleMessages: data.idleMessages,
        backMessages: data.backMessages,
      }
      tx.insert(events)
        .values({
          threadId: scope.threadId,
          agentId,
          kind: 'update',
          pairId: scope.pairId ?? null,
          toolCallId: scope.toolCallId ?? null,
          patchJson: JSON.stringify(patch),
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .run()
    })
    return (await this.get(agentId, scope.threadId))?.textExpiresAt ?? null
  }

  async rollbackPairs(threadId: string, pairIds: string[]): Promise<void> {
    if (!pairIds.length) return
    const agents = this.db
      .selectDistinct({ agentId: events.agentId })
      .from(events)
      .where(
        and(
          eq(events.threadId, threadId),
          eq(events.kind, 'update'),
          inArray(events.pairId, pairIds),
        ),
      )
      .all()
    this.db.transaction((tx) => {
      for (const pairId of new Set(pairIds))
        tx.insert(events)
          .values({
            threadId,
            agentId: '*',
            kind: 'retract',
            pairId,
            createdAt: new Date().toISOString(),
          })
          .run()
    })
    for (const { agentId } of agents) await this.broadcast(agentId, threadId)
  }

  async clearThread(threadId: string): Promise<void> {
    const agents = this.db
      .selectDistinct({ agentId: events.agentId })
      .from(events)
      .where(and(eq(events.threadId, threadId), eq(events.kind, 'update')))
      .all()
    this.db
      .insert(events)
      .values({ threadId, agentId: '*', kind: 'clear', createdAt: new Date().toISOString() })
      .run()
    for (const { agentId } of agents) await this.broadcast(agentId, threadId)
  }

  async rollbackRoomPair(roomId: string, pairId: string): Promise<void> {
    const roomThreads = this.db
      .select({ id: threads.id, identity: threads.platformIdentifier })
      .from(threads)
      .where(eq(threads.platform, 'stronghold'))
      .all()
      .filter((thread) => thread.identity?.startsWith(roomId + ':'))
    for (const thread of roomThreads) await this.rollbackPairs(thread.id, [pairId])
  }

  async clearChannel(channel: string): Promise<void> {
    const channelThreads = this.db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.channel, channel))
      .all()
    for (const thread of channelThreads) await this.clearThread(thread.id)
  }

  async broadcast(agentId: string, threadId: string): Promise<void> {
    const state = await this.get(agentId, threadId)
    if (!state) return
    await this.publish?.({
      agentId,
      threadId,
      revision: state.revision,
      replace: true,
      mood: state.mood,
      vibe: state.vibe,
      mind: state.mind,
      click_messages: JSON.parse(state.clickMessagesJson),
      idle_messages: JSON.parse(state.idleMessagesJson),
      back_messages: JSON.parse(state.backMessagesJson),
      text_expires_at: state.textExpiresAt,
    })
  }
}
