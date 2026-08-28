/**
 * Config API 模块
 *
 * 对齐后端 config.router.ts KV 配置端点。
 * value 必须为 string（后端 Zod 校验 value: z.string()）。
 */

import { apiClient } from '../client'

export interface ActivateEmbeddingRequest {
  provider: 'api'
  model: string
  dimension: number
  apiBase?: string
  apiKey?: string
  reranker: {
    enabled: boolean
    model?: string
    apiBase?: string
    apiKey?: string
  }
}

export interface ActivateEmbeddingResult {
  model: string
  dimension: number
  durationMs: number
}

export const configApi = {
  /** 真实调用候选Embedding模型，校验成功后由后端原子语义保存并热更新。 */
  activateEmbedding: (data: ActivateEmbeddingRequest) =>
    apiClient.post<ActivateEmbeddingResult>('/configs/embedding/activate', data),

  /** 获取单个配置 */
  get: <T = { key: string; value: string }>(key: string) => apiClient.get<T>(`/configs/${key}`),

  /** 更新配置（value 必须为 string） */
  set: (key: string, value: string) => apiClient.put<void>('/configs', { key, value }),

  /** 删除配置 */
  remove: (key: string) => apiClient.delete(`/configs/${key}`),

  /** 批量获取配置 */
  batch: (keys: string[]) =>
    apiClient.post<Record<string, string | null>>('/configs/batch', { keys }),

  /** 批量设置配置 */
  batchSet: (items: Array<{ key: string; value: string }>) =>
    apiClient.put<{ count: number }>('/configs/batch', { items }),

  /** 导出全部配置 */
  exportAll: () => apiClient.post<Record<string, string>>('/configs/export'),

  /** 导入配置 */
  importAll: (data: Record<string, string>, overwrite = true) =>
    apiClient.post<{ imported: number; skipped: number }>('/configs/import', { data, overwrite }),
}
