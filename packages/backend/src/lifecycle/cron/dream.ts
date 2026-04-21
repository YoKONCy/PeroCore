/**
 * dream — 梦境模式定时检查
 *
 * `periodic_dream_check`:
 * - 22:00 后检查是否触发梦境模式
 * - 梦境模式通过 DreamAssociator 建立记忆间的潜意识关联
 * - 触发后通过 Gateway 广播梦境状态 (前端显示梦境动画)
 *
 * 周期: 每 15 分钟
 *
 * @see lifecycle/cron
 * @module packages/backend/src/lifecycle/cron/dream
 */

import type { GatewayHub } from '../../services/gateway/gatewayHub'
import { createLogger } from '../../lib/logger'

const logger = createLogger('CronDream')

/** 梦境触发时间范围: 22:00 ~ 06:00 */
const DREAM_START_HOUR = 22
const DREAM_END_HOUR = 6

/** 梦境冷却时间 (防止重复触发) */
let lastDreamTrigger = 0
const DREAM_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 小时

export interface DreamCheckDeps {
  gatewayHub: GatewayHub
  /** 执行梦境关联的回调 (由 ReflectionOrchestrator.DreamAssociator 提供) */
  runDreamAssociation?: (agentId: string) => Promise<number>
  /** 当前活跃 Agent ID */
  activeAgentId: string
}

/**
 * 检查是否应该触发梦境模式
 */
export async function runDreamCheck(deps: DreamCheckDeps): Promise<DreamCheckResult> {
  const now = new Date()
  const hour = now.getHours()

  // 检查是否在梦境时间窗口
  const isDreamWindow = hour >= DREAM_START_HOUR || hour < DREAM_END_HOUR
  if (!isDreamWindow) {
    return { triggered: false, reason: '未在梦境时间窗口' }
  }

  // 冷却检查
  if (Date.now() - lastDreamTrigger < DREAM_COOLDOWN_MS) {
    return { triggered: false, reason: '梦境冷却中' }
  }

  // 3% 概率触发
  const roll = Math.random()
  if (roll > 0.03) {
    return { triggered: false, reason: `概率未命中 (${(roll * 100).toFixed(1)}%)` }
  }

  logger.info('✨ 梦境模式触发!')
  lastDreamTrigger = Date.now()

  // 广播梦境事件 (前端显示梦境动画)
  await deps.gatewayHub.pushNotification({
    title: '梦境模式',
    body: '正在进入梦境，编织记忆的彩线...',
  })

  // 执行梦境关联
  let associatedCount = 0
  if (deps.runDreamAssociation) {
    try {
      associatedCount = await deps.runDreamAssociation(deps.activeAgentId)
      logger.info(`梦境关联完成: 建立 ${associatedCount} 条新关联`)
    } catch (err) {
      logger.error(`梦境关联失败: ${err}`)
    }
  }

  return { triggered: true, associatedCount }
}

/** 梦境检查结果 */
export interface DreamCheckResult {
  triggered: boolean
  reason?: string
  associatedCount?: number
}
