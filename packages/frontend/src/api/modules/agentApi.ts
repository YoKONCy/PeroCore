/**
 * Agent API 模块
 *
 */

import { apiClient } from '../client'
import { emit } from '../../utils/ipcAdapter'

/** Agent 列表项 */
export interface AgentListItem {
  id: string
  name: string
  description: string
  isActive: boolean
  isEnabled: boolean
  /** 头像 URL (/api/agents/:id/avatar) */
  avatarUrl?: string
}

export const agentApi = {
  /** 获取所有 Agent */
  list: () => apiClient.get<AgentListItem[]>('/agents'),

  /** 获取当前活跃 Agent */
  getActive: () => apiClient.get<{ agentId: string }>('/agents/active'),

  /** 切换活跃 Agent */
  setActive: async (agentId: string) => {
    const result = await apiClient.put<void>('/agents/active', { agentId })
    await emit('agent_changed', { agentId })
    return result
  },

  /** 启用 Agent */
  enable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/enable`),

  /** 禁用 Agent */
  disable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/disable`),

  /** 重载所有 Agent 配置 */
  reload: () => apiClient.post<void>('/agents/reload'),

  /** 获取 Agent 看板娘台词 (静态 + 动态合并) */
  getTexts: (agentId: string) => apiClient.get<Record<string, unknown>>(`/agents/${agentId}/texts`),
}
