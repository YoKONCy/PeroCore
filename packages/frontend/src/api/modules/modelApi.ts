/**
 * Model API 模块
 *
 * @see 05_FRONTEND_ARCHITECTURE.md §1.2
 */

import { apiClient } from '../client'

/** 模型配置项 */
export interface ModelConfigItem {
  id: string
  name: string
  provider: string
  modelId: string
  apiKey: string
  apiBase?: string
  isDefault?: boolean
}

export const modelApi = {
  /** 获取所有模型配置 */
  list: () => apiClient.get<ModelConfigItem[]>('/models'),

  /** 获取单个模型配置 */
  getById: (id: string) => apiClient.get<ModelConfigItem>(`/models/${id}`),

  /** 创建模型配置 */
  create: (data: Omit<ModelConfigItem, 'id'>) => apiClient.post<ModelConfigItem>('/models', data),

  /** 更新模型配置 */
  update: (id: string, data: Partial<ModelConfigItem>) =>
    apiClient.put<ModelConfigItem>(`/models/${id}`, data),

  /** 删除模型配置 */
  remove: (id: string) => apiClient.delete(`/models/${id}`),

  /** 测试模型连通性 */
  test: (id: string) => apiClient.post<{ latencyMs: number }>(`/models/${id}/test`),
}
