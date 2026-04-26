/**
 * System API 模块
 *
 * 对齐后端 system.router.ts 的实际返回结构。
 */

import { apiClient } from '../client'

/** 系统信息 — 与后端 system.router.ts GET /info 完全对齐 */
export interface SystemInfo {
  version: string
  runtime: {
    node: string
    platform: string
    arch: string
    pid: number
    uptime: number
    memoryUsage: {
      rss: number
      heapUsed: number
    }
    cpuPercent: number
    totalMemoryMB: number
  }
  storage: {
    sqliteSizeMB: number
    triviumSizeMB: number
  }
  agents: {
    total: number
    enabled: number
    activeId: string | null
  }
  gateway: {
    connectedNodes: number
  }
}

/** /api/system/health 返回 */
export interface HealthStatus {
  status: string
  uptime: number
  timestamp: string
}

export const systemApi = {
  /** 健康检查 */
  health: () => apiClient.get<HealthStatus>('/health'),

  /** 系统信息（嵌套结构） */
  info: () => apiClient.get<SystemInfo>('/system/info'),

  /** 通过系统打开路径 (P2-13: FileSearchModal 使用) */
  openPath: (path: string) => apiClient.post<void>('/system/open-path', { path }),
}
