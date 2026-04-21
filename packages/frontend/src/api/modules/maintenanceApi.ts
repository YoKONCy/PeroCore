/**
 * Maintenance API 模块
 *
 * 对齐后端 maintenance.router.ts 端点。
 */

import { apiClient } from '../client'
import type { TaskStats } from './schedulerApi'

/** 维护系统状态 */
export interface MaintenanceStatus {
  schedulerRunning: boolean
  tasks: Array<{
    name: string
    running: boolean
    lastRunAt: string
    intervalDesc: string
    stats: TaskStats
  }>
  memory: {
    totalMemories: number
    pendingSyncCount: number
  }
}

export const maintenanceApi = {
  /** 维护系统状态 */
  status: () => apiClient.get<MaintenanceStatus>('/maintenance/status'),

  /** 手动触发维护任务 */
  trigger: (task: string) => apiClient.post<{ taskName: string }>('/maintenance/trigger', { task }),

  /** 触发向量重索引 */
  reindex: (agentId = 'pero') =>
    apiClient.post<{ agentId: string; pendingCount: number }>('/maintenance/reindex', { agentId }),
}
