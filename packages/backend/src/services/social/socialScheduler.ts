/**
 * SocialScheduler — 社交模式调度器 (Layer 1)
 *
 * 管理社交模式的自动行为:
 * 1. 群聊扫描循环 — 定期审视群聊缓冲, 思考状态机决策是否主动发言
 * 2. 私聊扫描循环 — 独立时间表, 更敏感的触发
 * 3. 思考状态机 — 基于缓冲内容决定是否需要 Agent 回复
 *
 * 完全平台无关 — 只依赖 SocialSessionManager + SocialBridge。
 *
 * 注意: "思考状态机" 使用书记员模型驱动, 它不是独立的模型角色,
 * 而是社交场景的观察→判断→行动决策流程。
 *
 * - _group_scan_loop (L618-712)
 * - _private_scan_loop (L714-765)
 * - _attempt_random_thought (L816-1060)
 *
 * @module packages/backend/src/services/social/socialScheduler
 */

import type { SocialSessionManager, SocialSession } from './socialSessionManager'
import type { InboundMessage } from './types'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SocialScheduler')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

export interface SocialSchedulerConfig {
  /** 群聊扫描间隔 (秒) */
  groupScanInterval: number
  /** 私聊扫描间隔 (秒) */
  privateScanInterval: number
  /** 最少缓冲消息数才触发思考状态机审视 */
  minMessagesForReview: number
  /** 思考状态机 LLM 温度 */
  thinkingTemperature: number
}

const DEFAULT_CONFIG: SocialSchedulerConfig = {
  groupScanInterval: 5 * 60, // 5 分钟
  privateScanInterval: 2 * 60, // 2 分钟
  minMessagesForReview: 3,
  thinkingTemperature: 0.3,
}

// ─────────────────────────────────────────────
// 思考状态机决策输出
// ─────────────────────────────────────────────

/** 思考状态机的决策结果 */
interface ThinkingDecision {
  /** 是否应该回复 */
  shouldReply: boolean
  /** 理由 (调试/日志用) */
  reason: string
  /** 建议的回复风格 */
  style?: 'normal' | 'brief' | 'enthusiastic'
}

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface SocialSchedulerDeps {
  sessionManager: SocialSessionManager
  llmService: LlmService
  mdpEngine: MdpEngine
  /** 书记员模型配置获取器 (由 ModelRoleResolver.bind('secretary') 提供) */
  getThinkingModel: () => Promise<ModelConfig | null>
  /** 决定回复后的回调 (由 SocialBridge 提供) */
  onDecideReply: (session: SocialSession, messages: InboundMessage[]) => Promise<void>
}

// ─────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────

export class SocialScheduler {
  private deps: SocialSchedulerDeps
  private config: SocialSchedulerConfig
  private running = false
  private groupTimer: ReturnType<typeof setInterval> | null = null
  private privateTimer: ReturnType<typeof setInterval> | null = null

