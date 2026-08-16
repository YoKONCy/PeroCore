/**
 * BackgroundTasks API 模块（M05 §5）
 *
 * 对齐后端 backgroundTask.router.ts 端点。
 * 统一任务中心前端数据访问层：
 * - 派发 / 分页查询 / 详情 / 暂停 / 恢复 / 取消 / 删除
 * - 各 Agent 活跃任务数（聊天徽章与任务中心概览共用）
 *
 * @module packages/frontend/src/api/modules/backgroundTasksApi
 */

import { apiClient } from '../client'

/** 任务状态机（与后端一致） */
export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 后台任务信息（对齐后端 BackgroundTaskInfo） */
export interface BackgroundTaskInfo {
  id: string
  agentId: string
  threadId: string
  targetThreadId: string | null
  title: string
  instruction: string
  status: BackgroundTaskStatus
  progress: number | null
  currentStage: string | null
  result: string | null
  errorMessage: string | null
  toolCallCount: number
  priority: number
  requestedBy: string
  completionAction: string
  category: 'agent_task' | 'resident'
  inputQuestion: string | null
  inputContext: Record<string, unknown> | null
  checkpoint: {
    messages: Array<{ role: string; content: unknown; toolCalls?: unknown[]; toolCallId?: string }>
    toolCalls: Array<{
      name: string
      args: Record<string, unknown>
      result: string
      durationMs: number
      isError: boolean
      callId: string
    }>
    turn: number
  } | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  /** 历史记录已读时间；null 表示未读。 */
  readAt: string | null
  updatedAt: string
}

/** 派发任务请求 */
export interface DispatchTaskRequest {
  agentId: string
  instruction: string
  title?: string
  targetThreadId?: string
  priority?: number
  completionAction?: 'notify' | 'open_result' | 'send_to_chat'
}

/** 分页查询参数 */
export interface BackgroundTaskQueryParams {
  agentId?: string
  status?: BackgroundTaskStatus
  keyword?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

/** 分页结果 */
export interface BackgroundTaskPage {
  items: BackgroundTaskInfo[]
  total: number
  page: number
  pageSize: number
}

/** 各 Agent 活跃任务计数 */
export interface AgentActiveCount {
  agentId: string
  count: number
}

export const backgroundTasksApi = {
  /** 派发后台任务 */
  dispatch: (data: DispatchTaskRequest) =>
    apiClient.post<BackgroundTaskInfo>('/background-tasks', data),

  /** 分页查询任务 */
  list: (params: BackgroundTaskQueryParams = {}) => {
    const query = new URLSearchParams()
    if (params.agentId) query.set('agentId', params.agentId)
    if (params.status) query.set('status', params.status)
    if (params.keyword) query.set('keyword', params.keyword)
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.page) query.set('page', String(params.page))
    if (params.pageSize) query.set('pageSize', String(params.pageSize))
    const qs = query.toString()
    return apiClient.get<BackgroundTaskPage>(`/background-tasks${qs ? `?${qs}` : ''}`)
  },

  /** 各 Agent 活跃任务数（任务中心概览 + 聊天徽章） */
  activeCount: () => apiClient.get<AgentActiveCount[]>('/background-tasks/active-count'),

  /** 任务详情 */
  detail: (id: string) => apiClient.get<BackgroundTaskInfo>(`/background-tasks/${id}`),

  /** 暂停（仅排队中有效） */
  pause: (id: string) => apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/pause`),

  /** 恢复（paused → queued，重进执行链） */
  resume: (id: string) => apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/resume`),

  /** 恢复因服务重启中断的任务（M05-篇3-1） */
  resumeInterrupted: (id: string) =>
    apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/resume-interrupted`, {}),

  input: (
    id: string,
    data: {
      decision: 'allow_once' | 'allow_session' | 'deny_once'
      message?: string
    },
  ) => apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/input`, data),

  retry: (id: string) => apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/retry`),

  /** 取消（运行中发中断信号，排队/暂停直接迁移） */
  cancel: (id: string) => apiClient.post<BackgroundTaskInfo>(`/background-tasks/${id}/cancel`),

  /** 标记单条历史记录已读 */
  markRead: (id: string) => apiClient.post<void>(`/background-tasks/${id}/read`),

  /** 一键标记所有历史记录已读 */
  markAllRead: () => apiClient.post<{ count: number }>('/background-tasks/mark-all-read'),

  /** 删除记录（运行中拒绝） */
  delete: (id: string) => apiClient.delete<void>(`/background-tasks/${id}`),
}
