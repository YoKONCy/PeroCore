/**
 * Chat Sessions API 模块
 *
 * 对齐后端 chat.router.ts 中新增的 sessions 查询端点。
 * 前端 LogsTab 消费。
 */

import { apiClient } from '../client'

/** 会话摘要 */
export interface SessionSummary {
  sessionId: string
  agentId: string
  source: string
  messageCount: number
  firstMessageAt: string
  lastMessageAt: string
  preview: string
}

/** 会话列表分页 */
export interface SessionListData {
  items: SessionSummary[]
  total: number
  page: number
  pageSize: number
}

/** 会话消息 */
export interface SessionMessage {
  id: number
  role: string
  content: string
  /** 原始 LLM 输出 (含 Thinking/Monologue 块, 调试用) */
  rawContent: string | null
  timestamp: string | null
  pairId: string | null
}

/** 会话详情 */
export interface SessionDetailData {
  sessionId: string
  agentId: string
  messages: SessionMessage[]
  total: number
}

export const sessionsApi = {
  /** 分页会话列表 */
  list: (params?: { agentId?: string; page?: number; pageSize?: number; source?: string }) => {
    const query = new URLSearchParams()
    if (params?.agentId) query.set('agentId', params.agentId)
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    if (params?.source) query.set('source', params.source)
    const qs = query.toString()
    return apiClient.get<SessionListData>(`/chat/sessions${qs ? `?${qs}` : ''}`)
  },

  /** 获取某会话的消息列表 */
  detail: (sessionId: string, params?: { agentId?: string; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.agentId) query.set('agentId', params.agentId)
    if (params?.limit) query.set('limit', String(params.limit))
    const qs = query.toString()
    return apiClient.get<SessionDetailData>(`/chat/sessions/${sessionId}${qs ? `?${qs}` : ''}`)
  },
}
