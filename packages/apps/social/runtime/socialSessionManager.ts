/**
 * SocialSessionManager — 平台无关的社交回合与消息批次管理。
 *
 * 程序只管理节奏、批次和可靠性；是否回复始终由当前角色自己的 Agent 决定。
 */
import type { InboundMessage } from './types'
import { createLogger } from '@infos/backend/applicationHostAbi'

const logger = createLogger('SocialSessionManager')

export type ParticipationState = 'idle' | 'listening' | 'engaged'
export type ProcessingPhase = 'ready' | 'collecting' | 'running' | 'cooldown' | 'retrying'

export interface SocialWaitRequest {
  reason: 'continuation_expected' | 'missing_context' | 'conversation_unsettled'
  duration: 'short' | 'normal' | 'long'
}

export interface DeferredSocialIntent {
  intention: string
  timing: 'soon' | 'later' | 'much_later'
  expires: 'one_hour' | 'today' | 'one_day'
  condition?: string
  notBefore: number
  expiresAt: number
  sourceMessages: InboundMessage[]
}

export type SocialTurnOutcome =
  | { type: 'reply'; content: string }
  | { type: 'pass' }
  | { type: 'wait'; wait: SocialWaitRequest }
  | {
      type: 'defer'
      intent: Omit<DeferredSocialIntent, 'notBefore' | 'expiresAt' | 'sourceMessages'>
    }

export interface SocialSession {
  channelId: string
  channelType: 'private' | 'group'
  agentId: string
  participation: ParticipationState
  phase: ProcessingPhase
  pendingMessages: InboundMessage[]
  inFlightMessages: InboundMessage[]
  lastActiveTime: number
  lastMessageTime: number
  isMentioned: boolean
  flushTimer: ReturnType<typeof setTimeout> | null
  nextScanTime: number
  collectionStartedAt: number
  waitCount: number
  deferredIntent?: DeferredSocialIntent
}

export type FlushReason =
  | 'direct_timeout'
  | 'buffer_timeout'
  | 'buffer_full'
  | 'proactive_review'
  | 'intent_due'

export type FlushCallback = (
  session: SocialSession,
  messages: InboundMessage[],
  reason: FlushReason,
) => Promise<SocialTurnOutcome>

export interface SessionManagerConfig {
  privateCollectTimeout: number
  groupCollectTimeout: number
  bufferTimeout: number
  maxBufferSize: number
  engagedDuration: number
  maxCollectionDuration: number
  maxWaitCount: number
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  privateCollectTimeout: 3,
  groupCollectTimeout: 6,
  bufferTimeout: 20,
  maxBufferSize: 10,
  engagedDuration: 120,
  maxCollectionDuration: 20,
  maxWaitCount: 2,
}

export class SocialSessionManager {
  private sessions = new Map<string, SocialSession>()
  private config: SessionManagerConfig

