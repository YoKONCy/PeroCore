/**
 * MCP API 模块
 *
 * 对齐后端 mcp.router.ts 的 REST 端点。
 * 管理 MCP (Model Context Protocol) 服务器配置、连接状态和工具查询。
 *
 * @module packages/frontend/src/api/modules/mcpApi
 */

import { apiClient } from '../client'

// ── 类型 (对齐后端 mcp.repo.ts + mcpClientManager.ts) ──

/** MCP 配置 — DB 行 */
export interface McpConfigItem {
  id: number
  name: string
  type: string | null
  command: string | null
  args: string[]
  env: Record<string, string>
  url: string | null
  enabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

/** 创建 MCP 配置的输入 */
export interface CreateMcpConfigInput {
  name: string
  type?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
}

/** 更新 MCP 配置的输入 */
export interface UpdateMcpConfigInput {
  name?: string
  type?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
}

/** 连接状态（单个 MCP Server） */
export interface McpConnectionStatus {
  name: string
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  error?: string
}

/** MCP Manager 全局状态 */
export interface McpManagerStatus {
  totalServers: number
  connectedServers: number
  totalTools: number
  connections: McpConnectionStatus[]
}

/** MCP 工具信息 */
export interface McpToolItem {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  serverName: string
}

/** Skill 清单 (对齐后端 SkillManifest) */
export interface SkillManifestItem {
  id: string
  name: string
  description: string
  requiredTools: string[]
  category: string
  tags: string[]
  parameters: Record<string, string>
  dependsOnSkills: string[]
}

/** Skill 内容 (L2 详情) */
export interface SkillContentResult {
  id: string
  content: string
}

export const mcpApi = {
  // ── 配置 CRUD ──

  /** 获取所有 MCP 配置 */
  getConfigs: () => apiClient.get<McpConfigItem[]>('/mcp/configs'),

  /** 创建 MCP 配置 */
  createConfig: (input: CreateMcpConfigInput) =>
    apiClient.post<McpConfigItem>('/mcp/configs', input),

  /** 更新 MCP 配置 */
  updateConfig: (id: number, input: UpdateMcpConfigInput) =>
    apiClient.put<McpConfigItem>(`/mcp/configs/${id}`, input),

  /** 删除 MCP 配置 */
  deleteConfig: (id: number) => apiClient.delete(`/mcp/configs/${id}`),

  /** 切换启用状态 */
  toggleEnabled: (id: number) => apiClient.post<McpConfigItem>(`/mcp/configs/${id}/toggle`),

  // ── 连接管理 ──

  /** 连接所有已启用的 MCP 服务器 */
  connectAll: () => apiClient.post<McpManagerStatus>('/mcp/connect'),

  /** 重新连接单个 MCP 服务器 */
  reconnect: (name: string) => apiClient.post<McpConnectionStatus>(`/mcp/${name}/reconnect`),

  // ── 状态查询 ──

  /** 获取所有连接状态 */
  getStatus: () => apiClient.get<McpManagerStatus>('/mcp/status'),

  /** 获取所有已发现的 MCP 工具 */
  getTools: () => apiClient.get<McpToolItem[]>('/mcp/tools'),

  // ── Skill 管理 ──

  /** 获取所有已加载的 Skill 清单 */
  getSkills: () => apiClient.get<SkillManifestItem[]>('/mcp/skills'),

  /** 获取 Skill 的完整内容 (L2) */
  getSkillContent: (id: string) => apiClient.get<SkillContentResult>(`/mcp/skills/${id}/content`),

  /** 重新扫描所有 Skill 目录 */
  reloadSkills: () => apiClient.post<SkillManifestItem[]>('/mcp/skills/reload'),

  /** 导入本地 Skill 文件夹 */
  importSkill: (sourcePath: string) =>
    apiClient.post<SkillManifestItem[]>('/mcp/skills/import', { sourcePath }),

  /** 删除用户 Skill */
  deleteSkill: (id: string) => apiClient.delete(`/mcp/skills/${id}`),
}
