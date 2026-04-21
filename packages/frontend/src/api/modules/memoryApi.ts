/**
 * Memory API 模块
 *
 * 对齐后端 memory.router.ts + memory.schema.ts 的完整端点。
 *
 */

import { apiClient } from '../client'

/** 记忆 DTO — 与后端 返回结构对齐 */
export interface MemoryDto {
  id: number
  content: string
  tags: string
  importance: number
  type: string
  source: string
  timestamp: number
  /** 情感标记 (对齐 v1) */
  sentiment?: string
}

/** 分页数据 */
export interface PaginatedData<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

/** 检索结果 */
export interface MemorySearchResult {
  id: number
  content: string
  score: number
  tags: string
  importance: number
}

/** 图谱节点 */
export interface MemoryGraphNode {
  id: number
  name: string
  value: number
  category: string
  sentiment: string
  full_content: string
}

/** 图谱连线 */
export interface MemoryGraphEdge {
  source: number
  target: number
  value: number
  relation_type: string
}

/** 图谱数据 */
export interface MemoryGraphData {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
}

/** 列表查询参数 — 对齐后端 listMemorySchema */
export interface ListMemoryParams {
  page?: number
  pageSize?: number
  agentId?: string
  type?: string
  source?: string
  /** 日期筛选 */
  dateStart?: string
}

/** 搜索参数 — 对齐后端 searchMemorySchema */
export interface SearchMemoryParams {
  query: string
  agentId?: string
  source?: string
  topK?: number
  minScore?: number
}

/** 创建参数 — 对齐后端 createMemorySchema */
export interface CreateMemoryParams {
  content: string
  agentId?: string
  tags?: string
  importance?: number
  source?: string
  type?: string
  sentiment?: string
}

export const memoryApi = {
  /** 分页列表 */
  list: (params?: ListMemoryParams) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    if (params?.agentId) query.set('agentId', params.agentId)
    if (params?.type) query.set('type', params.type)
    if (params?.source) query.set('source', params.source)
    if (params?.dateStart) query.set('dateStart', params.dateStart)
    const qs = query.toString()
    return apiClient.get<PaginatedData<MemoryDto>>(`/memories${qs ? `?${qs}` : ''}`)
  },

  /** 创建记忆 */
  create: (data: CreateMemoryParams) => apiClient.post<MemoryDto>('/memories', data),

  /** 语义检索 */
  search: (data: SearchMemoryParams) =>
    apiClient.post<MemorySearchResult[]>('/memories/search', data),

  /** 图谱数据 */
  graph: (agentId = 'pero', limit = 100) =>
    apiClient.get<MemoryGraphData>(`/memories/graph?agentId=${agentId}&limit=${limit}`),

  /** 删除记忆（后端还需 agentId/source query） */
  remove: (id: number, agentId = 'pero', source = 'desktop') =>
    apiClient.delete(`/memories/${id}?agentId=${agentId}&source=${source}`),
}
