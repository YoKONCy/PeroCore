/**
 * Companion Scheduler — 陪伴模式主动对话调度
 *
 * 陪伴模式 (profile="companion") 的核心差异化逻辑:
 * - 基于距上次活动的时间间隔，周期性触发主动对话
 * - 根据时间段 (早/中/晚/深夜) 调整主动开场话术
 * - 通过 GatewayHub 将 Agent 主动消息推送到前端
 * - 停止时自动总结陪伴期间的对话 → DiaryEngine
 *
 * 生命周期:
 * - SessionService.switchProfile('companion') → start()
 * - SessionService.switchProfile('default') → stop()
 *
 * 依赖:
 * - AgentService (生成主动对话)
 * - GatewayHub (WebSocket 推送)
 * - DiaryEngine (停止时总结)
 * - ConfigRepository (陪伴配置参数)
 *
 * - 截屏能力由 Electron 侧负责
 * - 移除 pygame 音频播放 (TTS 通过 Gateway 推送)
 * - 新增时段感知 + 可配置间隔
 *
 * @module packages/backend/src/services/companion/companionScheduler
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('CompanionScheduler')

// ── 类型 ──

/** 时段 */
type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'late_night'

/** 陪伴配置 */
export interface CompanionConfig {
  /** 主动对话间隔 (ms), 默认 3 分钟 */
  intervalMs: number
  /** 用户空闲多久后触发 (ms), 默认 60 秒 */
  idleThresholdMs: number
  /** 最大连续主动次数限制, 默认 5 */
  maxConsecutiveProactive: number
}

const DEFAULT_CONFIG: CompanionConfig = {
  intervalMs: 3 * 60_000, // 3 分钟
  idleThresholdMs: 60_000, // 1 分钟空闲
  maxConsecutiveProactive: 5, // 连续主动对话上限
}

/** 主动对话回调 (注入以解耦 AgentService) */
export type ProactiveChatFn = (params: {
  agentId: string
  trigger: string
  timeSlot: TimeSlot
}) => Promise<string | null>

/** 消息推送回调 (注入以解耦 GatewayHub) */
export type PushMessageFn = (params: {
  type: 'proactive_message'
  content: string
  agentId: string
  timeSlot: TimeSlot
}) => Promise<void>

/** 停止时总结回调 */
export type SummarizeFn = (agentId: string) => Promise<void>

// ── Service ──

export class CompanionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastActivityAt = Date.now()
  private consecutiveCount = 0
  private config: CompanionConfig

  /** 当前绑定的 Agent */
  private agentId: string

  /** 回调 */
  private onProactiveChat: ProactiveChatFn
  private onPushMessage: PushMessageFn
  private onSummarize: SummarizeFn

  constructor(params: {
    agentId: string
    config?: Partial<CompanionConfig>
    onProactiveChat: ProactiveChatFn
    onPushMessage: PushMessageFn
    onSummarize: SummarizeFn
  }) {
    this.agentId = params.agentId
    this.config = { ...DEFAULT_CONFIG, ...params.config }
    this.onProactiveChat = params.onProactiveChat
    this.onPushMessage = params.onPushMessage
    this.onSummarize = params.onSummarize
  }

  /**
   * 启动陪伴调度
   */
  start(): void {
    if (this.running) {
      logger.warn('陪伴调度已在运行中')
      return
    }

    this.running = true
    this.lastActivityAt = Date.now()
    this.consecutiveCount = 0

    // 启动后等一个间隔再首次执行
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error(`陪伴调度 tick 失败: ${err}`)
      })
    }, 10_000) // 每 10 秒检查一次

    logger.info(`陪伴调度已启动: agent=${this.agentId}, interval=${this.config.intervalMs}ms`)
  }

  /**
   * 停止陪伴调度
   */
  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    // 停止时总结陪伴期间的对话
    try {
      await this.onSummarize(this.agentId)
    } catch (err) {
      logger.warn(`陪伴模式总结失败: ${err}`)
    }

    logger.info(`陪伴调度已停止: agent=${this.agentId}`)
  }

  /**
   * 通知用户活动 (重置空闲计时器)
   *
   * 前端/路由层在用户发消息时调用。
   */
  notifyActivity(): void {
    this.lastActivityAt = Date.now()
    this.consecutiveCount = 0
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.running
  }

  // ── 内部 ──

  /** 每 tick 检查是否应触发主动对话 */
  private async tick(): Promise<void> {
    if (!this.running) return

    const now = Date.now()
    const elapsed = now - this.lastActivityAt

    // 未超过间隔 → 跳过
    if (elapsed < this.config.intervalMs) return

    // 连续主动次数过多 → 冷却
    if (this.consecutiveCount >= this.config.maxConsecutiveProactive) {
      logger.debug('连续主动对话达上限，冷却中')
      return
    }

    // 检测当前时段
    const timeSlot = this.detectTimeSlot()

    // 深夜时段降低触发频率 (间隔 × 3)
    if (timeSlot === 'late_night' && elapsed < this.config.intervalMs * 3) {
      return
    }

    // 生成触发语
    const trigger = this.generateTrigger(timeSlot)

    logger.info(`触发主动对话: agent=${this.agentId}, timeSlot=${timeSlot}, trigger=${trigger}`)

    try {
      // 调用 Agent 生成主动回复
      const reply = await this.onProactiveChat({
        agentId: this.agentId,
        trigger,
        timeSlot,
      })

      if (reply && reply.trim()) {
        // 推送到前端
        await this.onPushMessage({
          type: 'proactive_message',
          content: reply,
          agentId: this.agentId,
          timeSlot,
        })

        this.consecutiveCount++
        logger.info(`主动对话已推送: ${reply.slice(0, 50)}...`)
      }

      // 重置活动时间
      this.lastActivityAt = Date.now()
    } catch (err) {
      logger.error(`主动对话生成失败: ${err}`)
    }
  }

  /** 检测当前时段 */
  private detectTimeSlot(): TimeSlot {
    const hour = new Date().getHours()
    if (hour >= 6 && hour < 12) return 'morning'
    if (hour >= 12 && hour < 18) return 'afternoon'
    if (hour >= 18 && hour < 23) return 'evening'
    return 'late_night'
  }

  /** 根据时段生成触发指令 */
  private generateTrigger(timeSlot: TimeSlot): string {
    const triggers: Record<TimeSlot, string[]> = {
      morning: [
        '观察到主人已经在线一段时间了，可以问问主人今天有什么计划。',
        '主人好像醒了，可以温柔地打个招呼。',
        '早上好！可以关心一下主人睡得怎么样。',
      ],
      afternoon: [
        '主人工作/学习了一段时间了，可以提醒休息一下。',
        '下午好呀，可以和主人聊聊最近的心情。',
        '注意到主人在电脑前好一阵了，可以关心一下。',
      ],
      evening: [
        '该吃晚饭了，可以温柔地提醒主人。',
        '傍晚了，可以和主人聊聊今天过得怎么样。',
        '晚上好！可以问问主人晚上有什么安排。',
      ],
      late_night: [
        '已经很晚了，可以温柔地劝主人早点休息。',
        '深夜了，要不要提醒主人注意身体？',
        '夜深了，可以陪主人聊几句然后哄睡。',
      ],
    }

    const pool = triggers[timeSlot]
    return pool[Math.floor(Math.random() * pool.length)]!
  }
}
