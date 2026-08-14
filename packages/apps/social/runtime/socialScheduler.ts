/**
 * SocialScheduler — 社交模式调度器 (Layer 1)
 *
 * 管理社交模式的自动行为:
 * 1. 群聊扫描循环 — 定期审视群聊缓冲, 思考状态机决策是否主动发言
 * 2. 私聊扫描循环 — 独立时间表, 更敏感的触发
 * 3. 思考状态机 — 基于缓冲内容决定是否需要 Agent 回复
 *
 * 完全平台无关 — 只依赖 SocialSessionManager + 回调。
 *
 * 注意: "思考状态机" 使用书记员模型驱动, 它不是独立的模型角色,
 * 而是社交场景的观察→判断→行动决策流程。
 *
 * @module packages/apps/social/runtime/socialScheduler
 */

import type { SocialSessionManager, SocialSession } from './socialSessionManager'
import type { InboundMessage } from './types'
import type { LlmService, ModelConfig } from '../../../backend/src/services/llm/llmService'
import type { MdpEngine } from '../../../backend/src/services/prompt/mdpEngine'
import { parseLlmJson } from '../../../backend/src/shared/llmJsonParser'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialScheduler')

/** 截断长文本用于日志输出（与桌面模式 reactLoop 对齐，避免终端被超长 prompt 刷屏） */
function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `... (共${text.length}字符)`
}

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

export interface SocialSchedulerConfig {
  /** 是否允许群聊调度器主动审视并发言 */
  proactiveGroupEnabled: boolean
  /** 最少缓冲消息数才触发思考状态机审视 */
  minMessagesForReview: number
  /** 是否启用夜间静音 */
  nightSilenceEnabled: boolean
  /** 夜间静音开始小时 (0-23) */
  nightSilenceStart: number
  /** 夜间静音结束小时 (0-23) */
  nightSilenceEnd: number
}

