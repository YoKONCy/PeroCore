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

// ── 全局引用: 在 container 接线阶段注入 ──
let schedulerServiceRef: SchedulerService | null = null

/** 注入 SchedulerService 引用 (由 container.ts 调用) */
export function injectSchedulerService(svc: SchedulerService): void {
  schedulerServiceRef = svc
}

// ── set_reminder ──

export const setReminderTool: BuiltinTool = {
  definition: {
    name: 'set_reminder',
    description:
      '为主人设置一个提醒、话题或预设反应。' +
      '当主人说"帮我设个提醒"、"XX点提醒我"、"下次想聊XX"等场景时使用。',
    parameters: {
      type: 'object',
      properties: {
        time: {
          type: 'string',
          description:
            '触发时间，ISO 8601 格式。例如 "2026-04-21T08:00:00"。' +
            '如果主人说"5分钟后"，需要计算具体的 ISO 时间。',
        },
        content: {
          type: 'string',
          description: '提醒内容。例如 "该喝水啦" 或 "提醒主人开会"。',
        },
        type: {
          type: 'string',
          description:
            '类型: "reminder" (一次性提醒，默认) | "topic" (想找主人聊的话题) | "reaction" (预设反应)',
          enum: ['reminder', 'topic', 'reaction'],
        },
      },
      required: ['time', 'content'],
    },
  },

  async execute(args) {
    if (!schedulerServiceRef) {
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

    const reminder = await schedulerServiceRef.create({
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
  definition: {
    name: 'list_reminders',
    description:
      '查看当前所有待触发的提醒、话题和反应。' +
      '当主人问"我设了什么提醒"、"有什么待办"等场景时使用。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, ctx) {
    if (!schedulerServiceRef) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const reminders = await schedulerServiceRef.listPending(ctx.agentId)

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
  definition: {
    name: 'cancel_reminder',
    description:
      '取消一个待触发的提醒。' +
      '当主人说"取消那个提醒"、"不用提醒我了"等场景时使用。' +
      '需要先用 list_reminders 获取 ID。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: '要取消的提醒 ID (从 list_reminders 获取)',
        },
      },
      required: ['id'],
    },
  },

  async execute(args) {
    if (!schedulerServiceRef) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const id = args.id as number
    const success = await schedulerServiceRef.cancel(id)

    if (!success) {
      return JSON.stringify({ error: `未找到 ID 为 ${id} 的提醒，或已触发` })
    }

    return JSON.stringify({
      success: true,
      message: `提醒 #${id} 已取消`,
    })
  },
}
