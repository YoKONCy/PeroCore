import { t as __t } from '../../lib/i18n'
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

  async execute(args, ctx) {
    if (!_schedulerService) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const time = args.time as string
    const content = args.content as string
    const type = (args.type as string) ?? 'reminder'
    if (!['reminder', 'topic', 'reaction'].includes(type)) {
      return JSON.stringify({
        error: '提醒工具仅支持提醒、话题和预设反应；跟进请使用 schedule_follow_up',
      })
    }

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
      agentId: ctx.agentId,
      threadId: ctx.threadId,
      sourceExecutionId: ctx.executionId,
      repeatIntervalMinutes:
        typeof args.repeat_interval_minutes === 'number' ? args.repeat_interval_minutes : undefined,
    })

    return JSON.stringify({
      success: true,
      reminder: {
        id: reminder.id,
        type: reminder.type,
        time: reminder.time,
        content: reminder.content,
        status: reminder.status,
        repeatIntervalMinutes: reminder.repeatIntervalMinutes,
      },
      message: __t('server.tools', '已设置{0}: "{1}" → {2}', [
        type === 'reminder' ? '提醒' : type === 'topic' ? '话题' : '反应',
        content,
        time,
      ]),
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
      return JSON.stringify({ items: [], message: __t('server.tools', '当前没有待触发的提醒哦') })
    }

    return JSON.stringify({
      items: reminders.map((r) => ({
        id: r.id,
        type: r.type,
        time: r.time,
        content: r.content,
        status: r.status,
        repeatIntervalMinutes: r.repeatIntervalMinutes,
        threadId: r.threadId,
        lastError: r.lastError,
      })),
      total: reminders.length,
      message: __t('server.tools', '共有 {0} 个待触发的提醒', [reminders.length]),
    })
  },
}

// ── cancel_reminder ──

export const cancelReminderTool: BuiltinTool = {
  name: 'cancel_reminder',

  async execute(args, ctx) {
    if (!_schedulerService) {
      return JSON.stringify({ error: '提醒服务未初始化' })
    }

    const id = args.id as number
    const success = await _schedulerService.cancel(id, ctx.agentId)

    if (!success) {
      return JSON.stringify({ error: `未找到 ID 为 ${id} 的提醒，或已触发` })
    }

    return JSON.stringify({
      success: true,
      message: __t('server.tools', '提醒 #{0} 已取消', [id]),
    })
  },
}

/** 一次性跟进只安排未来检查，不在当前轮等待，也不预先授权未来副作用。 */
export const scheduleFollowUpTool: BuiltinTool = {
  name: 'schedule_follow_up',
  allowedSources: ['desktop'],
  async execute(args, ctx) {
    if (ctx.taskId)
      return JSON.stringify({
        error: '后台任务请通过 finish_task.task_result 的 wait 安排原任务续行',
      })
    if (!_schedulerService) return JSON.stringify({ error: '提醒服务未初始化' })
    const item = await _schedulerService.create({
      type: 'follow_up',
      time: String(args.time ?? ''),
      content: String(args.instruction ?? ''),
      planId: typeof args.planId === 'string' ? args.planId : undefined,
      planStepId: typeof args.planStepId === 'string' ? args.planStepId : undefined,
      reason: String(args.reason ?? ''),
      agentId: ctx.agentId,
      threadId: ctx.threadId,
      sourceExecutionId: ctx.executionId,
    })
    return JSON.stringify({
      success: true,
      item,
      message: __t('server.tools', '已安排一次性跟进，可在任务中心查看和取消'),
    })
  },
}

/** 建议只写入待处理记录；用户在界面采纳后才派发实际任务。 */
export const suggestNextStepTool: BuiltinTool = {
  name: 'suggest_next_step',
  allowedSources: ['desktop'],
  async execute(args, ctx) {
    if (!_schedulerService) return JSON.stringify({ error: '提醒服务未初始化' })
    const item = await _schedulerService.suggest({
      agentId: ctx.agentId,
      threadId: ctx.threadId,
      title: String(args.title ?? ''),
      instruction: String(args.instruction ?? ''),
      reason: String(args.reason ?? ''),
      sourceExecutionId: ctx.executionId,
    })
    return JSON.stringify({
      success: true,
      item,
      message: __t('server.tools', '建议已保存，等待用户采纳或忽略'),
    })
  },
}