const DEFAULT_CONFIG: SocialSchedulerConfig = {
  proactiveGroupEnabled: true,
  minMessagesForReview: 3,
  nightSilenceEnabled: true,
  nightSilenceStart: 0, // 00:00
  nightSilenceEnd: 8, // 08:00
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
  /** 社交决策模型获取器 (由 ModelRoleResolver.bind('social_scheduler') 提供) */
  getSocialSchedulerModel: () => Promise<ModelConfig | null>
  /** 获取决策所需的主 Agent 身份框架，保持主动决策与正式回复人格一致。 */
  getDecisionIdentity?: (agentId: string) => Promise<{
    agentName: string
    systemCore: string
    personaDefinition: string
    socialPatch: string
    /** 主人在主 app 登记的名称（owner.name），客观/中性指代用 */
    ownerName: string
    /** 角色对主人的亲密称呼（agent.json owner_appellation） */
    ownerAppellation: string
  }>
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
  /** 群聊轮询 timer */
  private groupTimer: ReturnType<typeof setTimeout> | null = null
  /** 私聊轮询 timer */
  private privateTimer: ReturnType<typeof setTimeout> | null = null
  /** 群聊下次触发时间 (启动后延迟 5~10 分钟) */
  private nextGroupThoughtTime = 0

  constructor(deps: SocialSchedulerDeps, config?: Partial<SocialSchedulerConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getConfig(): SocialSchedulerConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<SocialSchedulerConfig>): SocialSchedulerConfig {
    this.config = { ...this.config, ...config }
    return this.getConfig()
  }

  // ── 启动 / 停止 ──

  start(): void {
    if (this.running) return
    this.running = true

    // 群聊: 启动延迟 5~10 分钟 (与 v1 对齐)
    this.nextGroupThoughtTime = Date.now() + (300 + Math.floor(Math.random() * 300)) * 1000

    // 群聊轮询: 每 30s 检查一次
    this.scheduleGroupPoll()
    // 私聊轮询: 每 10s 检查一次
    this.schedulePrivatePoll()

    logger.info('社交调度器已启动 (v1 动态周期模式)')
  }

  stop(): void {
    this.running = false

    if (this.groupTimer) {
      clearTimeout(this.groupTimer)
      this.groupTimer = null
    }
    if (this.privateTimer) {
      clearTimeout(this.privateTimer)
      this.privateTimer = null
    }

    logger.info('社交调度器已停止')
  }

  // ── 群聊轮询调度 ──

  private scheduleGroupPoll(): void {
    if (!this.running) return
    this.groupTimer = setTimeout(() => {
      this.scanGroupSessions()
        .catch((err) => logger.error(`群聊扫描错误: ${err}`))
        .finally(() => this.scheduleGroupPoll())
    }, 30_000) // 30s 轮询
  }

  // ── 私聊轮询调度 ──

  private schedulePrivatePoll(): void {
    if (!this.running) return
    this.privateTimer = setTimeout(() => {
      this.scanPrivateSessions()
        .catch((err) => logger.error(`私聊扫描错误: ${err}`))
        .finally(() => this.schedulePrivatePoll())
    }, 10_000) // 10s 轮询
  }

  // ── 扫描循环 ──

  /**
   * 群聊扫描 (对齐 v1 _group_scan_loop)
   *
   * 全局单一计时器，随机选择活跃群聊进行观察。
   * 时间表动态调整:
   * - 活跃且刚说完话: 120s
   * - 活跃未说话: 60s
   * - 潜水/观察: 30~60min
   * - 无活跃会话: 10~20min
   */
  private async scanGroupSessions(): Promise<void> {
    if (!this.config.proactiveGroupEnabled) return
    // 夜间静音检查
    if (this.isNightSilence()) return

    const now = Date.now()

    // 未到触发时间
    if (now < this.nextGroupThoughtTime) return

    const sessions = this.deps.sessionManager.getActiveSessions('group', 5)

    if (sessions.length === 0) {
      // 无活跃会话 → 休眠 10~20 分钟
      const interval = 600 + Math.floor(Math.random() * 600)
      this.nextGroupThoughtTime = now + interval * 1000
      return
    }

    // 随机选择一个活跃群聊
    const target = sessions[Math.floor(Math.random() * sessions.length)]!

    // 检查活跃状态 (120s 内互动过)
    this.deps.sessionManager.checkActiveExpiry(target)
    if (target.state === 'dive') return

    const isActive = target.state === 'active'

    // 跳过缓冲区为空的
    if (target.buffer.length < this.config.minMessagesForReview) {
      // 缓冲不足 → 短间隔重试
      this.nextGroupThoughtTime = now + (isActive ? 60 : 300) * 1000
      return
    }

    // 思考状态机决策
    let spoke = false
    try {
      const decision = await this.thinkingDecision(target, target.buffer)

      if (decision.shouldReply) {
        logger.info(`[${target.channelId}] 思考状态机决定主动发言: ${decision.reason}`)
        const messages = [...target.buffer]
        target.buffer = []
        await this.deps.onDecideReply(target, messages)
        spoke = true
      } else {
        logger.debug(`[${target.channelId}] 思考状态机决定不发: ${decision.reason}`)
      }
    } catch (err) {
      logger.error(`[${target.channelId}] 思考状态机决策失败: ${err}`)
      this.nextGroupThoughtTime = now + 300_000 // 错误后 5 分钟重试
      return
    }

    // 动态决定下次检查时间
    let interval: number
    if (spoke) {
      // 发言成功: 活跃状态 120s, 潜水状态 30~60min 贤者模式
      interval = isActive ? 120 : 1800 + Math.floor(Math.random() * 1800)
    } else if (isActive) {
      // 活跃但没发言: 60s 后再看
      interval = 60
    } else {
      // 潜水观察: 30~60 分钟
      interval = 1800 + Math.floor(Math.random() * 1800)
    }

    this.nextGroupThoughtTime = now + interval * 1000
    logger.debug(`[群聊] 下次检查将在 ${interval} 秒后`)
  }

  /**
   * 私聊扫描 (对齐 v1 _private_scan_loop)
   *
   * 每个私聊有独立的 nextScanTime:
   * - 活跃期 (120s 内互动过): 跳过，60s 后再看
   * - 非活跃: 触发秘书决策
   * - 发言后: 4~8 小时长周期
   */
  private async scanPrivateSessions(): Promise<void> {
    // 夜间静音检查
    if (this.isNightSilence()) return

    const sessions = this.deps.sessionManager.getActiveSessions('private', 20)
    const now = Date.now()

    for (const session of sessions) {
      if (session.state === 'dive') continue
      if (now < session.nextScanTime) continue

      // 检查活跃状态 (120s 内互动过)
      this.deps.sessionManager.checkActiveExpiry(session)
      const isActive = session.state === 'active'

      // 活跃期不主动 Double Text
      if (isActive) {
        session.nextScanTime = now + 60_000
        continue
      }

      if (session.buffer.length === 0) {
        // 无消息，长周期
        session.nextScanTime = now + (14400 + Math.floor(Math.random() * 14400)) * 1000
        continue
      }

      // 触发秘书检查
      logger.info(`[${session.channelId}] 私聊有未回复消息, 触发回复`)

      const messages = [...session.buffer]
      session.buffer = []

      try {
        await this.deps.onDecideReply(session, messages)
      } catch (err) {
        logger.error(`[${session.channelId}] 私聊回复失败: ${err}`)
      }

      // 私聊长周期: 4~8 小时
      const nextInterval = 14400 + Math.floor(Math.random() * 14400)
      session.nextScanTime = now + nextInterval * 1000
      logger.debug(
        `[私聊] ${session.channelId} 下次检查在 ${Math.floor(nextInterval / 3600)} 小时后`,
      )
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
    const modelConfig = await this.deps.getSocialSchedulerModel()
    if (!modelConfig) {
      return { shouldReply: false, reason: '未配置书记员模型' }
    }

    // 构建消息摘要
    const contextLines = messages.map((m) => `[${m.senderName}]: ${m.content.slice(0, 200)}`)
    const context = contextLines.join('\n')

    const identity = (await this.deps.getDecisionIdentity?.(session.agentId)) ?? {
      agentName: session.agentId,
      systemCore: '',
      personaDefinition: '',
      socialPatch: '',
      ownerName: '用户',
      ownerAppellation: '主人',
    }

    // 决策提示词沿用正式回复的身份框架，仅追加“是否发言”的任务约束。
    const systemPart = this.deps.mdpEngine.render(
      'apps/social/decisions/secretary_decision_group',
      {
        agent_name: identity.agentName,
        system_core: identity.systemCore,
        persona_definition: identity.personaDefinition,
        social_patch: identity.socialPatch,
        owner_name: identity.ownerName,
        owner_appellation: identity.ownerAppellation,
        current_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
        target_session_name: session.channelId,
        session_state: session.state.toUpperCase(),
        recent_history: context,
      },
    )
    const rulesPart = this.deps.mdpEngine.render(
      'apps/social/decisions/secretary_decision_group_rules',
      {
        agent_name: identity.agentName,
        owner_name: identity.ownerName,
      },
    )
    const systemPrompt = `${systemPart}\n\n${rulesPart}`

    try {
      // 多模态: 收集缓冲区中最近的图片附件 (最多 2 张)
      const imageUrls: string[] = []
      for (let i = messages.length - 1; i >= 0 && imageUrls.length < 2; i--) {
        const attachments = messages[i]!.attachments ?? []
        for (const att of attachments) {
          if (att.type === 'image' && att.url) {
            imageUrls.push(att.url)
            if (imageUrls.length >= 2) break
          }
        }
      }

      // 构建 user 消息 (支持多模态)
      type ContentPart =
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      const userContent: string | ContentPart[] =
        imageUrls.length > 0
          ? [
              { type: 'text' as const, text: `群聊 ${session.channelId} 最近消息:\n${context}` },
              ...imageUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ]
          : `群聊 ${session.channelId} 最近消息:\n${context}`

      // ── 打印完整 prompt 供调试（对齐桌面模式 reactLoop 的 [Prompt] 标签）──
      // 通过 sseReporter 广播到 Dashboard 终端面板，方便调试社交思考状态机提示词
      logger.info(
        `[Social思考状态机] 调用模型: ${modelConfig.modelId}, channel=${session.channelId}(${session.channelType})`,
      )
      logger.info(`[Social思考状态机] System Prompt:\n${truncate(systemPrompt, 8000)}`)
      // userContent 可能是 string（纯文本）或 ContentPart[]（多模态，含图片）
      const userContentForLog =
        typeof userContent === 'string' ? userContent : JSON.stringify(userContent)
      logger.info(`[Social思考状态机] User: ${truncate(userContentForLog, 4000)}`)

      const completion = await this.deps.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        {},
      )

      const raw = completion.choices[0]?.message?.content
      // 打印 LLM 原始输出（对齐桌面模式 [LLM回复] 标签）
      logger.info(`[Social思考状态机] LLM输出: ${truncate(raw ?? '(空)', 4000)}`)
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

  // ── 辅助方法 ──

  /** 检查当前是否在夜间静音时段 */
  private isNightSilence(): boolean {
    if (!this.config.nightSilenceEnabled) return false
    const hour = new Date().getHours()
    const { nightSilenceStart, nightSilenceEnd } = this.config
    if (nightSilenceStart <= nightSilenceEnd) {
      // 正常范围: 如 0-8
      return hour >= nightSilenceStart && hour < nightSilenceEnd
    }
    // 跨午夜: 如 23-7
    return hour >= nightSilenceStart || hour < nightSilenceEnd
  }
}
