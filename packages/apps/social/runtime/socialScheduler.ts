/**
 * SocialScheduler — 纯 TypeScript 社交调度器。
 *
 * 只负责夜间静音、冷却、候选排序和延后意图到期；所有语义判断均由角色自己的 Agent 完成。
 */
import type { SocialExecutionPort } from '@infos/shared'
import type { SocialSessionManager, SocialSession } from './socialSessionManager'
import { createLogger } from '@infos/backend/applicationHostAbi'

const logger = createLogger('SocialScheduler')

export interface SocialSchedulerConfig {
  proactiveGroupEnabled: boolean
  minMessagesForReview: number
  nightSilenceEnabled: boolean
  nightSilenceStart: number
  nightSilenceEnd: number
}

const DEFAULT_CONFIG: SocialSchedulerConfig = {
  proactiveGroupEnabled: true,
  minMessagesForReview: 3,
  nightSilenceEnabled: true,
  nightSilenceStart: 0,
  nightSilenceEnd: 8,
}

export interface SocialSchedulerDeps {
  sessionManager: SocialSessionManager
  executions?: SocialExecutionPort
}

export class SocialScheduler {
  private config: SocialSchedulerConfig
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private nextGroupReviewAt = 0

  constructor(
    private readonly deps: SocialSchedulerDeps,
    config?: Partial<SocialSchedulerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getConfig(): SocialSchedulerConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<SocialSchedulerConfig>): SocialSchedulerConfig {
    this.config = { ...this.config, ...config }
    return this.getConfig()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.nextGroupReviewAt = Date.now() + (5 + Math.floor(Math.random() * 6)) * 60_000
    this.schedulePoll()
    logger.info('社交调度器已启动（单 Agent 确定性门控）')
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedulePoll(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.scan()
        .catch((error) => logger.error(`社交调度扫描失败: ${String(error)}`))
        .finally(() => this.schedulePoll())
    }, 10_000)
  }

  private async scan(): Promise<void> {
    if (this.isNightSilence()) return
    const now = Date.now()
    const sessions = this.deps.sessionManager.getActiveSessions(undefined, 50)

    // 延后意图拥有最高调度优先级，到期时重新唤醒同一个角色 Agent 核验语境。
    for (const session of sessions) {
      if (session.phase === 'retrying' && now >= session.nextScanTime) {
        await this.deps.sessionManager.retry(session)
        continue
      }
      if (!this.deps.sessionManager.dueDeferredIntent(session, now)) continue
      await this.runReview(session, 'intent_due')
    }

    if (!this.config.proactiveGroupEnabled || now < this.nextGroupReviewAt) return
    const candidates = sessions
      .filter(
        (session) =>
          session.channelType === 'group' &&
          session.phase !== 'running' &&
          session.phase !== 'retrying' &&
          session.pendingMessages.length >= this.config.minMessagesForReview &&
          now >= session.nextScanTime,
      )
      .sort((a, b) => this.priority(b, now) - this.priority(a, now))

    const target = candidates[0]
    if (!target) {
      this.nextGroupReviewAt = now + 10 * 60_000
      return
    }

    await this.runReview(target, 'proactive_review')
    // 一次只给角色一个自主观察机会，避免在多个群之间连续轰炸主模型。
    this.nextGroupReviewAt = now + (20 + Math.floor(Math.random() * 21)) * 60_000
  }

  private priority(session: SocialSession, now: number): number {
    const recency = Math.max(0, 10 * 60_000 - (now - session.lastMessageTime)) / 60_000
    const directSignal = session.isMentioned ? 100 : 0
    const continuity = session.participation === 'engaged' ? 20 : 0
    return directSignal + continuity + recency + Math.min(session.pendingMessages.length, 20)
  }

  private async runReview(
    session: SocialSession,
    reason: 'proactive_review' | 'intent_due',
  ): Promise<void> {
    if (!this.deps.executions) return this.deps.sessionManager.review(session, reason)
    await this.deps.executions.run({
      taskId: `social-review:${session.agentId}:${session.channelId}:${Date.now()}`,
      class: 'resident',
      priority: reason === 'intent_due' ? 4 : 2,
      resourceKey: `social-session:${session.agentId}:${session.channelType}:${session.channelId}`,
      maxDurationMs: 5 * 60_000,
      run: () => this.deps.sessionManager.review(session, reason),
    })
  }

  private isNightSilence(): boolean {
    if (!this.config.nightSilenceEnabled) return false
    const hour = new Date().getHours()
    const { nightSilenceStart: start, nightSilenceEnd: end } = this.config
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end
  }
}
