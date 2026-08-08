/**
 * Chat API 模块
 *
 * AIOS 第三阶段：基于 Thread 的对话接口。
 * 非流式聊天走 ApiClient；流式走 streamRequest。
 * 请求体遵循后端 chatRouter：`{ threadId, content, agentId? }`。
 */

import { apiClient } from '../client'
import { streamRequest } from '../stream'
import type { SseEvents } from '../stream'

/** 聊天请求体 — 与后端 Thread chat 接口对齐 */
export interface ChatRequest {
  /** 目标 Thread ID */
  threadId: string
  /** 用户输入内容 */
  content: string
  /** 目标 Agent ID */
  agentId?: string
}

/** 停止请求体 */
export interface StopRequest {
  threadId: string
}

/** 非流式聊天响应 */
export interface ChatSendResponse {
  reply: string
  threadId: string
  agentId?: string
}

export const chatApi = {
  /** 非流式聊天 */
  send: (data: ChatRequest) => apiClient.post<ChatSendResponse>('/chat', data),

  /** 流式聊天 (SSE) */
  stream: (data: ChatRequest, events: SseEvents) => streamRequest('/chat/stream', data, events),

  /** 停止当前生成（需传 threadId 精确取消） */
  stop: (data: StopRequest) => apiClient.post<void>('/chat/stop', data),

  // ── 消息编辑/删除 (路由挂载在 chat router 下，完整路径 /chat/threads/:threadId/messages/:msgId) ──

  /** 编辑消息内容 */
  editMessage: (threadId: string, msgId: string, content: string) =>
    apiClient.patch<void>(`/chat/threads/${threadId}/messages/${msgId}`, { content }),

  /** 删除单条消息 */
  deleteMessage: (threadId: string, msgId: string) =>
    apiClient.delete<void>(`/chat/threads/${threadId}/messages/${msgId}`),

  /** 级联删除整对消息 (用户+助手，通过 pairId 关联) */
  deleteMessagePair: (threadId: string, msgId: string) =>
    apiClient.delete<{ deletedCount: number }>(`/chat/threads/${threadId}/messages/${msgId}/pair`),

  // ── 任务控制 (P2-11) ──

  /** 暂停任务 */
  pauseTask: (threadId: string) => apiClient.post<void>('/chat/tasks/pause', { threadId }),

  /** 恢复任务 */
  resumeTask: (threadId: string) => apiClient.post<void>('/chat/tasks/resume', { threadId }),

  /** 注入指令 */
  injectInstruction: (threadId: string, instruction: string) =>
    apiClient.post<void>('/chat/tasks/inject', { threadId, instruction }),
}
