/**
 * Memory API 模块
 *
 * @see 05_FRONTEND_ARCHITECTURE.md §1.2
 */

import { apiClient } from '../client'

/** 记忆 DTO */
export interface MemoryDto {
  id: number
  content: string
  tags: string
  importance: number
  type: string
  source: string
  timestamp: number
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

export const memoryApi = {
  /** 分页列表 */
  list: (params?: { page?: number; pageSize?: number; type?: string }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    if (params?.type) query.set('type', params.type)
    const qs = query.toString()
    return apiClient.get<PaginatedData<MemoryDto>>(`/memories${qs ? `?${qs}` : ''}`)
  },

  /** 创建记忆 */
  create: (data: { content: string; agentId: string; tags?: string }) =>
    apiClient.post<MemoryDto>('/memories', data),

  /** 语义检索 */
  search: (data: { query: string; agentId: string; topK?: number }) =>
    apiClient.post<MemorySearchResult[]>('/memories/search', data),

  /** 删除记忆 */
  remove: (id: number) => apiClient.delete(`/memories/${id}`),
}
