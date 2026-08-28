/**
 * Chat API 模块
 *
 * AIOS 第三阶段：基于 Thread 的对话接口。
 * 非流式聊天走 ApiClient；流式走 streamRequest。
 */

import type { ConversationProjectionSnapshot, ConversationSurfaceDescriptor } from '@infos/shared'
import { apiClient } from '../client'
import { streamRequest } from '../stream'
import type { SseEvents } from '../stream'

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
  preservedCount: number
  files: Array<{
    path: string
    action:
      | 'delete_created'
      | 'restore_edited'
      | 'restore_deleted'
      | 'restore_renamed'
      | 'preserve_changed'
  }>
  forceWarning: boolean
}

export interface RewindResult {
  preview: RewindPreview
  workspace: {
    files: RewindPreview['files']
    rolledBackCount: number
    preservedCount: number
  }
  deletedMessageIds: number[]
  projection?: ConversationProjectionSnapshot
}

export interface ChatRequest {
  threadId: string
  content: string
  attachmentIds?: string[]
  imageMode?: 'auto' | 'native' | 'relay'
  workspaceContext?: ChatWorkspaceContext
  agentId?: string
}

export interface StopRequest {
  threadId: string
}

export interface ChatSendResponse {
  executionId?: string
  threadId: string
  messageId: string
  surface: ConversationSurfaceDescriptor
}

export const chatApi = {
  /** 非流式聊天返回与历史、流式提交同构的 committed Surface。 */
  send: (data: ChatRequest) => apiClient.post<ChatSendResponse>('/chat', data),

  /** 流式聊天只传输 Internal Surface Frame 与执行终态。 */
  stream: (data: ChatRequest, events: SseEvents) => streamRequest('/chat/stream', data, events),

  stop: (data: StopRequest) => apiClient.post<void>('/chat/stop', data),

  editMessage: (threadId: string, msgId: string, content: string) =>
    apiClient.patch<ConversationProjectionSnapshot>(`/chat/threads/${threadId}/messages/${msgId}`, {
      content,
    }),

  deleteMessage: (threadId: string, msgId: string) =>
    apiClient.delete<ConversationProjectionSnapshot>(`/chat/threads/${threadId}/messages/${msgId}`),

  deleteMessagePair: (threadId: string, msgId: string) =>
    apiClient.delete<{ deletedCount: number }>(`/chat/threads/${threadId}/messages/${msgId}/pair`),

  previewRewind: (threadId: string, input: { messageId?: number; wholeThread?: boolean }) =>
    apiClient.post<RewindPreview>(`/chat/threads/${threadId}/rewind-preview`, input),

  rewind: (threadId: string, input: { messageId?: number; wholeThread?: boolean }) =>
    apiClient.post<RewindResult>(`/chat/threads/${threadId}/rewind`, input),

  pauseTask: (threadId: string) => apiClient.post<void>('/chat/tasks/pause', { threadId }),

  resumeTask: (threadId: string) => apiClient.post<void>('/chat/tasks/resume', { threadId }),

  injectInstruction: (threadId: string, instruction: string) =>
    apiClient.post<void>('/chat/tasks/inject', { threadId, instruction }),
}
