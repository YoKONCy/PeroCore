/**
 * SocialSessionManager — 社交会话缓冲管理 (Layer 1)
 *
 * 管理每个社交会话的消息缓冲区和状态机。
 * 完全平台无关 — 只处理 InboundMessage。
 *
 * - observing: 默认旁观模式 (群聊) / 正常模式 (私聊)
 * - summoned: 被 @/唤醒, 启动 accumulation timer
 * - active:   主动发言后保持活跃 (续订窗口内的消息也计入)
 * - dive:     潜水模式 (不主动发言)
 *
 * 缓冲策略:
 * - summoned: 固定 timer (私聊 7s / 群聊 15s), 不被后续消息重置
 * - active:   后续消息重置 20s 非活跃 timer
 * - buffer_full: 超过 maxBufferSize 立即 flush
 *
 * @module packages/apps/social/runtime/socialSessionManager
 */

import type { InboundMessage } from './types'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialSessionManager')

// ─────────────────────────────────────────────
// 会话状态
// ─────────────────────────────────────────────

/** 会话状态枚举 */
export type SessionState = 'observing' | 'summoned' | 'active' | 'dive'

/** 内存中的社交会话 */
export interface SocialSession {
  /** 会话 ID (channelId) */
  channelId: string
  /** 会话类型 */
  channelType: 'private' | 'group'
  /** 关联的 Agent ID */
  agentId: string
  /** 当前状态 */
  state: SessionState
  /** 消息缓冲区 */
  buffer: InboundMessage[]
  /** 最后活跃时间 */
  lastActiveTime: number
  /** 最后消息时间 */
  lastMessageTime: number
  /** 被 @ 状态 */
  isMentioned: boolean
  /** flush 计时器 */
  flushTimer: ReturnType<typeof setTimeout> | null
  /** 下次扫描时间 (动态调整) */
  nextScanTime: number
}

/** flush 触发原因 */
export type FlushReason =
  | 'summon_timeout' // 被召唤后累积超时
  | 'buffer_timeout' // 缓冲区非活跃超时
  | 'buffer_full' // 缓冲区满

/** flush 回调 */
export type FlushCallback = (
  session: SocialSession,
  messages: InboundMessage[],
  reason: FlushReason,
) => Promise<void>

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

export interface SessionManagerConfig {
  /** 私聊被召唤后的累积等待 (秒) */
  privateSummonTimeout: number
  /** 群聊被召唤后的累积等待 (秒) */
  groupSummonTimeout: number
  /** 非活跃缓冲超时 (秒) */
  bufferTimeout: number
  /** 缓冲区最大消息数 */
  maxBufferSize: number
  /** 活跃状态持续时间 (秒) */
  activeDuration: number
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  privateSummonTimeout: 7,
  groupSummonTimeout: 15,
  bufferTimeout: 20,
  maxBufferSize: 10,
  activeDuration: 120,
}

// ─────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────

export class SocialSessionManager {
  private sessions = new Map<string, SocialSession>()
  private config: SessionManagerConfig
  private flushCallback: FlushCallback

  constructor(flushCallback: FlushCallback, config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.flushCallback = flushCallback
  }

  // ── 会话管理 ──

  /** 获取或创建会话 (使用 agentId:channelId 复合键) */
  getOrCreate(msg: InboundMessage): SocialSession {
    const key = `${msg.agentId}:${msg.channelId}`

    if (!this.sessions.has(key)) {
      const session: SocialSession = {
        channelId: msg.channelId,
        channelType: msg.channelType,
        agentId: msg.agentId,
        state: 'observing',
        buffer: [],
        lastActiveTime: 0,
        lastMessageTime: Date.now(),
        isMentioned: false,
        flushTimer: null,
        nextScanTime: Date.now() + 5 * 60 * 1000,
      }
      this.sessions.set(key, session)
    }

    return this.sessions.get(key)!
  }

  /** 获取所有活跃会话 */
  getActiveSessions(channelType?: 'private' | 'group', limit = 5): SocialSession[] {
    let candidates = [...this.sessions.values()]

    if (channelType) {
      candidates = candidates.filter((s) => s.channelType === channelType)
    }

    return candidates.sort((a, b) => b.lastMessageTime - a.lastMessageTime).slice(0, limit)
  }

  // ── 消息处理 ──