  constructor(deps: SocialSchedulerDeps, config?: Partial<SocialSchedulerConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── 启动 / 停止 ──

  start(): void {
    if (this.running) return
    this.running = true

    this.groupTimer = setInterval(() => {
      this.scanGroupSessions().catch((err) => logger.error(`群聊扫描错误: ${err}`))
    }, this.config.groupScanInterval * 1000)

    this.privateTimer = setInterval(() => {
      this.scanPrivateSessions().catch((err) => logger.error(`私聊扫描错误: ${err}`))
    }, this.config.privateScanInterval * 1000)

    logger.info(
      `社交调度器已启动 (群聊=${this.config.groupScanInterval}s, ` +
        `私聊=${this.config.privateScanInterval}s)`,
    )
  }

  stop(): void {
    this.running = false

    if (this.groupTimer) {
      clearInterval(this.groupTimer)
      this.groupTimer = null
    }
    if (this.privateTimer) {
      clearInterval(this.privateTimer)
      this.privateTimer = null
    }

    logger.info('社交调度器已停止')
  }

  // ── 扫描循环 ──

  /**
   * 群聊扫描
   *
   * 遍历所有活跃群聊会话，通过思考状态机判断是否需要主动回复。
   */
  private async scanGroupSessions(): Promise<void> {
    const sessions = this.deps.sessionManager.getActiveSessions('group', 10)
    const now = Date.now()

    for (const session of sessions) {
      // 检查活跃状态过期
      this.deps.sessionManager.checkActiveExpiry(session)

      // 跳过 dive 状态
      if (session.state === 'dive') continue

      // 跳过未到扫描时间的
      if (now < session.nextScanTime) continue

      // 跳过缓冲区为空或消息太少的
      if (session.buffer.length < this.config.minMessagesForReview) continue

      // 思考状态机决策
      try {
        const decision = await this.thinkingDecision(session, session.buffer)

        if (decision.shouldReply) {
          logger.info(`[${session.channelId}] 思考状态机决定主动发言: ${decision.reason}`)
          const messages = [...session.buffer]
          session.buffer = []
          await this.deps.onDecideReply(session, messages)
        } else {
          logger.debug(`[${session.channelId}] 思考状态机决定不发: ${decision.reason}`)
        }

        // 更新下次扫描时间 (随机化避免节奏感)
        const jitter = Math.floor(Math.random() * 120 - 60) // ±60s
        session.nextScanTime = now + (this.config.groupScanInterval + jitter) * 1000
      } catch (err) {
        logger.error(`[${session.channelId}] 思考状态机决策失败: ${err}`)
      }
    }
  }

  /**
   * 私聊扫描
   *
   * 私聊更敏感 — 如果有未回复的消息且超过扫描间隔，直接回复。
   */
  private async scanPrivateSessions(): Promise<void> {
    const sessions = this.deps.sessionManager.getActiveSessions('private', 10)
    const now = Date.now()

    for (const session of sessions) {
      if (session.state === 'dive') continue
      if (now < session.nextScanTime) continue
      if (session.buffer.length === 0) continue

      // 私聊不做思考状态机决策，直接回复
      logger.info(`[${session.channelId}] 私聊有未回复消息, 触发回复`)

      const messages = [...session.buffer]
      session.buffer = []

      try {
        await this.deps.onDecideReply(session, messages)
      } catch (err) {
        logger.error(`[${session.channelId}] 私聊回复失败: ${err}`)
      }

      // 更新下次扫描 (私聊活跃时短周期)
      const shortInterval = 120 + Math.floor(Math.random() * 120)
      session.nextScanTime = now + shortInterval * 1000
    }
  }

  // ── 思考状态机 LLM 决策 ──

  /**
   * 思考状态机 — 基于群聊缓冲内容决定是否主动发言
   *
   * 使用书记员模型驱动, 观察群聊消息后决定:
   * - shouldReply: 是否加入对话
   * - reason: 决策理由
   * - style: 建议的回复风格
   *
   */
  private async thinkingDecision(
    session: SocialSession,
    messages: InboundMessage[],
  ): Promise<ThinkingDecision> {
    const modelConfig = await this.deps.getThinkingModel()
    if (!modelConfig) {
      return { shouldReply: false, reason: '未配置书记员模型' }
    }

    // 构建消息摘要
    const contextLines = messages.map((m) => `[${m.senderName}]: ${m.content.slice(0, 200)}`)
    const context = contextLines.join('\n')

    // 使用已有的社交决策模板 (social/decisions/)
    const systemPart = this.deps.mdpEngine.render('social/decisions/secretary_decision_group', {
      agent_name: session.channelId, // TODO: 替换为实际 agent name
      current_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      target_session_name: session.channelId,
      custom_persona: '', // TODO: 注入 agent 人设
      session_state: 'ACTIVE',
      recent_history: context,
    })
    const rulesPart = this.deps.mdpEngine.render(
      'social/decisions/secretary_decision_group_rules',
      {
        agent_name: session.channelId,
        owner_name: '主人',
      },
    )
    const systemPrompt = `${systemPart}\n\n${rulesPart}`

    try {
      const completion = await this.deps.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `群聊 ${session.channelId} 最近消息:\n${context}` },
        ],
        { temperature: this.config.thinkingTemperature },
      )

      const raw = completion.choices[0]?.message?.content
      if (!raw) {
        return { shouldReply: false, reason: 'LLM 无输出' }
      }

      const parsed = parseLlmJson<ThinkingDecision>(raw)
      if (parsed) {
        return {
          shouldReply: Boolean(parsed.shouldReply),
          reason: parsed.reason ?? '思考状态机决策',
          style: parsed.style,
        }
      }

      return { shouldReply: false, reason: 'LLM 输出解析失败' }
    } catch (err) {
      logger.error(`思考状态机 LLM 调用失败: ${err}`)
      return { shouldReply: false, reason: `LLM 错误: ${err}` }
    }
  }
}
