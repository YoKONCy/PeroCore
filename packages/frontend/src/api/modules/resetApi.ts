/**
 * Reset API 模块
 *
 * 对齐后端 reset.router.ts 的三个危险重置端点。
 * 所有端点均为物理删除且不可撤销，必须携带对应的确认短语，防止误触。
 *
 * @module packages/frontend/src/api/modules/resetApi
 */

import { apiClient } from '../client'

/** 各操作的确认短语（必须与后端 reset.router.ts 的 CONFIRM_PHRASES 保持一致） */
export const RESET_CONFIRM_PHRASES = {
  'clear-logs': '清空记录',
  memories: '忘掉一切',
  factory: '我们还会再见的',
} as const

/** 危险操作标识（与后端端点一一对应） */
export type ResetOperation = keyof typeof RESET_CONFIRM_PHRASES

/** 重置结果（与后端 ResetResult 对齐） */
export interface ResetResult {
  operation: 'clear_logs' | 'reset_memories' | 'factory_reset'
  /** 实际清空的行数摘要（key 为数据库表名） */
  cleared: Record<string, number>
}

export const resetApi = {
  /** 清空对话记录（确认短语：清空记录） */
  clearLogs: (confirm: string) => apiClient.post<ResetResult>('/reset/clear-logs', { confirm }),

  /** 重置全部记忆（确认短语：忘掉一切） */
  resetMemories: (confirm: string) => apiClient.post<ResetResult>('/reset/memories', { confirm }),

  /** 恢复出厂设置（确认短语：我们还会再见的） */
  factoryReset: (confirm: string) => apiClient.post<ResetResult>('/reset/factory', { confirm }),
}
