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

/** 工作区隐式上下文：仅供模型使用，不写入用户消息正文 */
export interface ChatWorkspaceContext {
  filePath?: string
  terminalId?: string
}

export interface RewindPreview {
  threadId: string
  wholeThread: boolean
  targetMessageId?: number
  pairIds: string[]
  pairCount: number
  createdCount: number
  editedCount: number
  files: Array<{
    path: string
    action: 'delete_created' | 'restore_edited' | 'restore_deleted' | 'restore_renamed'
  }>
  forceWarning: boolean
}

export interface RewindResult {
  preview: RewindPreview
  deletedMessageIds: number[]
}

/** 聊天请求体 — 与后端 Thread chat 接口对齐 */
export interface ChatRequest {
  /** 目标 Thread ID */
  threadId: string
  /** 用户输入内容 */
  content: string
  /** 本轮待绑定的附件 ID */
  attachmentIds?: string[]
  /** 图片识别方式。 */
  imageMode?: 'auto' | 'native' | 'relay'
  /** 工作区隐式上下文，不持久化到用户可见正文。 */
  workspaceContext?: ChatWorkspaceContext
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

  /** 预检链式撤回：不产生副作用，返回将删除的轮次和文件回滚清单。 */
  previewRewind: (threadId: string, input: { messageId?: number; wholeThread?: boolean }) =>
    apiClient.post<RewindPreview>(`/chat/threads/${threadId}/rewind-preview`, input),

  /** 执行链式撤回：强制恢复文件并删除目标轮次及后续历史。 */
  rewind: (threadId: string, input: { messageId?: number; wholeThread?: boolean }) =>
    apiClient.post<RewindResult>(`/chat/threads/${threadId}/rewind`, input),

  // ── 任务控制 (P2-11) ──

  /** 暂停任务 */
  pauseTask: (threadId: string) => apiClient.post<void>('/chat/tasks/pause', { threadId }),

  /** 恢复任务 */
  resumeTask: (threadId: string) => apiClient.post<void>('/chat/tasks/resume', { threadId }),

  /** 注入指令 */
  injectInstruction: (threadId: string, instruction: string) =>
    apiClient.post<void>('/chat/tasks/inject', { threadId, instruction }),
}
