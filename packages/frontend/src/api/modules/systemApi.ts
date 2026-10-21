/**
 * System API 模块
 *
 * 对齐后端 system.router.ts 的实际返回结构。
 */

import { apiClient } from '../client'
import { getApiResourceUrl } from '../transport'

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
    triviumNodeCount: number
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

export interface AppBackgroundSettings {
  enabled: boolean
  opacity: number
  blur: number
  brightness: number
  saturation: number
  contrast: number
  overlayOpacity: number
  surfaceOpacity: number
  surfaceBlur: number
  positionX: number
  positionY: number
  fit: 'cover' | 'contain'
}
export type AppBackgroundPresetId = 'preset-1' | 'preset-2' | 'preset-3'

export const systemApi = {
  /** 应用背景沿用原有存储接口，已有图片无需重新上传。 */
  uploadAppBackground: (background: Blob, preset: AppBackgroundPresetId = 'preset-1') => {
    const data = new FormData()
    data.append('background', background, 'chat-background.webp')
    return apiClient.put<{ contentUrl: string }>(`/system/chat-background?preset=${preset}`, data)
  },

  deleteAppBackground: (preset: AppBackgroundPresetId = 'preset-1') =>
    apiClient.delete<void>(`/system/chat-background?preset=${preset}`),

  appBackgroundContentUrl: (version = Date.now(), preset: AppBackgroundPresetId = 'preset-1') =>
    getApiResourceUrl(
      '/system/chat-background/content',
      new URLSearchParams({ preset, v: String(version) }),
    ),

  /** 健康检查 */
  health: (signal?: AbortSignal) => apiClient.request<HealthStatus>('/health', { signal }),

  /** 系统信息（嵌套结构） */
  info: () => apiClient.get<SystemInfo>('/system/info'),

  /** 使用后端统一 o200k_base Tokenizer 计数。 */
  countTokens: (text: string) =>
    apiClient.post<{ tokens: number; tokenizer: string }>('/system/token-count', { text }),

  /** 通过系统打开路径 (P2-13: FileSearchModal 使用) */
  openPath: (path: string) => apiClient.post<void>('/system/open-path', { path }),
}
