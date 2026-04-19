/**
 * useNotificationStore — 全局通知系统
 *
 * 对接 ErrorSeverity 三级映射 (05_FRONTEND_ARCHITECTURE.md §3.2)：
 * - SILENT → 仅记日志
 * - TOAST → 非阻断弹出
 * - MODAL → 阻断对话框
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationSeverity = 'silent' | 'toast' | 'modal'

export interface Notification {
  id: number
  type: NotificationType
  severity: NotificationSeverity
  title?: string
  message: string
  /** 自动关闭延迟 (ms)，0 = 不自动关闭 */
  duration: number
  /** 创建时间 */
  createdAt: number
}

let nextId = 0

export const useNotificationStore = defineStore('notification', () => {
  // ── 状态 ──
  /** Toast 通知队列 */
  const toasts = ref<Notification[]>([])

  /** 模态通知 (一次只显示一个) */
  const modal = ref<Notification | null>(null)

  // ── 动作 ──

  /** 显示 Toast 通知 */
  function toast(message: string, type: NotificationType = 'info', duration = 4000) {
    const notification: Notification = {
      id: nextId++,
      type,
      severity: 'toast',
      message,
      duration,
      createdAt: Date.now(),
    }
    toasts.value.push(notification)

    // 自动移除
    if (duration > 0) {
      setTimeout(() => removeToast(notification.id), duration)
    }
  }

  /** 显示模态通知（阻断） */
  function showModal(message: string, title?: string, type: NotificationType = 'error') {
    modal.value = {
      id: nextId++,
      type,
      severity: 'modal',
      title,
      message,
      duration: 0,
      createdAt: Date.now(),
    }
  }

  /** 关闭模态 */
  function closeModal() {
    modal.value = null
  }

  /** 移除 Toast */
  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** 按错误码自动分级显示 */
  function notifyByCode(code: string, message: string) {
    const severity = ERROR_UI_MAP[code] ?? 'toast'

    if (severity === 'silent') {
      console.warn(`[静默错误] ${code}: ${message}`)
      return
    }

    if (severity === 'modal') {
      showModal(message, `错误: ${code}`, 'error')
      return
    }

    toast(message, 'error')
  }

  return {
    toasts,
    modal,
    toast,
    showModal,
    closeModal,
    removeToast,
    notifyByCode,
  }
})

/** 错误码 → UI 严重性映射 (05§3.2) */
const ERROR_UI_MAP: Record<string, NotificationSeverity> = {
  VALIDATION_ERROR: 'toast',
  LLM_ERROR: 'toast',
  RATE_LIMITED: 'toast',
  UNAUTHORIZED: 'modal',
  DB_ERROR: 'modal',
  INTERNAL_ERROR: 'toast',
  NOT_FOUND: 'toast',
  TOOL_ERROR: 'toast',
}
