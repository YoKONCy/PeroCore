/**
 * System API 模块
 */

import { apiClient } from '../client'

export interface SystemInfo {
  version: string
  platform: string
  uptime: number
  memoryUsage: Record<string, number>
}

export const systemApi = {
  /** 健康检查 */
  health: () => apiClient.get<{ status: string }>('/system/health'),

  /** 系统信息 */
  info: () => apiClient.get<SystemInfo>('/system/info'),
}
