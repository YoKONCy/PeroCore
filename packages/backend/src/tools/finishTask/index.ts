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

// ─────────────────────────────────────────────
// 运行时注入的依赖 (由 container.ts 设置)
// ─────────────────────────────────────────────

interface PetStateUpdater {
  update(agentId: string, data: PetStateUpdateData): Promise<void>
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

export const finishTaskTool: BuiltinTool = {
  name: 'finish_task',

  async execute(args, ctx) {
    const summary = (args.summary as string) ?? '任务已完成'
    const status = (args.status as string) ?? 'done'

    // ── 角色状态更新 ──
    const mood = args.mood as string | undefined
    const vibe = args.vibe as string | undefined
    const mind = args.mind as string | undefined
    const clickHeadMsgs = parseMessages(args.click_head_msgs)
    const clickChestMsgs = parseMessages(args.click_chest_msgs)
    const clickBodyMsgs = parseMessages(args.click_body_msgs)
    const idleMsgs = parseMessages(args.idle_msgs)
    const backMsgs = parseMessages(args.back_msgs)

    // 构建 click_messages 对象
    const clickMessages: Record<string, string[]> = {}
    if (clickHeadMsgs) clickMessages.head = clickHeadMsgs
    if (clickChestMsgs) clickMessages.chest = clickChestMsgs
    if (clickBodyMsgs) clickMessages.body = clickBodyMsgs

    const hasStateUpdate =
      mood || vibe || mind || Object.keys(clickMessages).length > 0 || idleMsgs || backMsgs

    if (hasStateUpdate && _petStateUpdater) {
      try {
        await _petStateUpdater.update(ctx.agentId, {
          mood,
          vibe,
          mind,
          clickMessages: Object.keys(clickMessages).length > 0 ? clickMessages : undefined,
          idleMessages: idleMsgs,
          backMessages: backMsgs,
        })

        // Gateway 广播 state_update
        if (_gatewayBroadcast) {
          const payload: Record<string, unknown> = {}
          if (mood) payload.mood = mood
          if (vibe) payload.vibe = vibe
          if (mind) payload.mind = mind
          if (Object.keys(clickMessages).length > 0) payload.click_messages = clickMessages
          if (idleMsgs) payload.idle_messages = idleMsgs
          if (backMsgs) payload.back_messages = backMsgs

          await _gatewayBroadcast('state_update', payload).catch(() => {})
        }
      } catch {
        // 状态更新失败不阻断 finish_task
      }
    }

    // finish_task 的实际终止效果由 ReAct Loop 层处理 (检测到此工具调用后停止循环)
    return JSON.stringify({ finished: true, status, summary })
  },
}
