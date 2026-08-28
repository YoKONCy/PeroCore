/**
 * Model API 模块
 *
 */

import { apiClient } from '../client'

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 模型配置项 */
export interface ModelConfigItem {
  id: string
  name: string
  provider: string
  modelId: string
  apiKey: string
  apiBase?: string
  temperature: number | null
  topP: number | null
  maxTokens: number | null
  contextWindowTokens: number | null
  reasoningEffort: ReasoningEffort | null
  returnNativeReasoning: boolean
  wireApi: 'chat_completions' | 'responses'
  reasoningDialect: 'auto' | 'openai' | 'deepseek' | 'openrouter' | 'generic'
  stream: boolean
  providerType?: string
  enableVision?: boolean
  /** 声明模型支持原生音频输入（非 ASR） */
  enableAudioInput?: boolean
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

  /** 获取远程模型列表 */
  listRemote: (params: { provider: string; apiKey: string; apiBase?: string }) =>
    apiClient.post<string[]>('/models/list-remote', params),
}
