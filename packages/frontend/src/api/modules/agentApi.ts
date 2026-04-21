/**
 * Agent API 模块
 *
 */

import { apiClient } from '../client'

/** Agent 列表项 */
export interface AgentListItem {
  id: string
  name: string
  description: string
  isActive: boolean
  isEnabled: boolean
}

export const agentApi = {
  /** 获取所有 Agent */
  list: () => apiClient.get<AgentListItem[]>('/agents'),

  /** 获取当前活跃 Agent */
  getActive: () => apiClient.get<{ agentId: string }>('/agents/active'),

  /** 切换活跃 Agent */
  setActive: (agentId: string) => apiClient.put<void>('/agents/active', { agentId }),

  /** 启用 Agent */
  enable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/enable`),

  /** 禁用 Agent */
  disable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/disable`),

  /** 重载所有 Agent 配置 */
  reload: () => apiClient.post<void>('/agents/reload'),
}
