/**
 * scheduler — 提醒/日程管理工具
 *
 * 允许 Agent 通过对话为主人设置提醒、话题和预设反应。
 * 的能力。
 *
 * 提供 3 个子操作:
 * - set_reminder: 创建提醒
 * - list_reminders: 查看待触发提醒
 * - cancel_reminder: 取消提醒
 *
 * @module packages/backend/src/tools/scheduler
 */

import type { BuiltinTool } from '../index'
import type { SchedulerService } from '../../services/scheduler/schedulerService'

/** 模块引用 */
let _schedulerService: SchedulerService | null = null

/** 设置 SchedulerService */
export function setSchedulerService(svc: SchedulerService | null): void {
  _schedulerService = svc
}

// ── set_reminder ──

export const setReminderTool: BuiltinTool = {
  name: 'set_reminder',

  async execute(args) {
    if (!_schedulerService) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const time = args.time as string
    const content = args.content as string
    const type = (args.type as string) ?? 'reminder'

    // 校验时间格式
    const parsed = new Date(time)
    if (isNaN(parsed.getTime())) {
      return JSON.stringify({ error: `无效的时间格式: "${time}"，请使用 ISO 8601 格式` })
    }

    // 校验不能是过去的时间
    if (parsed.getTime() < Date.now()) {
      return JSON.stringify({ error: '不能设置过去的时间哦' })
    }

    const reminder = await _schedulerService.create({
      time: parsed.toISOString(),
      content,
      type: type as 'reminder' | 'topic' | 'reaction',
    })

    return JSON.stringify({
      success: true,
      reminder: {
        id: reminder.id,
        type: reminder.type,
        time: reminder.time,
        content: reminder.content,
      },
      message: `已设置${type === 'reminder' ? '提醒' : type === 'topic' ? '话题' : '反应'}: "${content}" → ${time}`,
    })
  },
}

// ── list_reminders ──

export const listRemindersTool: BuiltinTool = {
  name: 'list_reminders',

  async execute(_args, ctx) {
    if (!_schedulerService) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const reminders = await _schedulerService.listPending(ctx.agentId)

    if (reminders.length === 0) {
      return JSON.stringify({ items: [], message: '当前没有待触发的提醒哦' })
    }

    return JSON.stringify({
      items: reminders.map((r) => ({
        id: r.id,
        type: r.type,
        time: r.time,
        content: r.content,
      })),
      total: reminders.length,
      message: `共有 ${reminders.length} 个待触发的提醒`,
    })
  },
}

// ── cancel_reminder ──

export const cancelReminderTool: BuiltinTool = {
  name: 'cancel_reminder',

  async execute(args) {
    if (!_schedulerService) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const id = args.id as number
    const success = await _schedulerService.cancel(id)

    if (!success) {
      return JSON.stringify({ error: `未找到 ID 为 ${id} 的提醒，或已触发` })
    }

    return JSON.stringify({
      success: true,
      message: `提醒 #${id} 已取消`,
    })
  },
}
