/**
 * Chat API 模块
 *
 * 非流式聊天走 ApiClient；流式走 streamRequest。
 */

import { apiClient } from '../client'
import { streamRequest } from '../stream'
import type { SseEvents } from '../stream'

/** 聊天请求体 */
export interface ChatRequest {
  message: string
  source?: string
  agentId?: string
  sessionId?: string
}

export const chatApi = {
  /** 非流式聊天 */
  send: (data: ChatRequest) => apiClient.post<{ reply: string }>('/chat', data),

  /** 流式聊天 (SSE) */
  stream: (data: ChatRequest, events: SseEvents) => streamRequest('/chat/stream', data, events),

  /** 停止当前生成 */
  stop: () => apiClient.post<void>('/chat/stop'),
}
