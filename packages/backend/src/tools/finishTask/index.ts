/**
 * finish_task — 任务完成 + 角色状态更新工具
 *
 * 始终允许调用的生命周期工具 (CapabilityGate 白名单豁免)。
 * Agent 通过此工具主动结束当前任务/对话回合，
 * 并可选地更新角色的情绪/动作/文案状态。
 *
 * - finish_task + update_character_status 合并
 * - mood/vibe/mind → pet_states 表
 * - click_messages/idle_messages/back_messages → pet_states JSON 列
 * - Gateway 广播 state_update → 前端看板娘实时同步
 *
 * @module packages/backend/src/tools/finishTask
 */

import type { BuiltinTool } from '../index'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'
import { createLogger } from '../../lib/logger'

const logger = createLogger('FinishTask')

// ─────────────────────────────────────────────
// 运行时注入的依赖 (由 container.ts 设置)
// ─────────────────────────────────────────────

interface PetStateUpdater {
  update(agentId: string, data: PetStateUpdateData): Promise<string | null>
}

interface PetStateUpdateData {
  mood?: string
  vibe?: string
  mind?: string
  clickMessages?: Record<string, string[]>
  idleMessages?: string[]
  backMessages?: string[]
}

/** 模块引用 */
let _petStateUpdater: PetStateUpdater | null = null
let _gatewayBroadcast:
  | ((action: string, payload: Record<string, unknown>) => Promise<void>)
  | null = null

/** 设置 finishTask 依赖 */
export function setFinishTaskDeps(deps: {
  petStateUpdater: PetStateUpdater
  gatewayBroadcast?: (action: string, payload: Record<string, unknown>) => Promise<void>
}) {
  _petStateUpdater = deps.petStateUpdater
  _gatewayBroadcast = deps.gatewayBroadcast ?? null
}

// ─────────────────────────────────────────────
// 辅助：解析消息列表参数
// ─────────────────────────────────────────────

const STANDARD_TOUCH_PARTS = new Set(['head', 'arm', 'body', 'leg'])

/** 将 string | string[] 输入统一转为 string[] */
function parseMessages(input: unknown): string[] | undefined {
  if (!input) return undefined
  if (Array.isArray(input)) return input.map(String)
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // 逗号分隔回退
      return input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return [input]
  }
  return undefined
}

// ─────────────────────────────────────────────
// 工具定义 + 执行
// ─────────────────────────────────────────────

export async function applyCharacterStateUpdate(
  args: Record<string, unknown>,
  agentId: string,
): Promise<{ updated: boolean; textExpiresAt?: string | null }> {
  const mood = args.mood as string | undefined
  const vibe = args.vibe as string | undefined
  const mind = args.mind as string | undefined
  const clickMessages: Record<string, string[]> = {}
  const touchReactions = args.touch_reactions
  if (touchReactions && typeof touchReactions === 'object' && !Array.isArray(touchReactions)) {
    for (const [part, lines] of Object.entries(touchReactions as Record<string, unknown>)) {
      if (!STANDARD_TOUCH_PARTS.has(part)) continue
      const parsed = parseMessages(lines)
      if (parsed?.length) clickMessages[part] = parsed
    }
  }
  for (const [field, part] of [
    ['click_head_msgs', 'head'],
    ['click_arm_msgs', 'arm'],
    ['click_body_msgs', 'body'],
    ['click_leg_msgs', 'leg'],
  ] as const) {
    const parsed = parseMessages(args[field])
    if (parsed?.length)
      clickMessages[part] = [...new Set([...(clickMessages[part] ?? []), ...parsed])]
  }
  const idleMsgs = parseMessages(args.idle_msgs)
  const backMsgs = parseMessages(args.back_msgs)
  const hasStateUpdate = Boolean(
    mood || vibe || mind || Object.keys(clickMessages).length || idleMsgs || backMsgs,
  )
  if (!hasStateUpdate) return { updated: false }
  if (!_petStateUpdater) throw new Error('角色状态服务未初始化')

  const textExpiresAt = await _petStateUpdater.update(agentId, {
    mood,
    vibe,
    mind,
    clickMessages: Object.keys(clickMessages).length ? clickMessages : undefined,
    idleMessages: idleMsgs,
    backMessages: backMsgs,
  })
  const payload: Record<string, unknown> = { agentId }
  if (mood) payload.mood = mood
  if (vibe) payload.vibe = vibe
  if (mind) payload.mind = mind
  if (Object.keys(clickMessages).length) payload.click_messages = clickMessages
  if (idleMsgs) payload.idle_messages = idleMsgs
  if (backMsgs) payload.back_messages = backMsgs
  if (textExpiresAt) payload.text_expires_at = textExpiresAt
  if (_gatewayBroadcast) await _gatewayBroadcast('state_update', payload)
  logger.info(`角色状态已更新: agent=${agentId}`)
  return { updated: true, textExpiresAt }
}

export const finishTaskTool: BuiltinTool = {
  name: 'finish_task',

  async execute(args, ctx) {
    // reply 是「完成任务后交给用户的最终回复正文」，必填。
    // 缺失时返回失败并提示模型补全，ReAct 会把它作为工具错误反馈给模型重试。
    const reply = typeof args.reply === 'string' ? args.reply.trim() : ''
    if (!reply) {
      logger.warn(`finish_task 缺少必填参数 reply (agent=${ctx.agentId})`)
      return toolFailure(
        'FINISH_TASK_NO_REPLY',
        'finish_task 必须携带 reply 参数：即完成任务后要交给用户的最终回复正文。' +
          '请把回复内容完整写入 reply 后重新调用，不要留空。',
      )
    }

    const summary = (args.summary as string) ?? reply
    const status = (args.status as string) ?? 'done'

    // 状态更新失败不阻断任务终止，但复用update_state的同一持久化与广播路径。
    try {
      await applyCharacterStateUpdate(args, ctx.agentId)
    } catch (err) {
      logger.error(`角色状态更新失败: ${err instanceof Error ? err.stack || err.message : err}`)
    }

    // finish_task 的实际终止效果由 ReAct Loop 层处理 (检测到此工具调用后停止循环)
    // reply 为交付给用户的最终回复，随结果一起返回供日志/调试追踪。
    return toolSuccess(JSON.stringify({ finished: true, status, summary, reply }))
  },
}
