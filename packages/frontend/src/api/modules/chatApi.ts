/**
 * Chat API 模块
 *
 * 非流式聊天走 ApiClient；流式走 streamRequest。
 * 请求体遵循后端 chatRequestSchema：messages 数组格式。
 *
 */

import { apiClient } from '../client'
import { streamRequest } from '../stream'
import type { SseEvents } from '../stream'

/** 单条消息 */
export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

/** 聊天请求体 — 与后端 chatRequestSchema 对齐 */
export interface ChatRequest {
  /** 消息数组（至少一条） */
  messages: ChatMessagePayload[]
  /** 消息来源 */
  source?: string
  /** 目标 Agent */
  agentId?: string
  /** 会话 ID */
  sessionId?: string
  /** 是否语音模式 */
  isVoiceMode?: boolean
  /** 额外模板变量 */
  extraVars?: Record<string, string>
}

/** 停止请求体 */
export interface StopRequest {
  sessionId?: string
}

export const chatApi = {
  /** 非流式聊天 */
  send: (data: ChatRequest) => apiClient.post<{ reply: string }>('/chat', data),

  /** 流式聊天 (SSE) */
  stream: (data: ChatRequest, events: SseEvents) => streamRequest('/chat/stream', data, events),

  /** 停止当前生成（需传 sessionId 精确取消） */
  stop: (data?: StopRequest) => apiClient.post<void>('/chat/stop', data ?? {}),

  /** 清空会话 */
  clearSession: (agentId: string) =>
    apiClient.post<{ sessionId: string }>('/chat/session/clear', { agentId }),

  /** 切换 Profile */
  switchProfile: (agentId: string, profile: string) =>
    apiClient.post<{ profile: string; sessionId: string }>('/chat/session/profile', {
      agentId,
      profile,
    }),

  // ── 消息编辑/删除 (P2-7) ──

  /** 编辑消息内容 */
  editMessage: (id: number, content: string) =>
    apiClient.patch<void>(`/chat/messages/${id}`, { content }),

  /** 删除单条消息 */
  deleteMessage: (id: number) => apiClient.delete(`/chat/messages/${id}`),

  // ── 任务控制 (P2-11) ──

  /** 暂停任务 */
  pauseTask: (sessionId: string) => apiClient.post<void>('/chat/task/pause', { sessionId }),

  /** 恢复任务 */
  resumeTask: (sessionId: string) => apiClient.post<void>('/chat/task/resume', { sessionId }),

  /** 注入指令 */
  injectInstruction: (sessionId: string, instruction: string) =>
    apiClient.post<void>('/chat/task/inject', { sessionId, instruction }),

  // ── 数据重置 (P2-12) ──

  /** 分级重置 */
  reset: (action: string, agentId = 'pero') =>
    apiClient.post<void>('/chat/reset', { action, agentId }),
}
