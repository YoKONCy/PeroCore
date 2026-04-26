/**
 * Scheduler API 模块
 *
 * 对齐后端 scheduler.router.ts 端点。
 */

import { apiClient } from '../client'

/** 任务执行统计 */
export interface TaskStats {
  totalRuns: number
  successCount: number
  errorCount: number
  lastError?: string
  lastDurationMs?: number
  averageDurationMs: number
}

/** 任务状态 */
export interface SchedulerTask {
  name: string
  intervalMs: number
  intervalDesc: string
  running: boolean
  lastRunAt: number
  lastRunAtIso: string
  nextRunAt: number
  stats: TaskStats
}

/** 调度器全局状态 */
export interface SchedulerStatus {
  running: boolean
  taskCount: number
  activeTasks: number
}

/** 任务列表响应 */
export interface TaskListData {
  items: SchedulerTask[]
  total: number
}

/** 用户提醒项 (由 Agent 通过 set_reminder 工具创建) */
export interface ReminderItem {
  id: number
  type: 'reminder' | 'topic' | 'reaction'
  time: string
  content: string
  isTriggered: boolean
  agentId: string
  createdAt: string | null
}

/** 提醒列表响应 */
export interface ReminderListData {
  items: ReminderItem[]
  total: number
}

export const schedulerApi = {
  /** 调度器全局状态 */
  status: () => apiClient.get<SchedulerStatus>('/scheduler/status'),

  /** 获取全部定时任务列表 (系统级 cron) */
  tasks: () => apiClient.get<TaskListData>('/scheduler/tasks'),

  /** 获取待触发的用户提醒列表 */
  reminders: (agentId?: string) =>
    apiClient.get<ReminderListData>(
      '/scheduler/reminders' + (agentId ? `?agentId=${agentId}` : ''),
    ),

  /** 手动触发任务 */
  trigger: (name: string) => apiClient.post<{ taskName: string }>('/scheduler/trigger/' + name),
}
