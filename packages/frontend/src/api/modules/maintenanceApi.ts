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

/** 主 Agent 全局记忆运行配置。 */
export interface MemoryRuntimeConfig {
  channels: Record<
    'desktop' | 'group',
    {
      contextPairs: number
      retrievalLimit: number
    }
  >
  scorerBatchSize: 4 | 8 | 16
  retrievalMinScore: 0.2 | 0.3 | 0.45
}

export const maintenanceApi = {
  /** 获取经过后端校验的主 Agent 记忆运行配置。 */
  getMemoryConfig: () => apiClient.get<MemoryRuntimeConfig>('/maintenance/memory-config'),

  /** 保存主 Agent 记忆运行配置并立即热更新整理频率。 */
  setMemoryConfig: (config: MemoryRuntimeConfig) =>
    apiClient.put<MemoryRuntimeConfig>('/maintenance/memory-config', config),

  /** 维护系统状态 */
  status: () => apiClient.get<MaintenanceStatus>('/maintenance/status'),

  /** 手动触发维护任务 */
  trigger: (task: string) => apiClient.post<{ taskName: string }>('/maintenance/trigger', { task }),

  /** 触发向量重索引 */
  reindex: (agentId = 'pero') =>
    apiClient.post<{ agentId: string; pendingCount: number }>('/maintenance/reindex', { agentId }),
}
