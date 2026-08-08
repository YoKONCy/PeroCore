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
  /** 头像 URL (/api/agents/:id/avatar) */
  avatarUrl?: string
}

export const agentApi = {
  /** 获取所有 Agent */
  list: () => apiClient.get<AgentListItem[]>('/agents'),

  /** 获取默认 Agent（AIOS: 后端不再有全局活跃概念，返回默认 Agent） */
  getActive: () => apiClient.get<{ agentId: string }>('/agents/active'),

  /** 启用 Agent */
  enable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/enable`),

  /** 禁用 Agent */
  disable: (agentId: string) => apiClient.post<void>(`/agents/${agentId}/disable`),

  /** 重载所有 Agent 配置 */
  reload: () => apiClient.post<void>('/agents/reload'),

  /** 获取 Agent 看板娘台词 (静态 + 动态合并) */
  getTexts: (agentId: string) => apiClient.get<Record<string, unknown>>(`/agents/${agentId}/texts`),

  /** 获取角色实时状态 (mood/vibe/mind + 动态台词，来自 pet_states 表) */
  getPetState: (agentId: string) => apiClient.get<PetStateResponse>(`/agents/${agentId}/pet-state`),
}

/** 角色实时状态响应 (GET /agents/:id/pet-state) */
export interface PetStateResponse {
  agentId: string
  mood: string
  vibe: string
  mind: string
  clickMessages: Record<string, string[]>
  idleMessages: string[]
  backMessages: string[]
  updatedAt: string | null
}