  constructor(
    private readonly flushCallback: FlushCallback,
    config?: Partial<SessionManagerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getOrCreate(msg: InboundMessage): SocialSession {
    const key = this.sessionKey(msg.agentId, msg.channelType, msg.channelId)
    let session = this.sessions.get(key)
    if (!session) {
      session = {
        channelId: msg.channelId,
        channelType: msg.channelType,
        agentId: msg.agentId,
        participation: 'idle',
        phase: 'ready',
        pendingMessages: [],
        inFlightMessages: [],
        lastActiveTime: 0,
        lastMessageTime: Date.now(),
        isMentioned: false,
        flushTimer: null,
        nextScanTime: Date.now() + 5 * 60_000,
        collectionStartedAt: 0,
        waitCount: 0,
      }
      this.sessions.set(key, session)
    }
    return session
  }

  listSessions(): SocialSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastMessageTime - a.lastMessageTime)
  }

  closeSession(agentId: string, channelId: string): boolean {
    const entry = [...this.sessions.entries()].find(
      ([, session]) => session.agentId === agentId && session.channelId === channelId,
    )
    if (!entry) return false
    this.clearTimer(entry[1])
    return this.sessions.delete(entry[0])
  }

  closeSessionsExcept(predicate: (session: SocialSession) => boolean): number {
    let closed = 0
    for (const [key, session] of this.sessions) {
      if (predicate(session)) continue
      this.clearTimer(session)
      this.sessions.delete(key)
      closed++
    }
    return closed
  }

  getActiveSessions(channelType?: 'private' | 'group', limit = 5): SocialSession[] {
    return this.listSessions()
      .filter((session) => !channelType || session.channelType === channelType)
      .slice(0, limit)
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const session = this.getOrCreate(msg)
    const now = Date.now()
    const rawEvent = msg.rawEvent as Record<string, unknown> | undefined
    const directlyTriggered = rawEvent?._isMentioned === true || msg.channelType === 'private'

    session.lastMessageTime = now
    session.pendingMessages.push(msg)
    if (directlyTriggered) {
      session.isMentioned = true
      session.participation = session.participation === 'engaged' ? 'engaged' : 'listening'
    }

    // running 期间的新消息只进入下一批，绝不悄悄并入正在推理的上下文。
    if (session.phase === 'running' || session.phase === 'retrying') return

    const directCollection = directlyTriggered || session.isMentioned
    const engagedContinuation = session.participation === 'engaged'

    // 普通大群消息只进入有界观察窗口，不按消息数或固定超时直接唤醒 Agent。
    // 自主观察由 Scheduler 稀疏挑选候选会话，避免高流量群按批次线性调用 LLM。
    if (!directCollection && !engagedContinuation) {
      session.phase = 'ready'
      if (session.pendingMessages.length > this.config.maxBufferSize) {
        session.pendingMessages.splice(
          0,
          session.pendingMessages.length - this.config.maxBufferSize,
        )
      }
      return
    }

    if (session.phase !== 'collecting') {
      session.phase = 'collecting'
      session.collectionStartedAt = now
      session.waitCount = 0
    }

    if (session.pendingMessages.length >= this.config.maxBufferSize) {
      await this.triggerFlush(session, 'buffer_full')
      return
    }

    const timeout = directCollection
      ? msg.channelType === 'private'
        ? this.config.privateCollectTimeout
        : this.config.groupCollectTimeout
      : this.config.bufferTimeout
    this.scheduleFlush(session, timeout, directCollection ? 'direct_timeout' : 'buffer_timeout')
  }

  async review(session: SocialSession, reason: FlushReason = 'proactive_review'): Promise<void> {
    await this.triggerFlush(session, reason)
  }

  async retry(session: SocialSession): Promise<void> {
    if (session.phase !== 'retrying' || session.pendingMessages.length === 0) return
    session.phase = 'ready'
    await this.triggerFlush(session, 'buffer_timeout')
  }

  markReplied(session: SocialSession): void {
    session.participation = 'engaged'
    session.phase = 'cooldown'
    session.lastActiveTime = Date.now()
    session.isMentioned = false
    session.nextScanTime = Date.now() + 2 * 60_000
  }

  checkActiveExpiry(session: SocialSession): void {
    if (session.participation !== 'engaged') return
    if (Date.now() - session.lastActiveTime > this.config.engagedDuration * 1000) {
      session.participation = 'idle'
      if (session.phase === 'cooldown') session.phase = 'ready'
    }
  }

  dueDeferredIntent(session: SocialSession, now = Date.now()): DeferredSocialIntent | undefined {
    const intent = session.deferredIntent
    if (!intent) return undefined
    if (now >= intent.expiresAt) {
      session.deferredIntent = undefined
      return undefined
    }
    return now >= intent.notBefore ? intent : undefined
  }

  private async triggerFlush(session: SocialSession, reason: FlushReason): Promise<void> {
    this.clearTimer(session)
    if (session.phase === 'running' || session.phase === 'retrying') return

    if (reason === 'intent_due' && session.deferredIntent) {
      session.pendingMessages.unshift(...session.deferredIntent.sourceMessages)
    }
    if (session.pendingMessages.length === 0) return

    const messages = session.pendingMessages.splice(0)
    session.inFlightMessages = messages
    session.phase = 'running'
    logger.info(`[${session.channelId}] 社交批次开始: reason=${reason}, msgs=${messages.length}`)

    try {
      const outcome = await this.flushCallback(session, messages, reason)
      await this.applyOutcome(session, messages, outcome)
    } catch (error) {
      // 失败批次回到队首，避免持久化虽成功但实时处理机会丢失。
      session.pendingMessages.unshift(...messages)
      session.inFlightMessages = []
      session.phase = 'retrying'
      session.nextScanTime = Date.now() + 60_000
      logger.warn(`[${session.channelId}] 社交批次失败，已保留等待重试: ${String(error)}`)
    }
  }

  private async applyOutcome(
    session: SocialSession,
    messages: InboundMessage[],
    outcome: SocialTurnOutcome,
  ): Promise<void> {
    session.inFlightMessages = []
    if (outcome.type === 'reply') {
      session.deferredIntent = undefined
      this.markReplied(session)
      return
    }
    if (outcome.type === 'pass') {
      session.deferredIntent = undefined
      session.phase = 'ready'
      session.isMentioned = false
      session.nextScanTime = Date.now() + 5 * 60_000
      if (session.participation !== 'engaged') session.participation = 'idle'
      return
    }
    if (outcome.type === 'wait') {
      session.pendingMessages.unshift(...messages)
      session.phase = 'collecting'
      session.waitCount++
      const elapsed = Date.now() - session.collectionStartedAt
      const hardRemaining = Math.max(0, this.config.maxCollectionDuration * 1000 - elapsed)
      if (session.waitCount > this.config.maxWaitCount || hardRemaining === 0) {
        session.phase = 'ready'
        session.pendingMessages.splice(0, messages.length)
        return
      }
      const seconds = this.waitSeconds(session.channelType, outcome.wait.duration)
      this.scheduleFlush(session, Math.min(seconds * 1000, hardRemaining) / 1000, 'direct_timeout')
      return
    }

    const now = Date.now()
    const delay = this.deferDelay(outcome.intent.timing)
    const lifetime = this.deferLifetime(outcome.intent.expires, now)
    session.deferredIntent = {
      ...outcome.intent,
      notBefore: now + delay,
      expiresAt: lifetime,
      sourceMessages: messages,
    }
    session.phase = 'ready'
    session.isMentioned = false
    session.nextScanTime = now + delay
  }

  private scheduleFlush(session: SocialSession, seconds: number, reason: FlushReason): void {
    this.clearTimer(session)
    session.flushTimer = setTimeout(
      () => {
        this.triggerFlush(session, reason).catch((error) =>
          logger.error(`[${session.channelId}] 社交计时触发失败: ${String(error)}`),
        )
      },
      Math.max(0, seconds * 1000),
    )
  }

  private waitSeconds(type: 'private' | 'group', duration: SocialWaitRequest['duration']): number {
    const table =
      type === 'private' ? { short: 2, normal: 5, long: 10 } : { short: 4, normal: 10, long: 20 }
    return table[duration]
  }

  private deferDelay(timing: DeferredSocialIntent['timing']): number {
    const ranges = { soon: [5, 15], later: [30, 90], much_later: [120, 360] } as const
    const [min, max] = ranges[timing]
    return (min + Math.floor(Math.random() * (max - min + 1))) * 60_000
  }

  private deferLifetime(expires: DeferredSocialIntent['expires'], now: number): number {
    if (expires === 'one_hour') return now + 60 * 60_000
    if (expires === 'one_day') return now + 24 * 60 * 60_000
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return end.getTime()
  }

  private sessionKey(agentId: string, channelType: string, channelId: string): string {
    return `${agentId}:${channelType}:${channelId}`
  }

  private clearTimer(session: SocialSession): void {
    if (!session.flushTimer) return
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
}
