/**
 * Threads API 模块
 *
 * 对齐后端 AIOS 第三阶段 Thread + ContextCompiler 架构。
 * 替代旧 sessionsApi，路由前缀 `/chat/threads`（apiClient 自动加 /api）。
 *
 * 注意：threads 路由挂载在 chat router 下，完整路径为 /api/chat/threads。
 * 早期版本误用 /threads 前缀导致 404，已修正。
 */

import { apiClient } from '../client'

/** Thread 频道类型 */
export type ThreadChannel = 'desktop' | 'companion'

/** Thread 摘要信息 */
export interface ThreadInfo {
  id: string
  agentId: string
  channel: ThreadChannel
  platform?: string
  platformIdentifier?: string
  title: string
  /** 消息总数（含已删除的对话对计数） */
  messageCount: number
  /** 对话对数量 */
  pairCount: number
  /** 最后一条消息时间（ISO 字符串），无消息时为 null */
  lastMessageAt: string | null
  /** Thread 状态：active / archived 等 */
  status: string
  /**
   * ContextPolicy（JSON 序列化的 ChannelPolicy 字符串）
   * null 表示使用 DEFAULT_POLICIES 中该 channel 的默认策略
   */
  contextPolicy: string | null
  createdAt: string
  updatedAt: string
}

/** Thread 内单条消息 */
export interface ThreadMessageInfo {
  /** 消息 ID（数据库自增整数，后端返回 number） */
  id: number
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** Agent 回复的原始内容（含 Thinking/Monologue/NIT 等调试块），仅 assistant 角色可能有值 */
  rawContent?: string | null
  /** 配对 ID (user + assistant 配对) */
  pairId: string | null
  /** 发送者 ID（用户消息可能有，assistant 消息为 null） */
  senderId: string | null
  /** Agent ID（仅 assistant 消息有值） */
  agentId: string | null
  /** 消息状态 */
  status: string
  /** 修订版本号 */
  revision: number
  /** 元数据 JSON 字符串 */
  metadataJson: string
  /** 消息时间戳（ISO 字符串，后端字段名为 timestamp） */
  timestamp: string
}

/** Thread 列表分页数据 */
export interface ThreadListData {
  items: ThreadInfo[]
  total: number
  page: number
  pageSize: number
}

/** Thread 详情数据 */
export interface ThreadDetailData {
  thread: ThreadInfo
  messages: ThreadMessageInfo[]
  total: number
}

/** 创建 Thread 请求体 */
export interface CreateThreadRequest {
  agentId?: string
  channel?: ThreadChannel
  platform?: string
  platformIdentifier?: string
  title?: string
}

/** 获取最新 Thread 请求体 */
export interface GetLatestThreadRequest {
  agentId?: string
  channel?: string
}

export const threadsApi = {
  /** 分页获取 Thread 列表 */
  list: (params?: {
    agentId?: string
    channel?: string
    page?: number
    pageSize?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.agentId) query.set('agentId', params.agentId)
    if (params?.channel) query.set('channel', params.channel)
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    const qs = query.toString()
    return apiClient.get<ThreadListData>(`/chat/threads${qs ? `?${qs}` : ''}`)
  },

  /** 获取 Thread 详情（含消息列表） */
  get: (threadId: string, params?: { page?: number; pageSize?: number }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    const qs = query.toString()
    return apiClient.get<ThreadDetailData>(`/chat/threads/${threadId}${qs ? `?${qs}` : ''}`)
  },

  /** 创建新 Thread */
  create: (data: CreateThreadRequest) =>
    apiClient.post<{ thread: ThreadInfo }>('/chat/threads', data),

  /** 获取指定 Agent/Channel 的最新 Thread */
  getLatest: (data: GetLatestThreadRequest) =>
    apiClient.post<{ thread: ThreadInfo }>('/chat/threads/latest', data),
}
