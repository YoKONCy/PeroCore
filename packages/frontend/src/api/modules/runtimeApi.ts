/**
 * Runtime API 模块
 *
 * 对齐后端 runtime.router.ts 端点。
 * 窗口级 Agent 状态管理：每个前端窗口通过 windowId 与 agentId 绑定，
 * 后端维护映射用于广播、Cron 通知等场景。
 *
 * 第七阶段修复（批次 C）：新建此模块，替代已删除的 agentApi.setActive。
 * 前端切换 Agent 时应调用 setWindowAgent 而非全局 setActive。
 */

import { apiClient } from '../client'

/** 窗口 Agent 映射项 */
export interface WindowAgentMapping {
  windowId: string
  agentId: string
  /** 最后活跃时间（ISO 字符串） */
  lastActiveAt?: string
}

/** 活跃任务项（后端 /api/runtime/tasks 返回） */
export interface RuntimeTask {
  taskId: string
  agentId: string
  type: string
  status: 'running' | 'pending' | 'completed' | 'failed'
  startedAt?: string
  progress?: number
}

export const runtimeApi = {
  /**
   * 注册/更新窗口 Agent 映射
   *
   * 前端窗口启动时调用，将 windowId 与 agentId 绑定。
   * 切换 Agent 时也调用此接口更新映射。
   */
  setWindowAgent: (windowId: string, agentId: string) =>
    apiClient.post<void>('/runtime/window-agent', { windowId, agentId }),

  /** 查询指定窗口的 Agent 映射 */
  getWindowAgent: (windowId: string) =>
    apiClient.get<WindowAgentMapping>(`/runtime/window-agent/${windowId}`),

  /** 窗口关闭时注销 Agent 映射 */
  clearWindowAgent: (windowId: string) =>
    apiClient.delete<void>(`/runtime/window-agent/${windowId}`),

  /** 列出所有窗口 Agent 映射 */
  getAllWindowAgents: () =>
    apiClient.get<WindowAgentMapping[]>('/runtime/window-agent'),

  /** 获取活跃任务列表 */
  getActiveTasks: () => apiClient.get<RuntimeTask[]>('/runtime/tasks'),
}
