/**
 * Config API 模块
 */

import { apiClient } from '../client'

export const configApi = {
  /** 获取单个配置 */
  get: <T = unknown>(key: string) => apiClient.get<T>(`/config/${key}`),

  /** 更新配置 */
  set: (key: string, value: unknown) => apiClient.put<void>('/config', { key, value }),

  /** 批量获取配置 */
  batch: (keys: string[]) => apiClient.post<Record<string, unknown>>('/config/batch', { keys }),
}