  /**
   * 处理入站消息
   *
   */
  async handleInbound(msg: InboundMessage): Promise<void> {
    const session = this.getOrCreate(msg)
    const now = Date.now()
    session.lastMessageTime = now

    // 检查是否被 @
    const rawEvent = msg.rawEvent as Record<string, unknown> | undefined
    const isMentioned = rawEvent?._isMentioned === true || msg.channelType === 'private' // 私聊始终视为被提及

    // 添加到缓冲区
    session.buffer.push(msg)

    // ── 状态转换 + 计时器逻辑 ──

    if (isMentioned) {
      session.isMentioned = true
      session.lastActiveTime = now

      if (session.state !== 'summoned') {
        // 首次提及 → 进入 summoned, 启动固定累积计时器
        session.state = 'summoned'
        const timeout =
          msg.channelType === 'private'
            ? this.config.privateSummonTimeout
            : this.config.groupSummonTimeout

        logger.info(
          `[${msg.channelId}] 被提及唤醒 (${msg.channelType}), ` + `启动 ${timeout}s 累积计时器`,
        )

        this.clearTimer(session)
        session.flushTimer = setTimeout(() => {
          this.triggerFlush(session, 'summon_timeout').catch((err) =>
            logger.error(`summon_timeout flush 失败: ${err}`),
          )
        }, timeout * 1000)
      } else {
        // 已是 summoned: 继续累积, 不重置计时器
        logger.debug(`[${msg.channelId}] summoned 状态下再次被提及, 继续累积`)
      }
    } else if (session.state === 'active') {
      // 活跃状态下的普通消息 → 续订活跃
      session.lastActiveTime = now
      this.resetBufferTimer(session)
    } else if (session.state === 'summoned') {
      // summoned 状态下的普通消息 → 继续累积, 不重置
    } else if (session.buffer.length >= this.config.maxBufferSize) {
      // 缓冲区满 → 立即 flush
      logger.info(`[${msg.channelId}] 缓冲区已满 (${session.buffer.length})`)
      await this.triggerFlush(session, 'buffer_full')
    } else {
      // 普通 observing → 重置非活跃计时器
      this.resetBufferTimer(session)
    }

    // 超额检查 (即使在其他状态下, 缓冲区也不能无限增长)
    if (session.buffer.length >= this.config.maxBufferSize && session.state !== 'summoned') {
      await this.triggerFlush(session, 'buffer_full')
    }
  }

  /**
   * 标记 Agent 已回复 → 进入活跃状态
   */
  markReplied(session: SocialSession): void {
    session.state = 'active'
    session.lastActiveTime = Date.now()
    session.isMentioned = false
    logger.debug(`[${session.channelId}] 进入活跃状态`)
  }

  /**
   * 标记 Agent 决定 PASS（跳过回复）→ 直接切换到非活跃期 (observing)
   *
   * 使用场景：LLM 在 summoned/active 状态下经过双重思考决策后输出 "PASS"，
   * 表示本次不打算插嘴。此时必须显式将会话切回 observing，否则：
   * - 卡在 summoned：下次被 @ 时不会启动新的累积计时器（handleInbound 中
   *   `if (session.state !== 'summoned')` 分支无法进入），导致响应丢失
   * - 卡在 active：会继续按 20s 非活跃 timer 续订，无谓地触发后续 flush
   *
   * 切换动作：
   * 1. state → observing（非活跃期，可被后续 @ 重新唤醒）
   * 2. 清理 isMentioned（避免残留状态影响下次决策）
   * 3. 清理 flushTimer（PASS 后不应再有挂起的 flush）
   * 4. 重置 nextScanTime 到一个较短的未来时刻（5 分钟后），
   *    让调度器在合理时机重新评估该会话，而非立即重新触发
   *
   * @param session 当前会话
   */
  markPass(session: SocialSession): void {
    session.state = 'observing'
    session.isMentioned = false
    this.clearTimer(session)
    // 5 分钟后允许调度器再次扫描此会话
    // 选 5 分钟是为了避免 PASS 后被同一波消息立即重新触发，
    // 同时不至于让会话"沉睡太久"而错过后续真正相关的对话
    session.nextScanTime = Date.now() + 5 * 60 * 1000
    logger.info(
      `[${session.channelId}] LLM 输出 PASS，会话切换到非活跃期 (observing)，5 分钟后可再次扫描`,
    )
  }

  /**
   * 检查活跃状态是否过期 → 回退到 observing
   */
  checkActiveExpiry(session: SocialSession): void {
    if (session.state !== 'active') return

    const elapsed = Date.now() - session.lastActiveTime
    if (elapsed > this.config.activeDuration * 1000) {
      session.state = 'observing'
      logger.debug(`[${session.channelId}] 活跃状态过期, 回退到 observing`)
    }
  }

  // ── 内部方法 ──

  private async triggerFlush(session: SocialSession, reason: FlushReason): Promise<void> {
    this.clearTimer(session)

    if (session.buffer.length === 0) return

    const messages = [...session.buffer]
    session.buffer = []

    logger.info(`[${session.channelId}] flush: reason=${reason}, msgs=${messages.length}`)

    try {
      await this.flushCallback(session, messages, reason)
    } catch (err) {
      logger.error(`flush 回调失败: ${err}`)
    }
  }

  private resetBufferTimer(session: SocialSession): void {
    this.clearTimer(session)
    session.flushTimer = setTimeout(() => {
      this.triggerFlush(session, 'buffer_timeout').catch((err) =>
        logger.error(`buffer_timeout flush 失败: ${err}`),
      )
    }, this.config.bufferTimeout * 1000)
  }

  private clearTimer(session: SocialSession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
  }
}
