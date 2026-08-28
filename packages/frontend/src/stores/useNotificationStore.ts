/**
 * useNotificationStore — 全局通知系统
 *
 * 对接 ErrorSeverity 三级映射：
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

/** Toast 通知选项 */
export interface ToastOptions {
  type?: NotificationType
  title?: string
  duration?: number
}

export const useNotificationStore = defineStore('notification', () => {
  // ── 状态 ──
  /** Toast 通知队列 */
  const toasts = ref<Notification[]>([])

  /** 模态通知 (一次只显示一个) */
  const modal = ref<Notification | null>(null)

  // ── 动作 ──

  /** 显示 Toast 通知 */
  function toast(
    message: string,
    typeOrOpts: NotificationType | ToastOptions = 'info',
    duration = 4000,
  ) {
    const opts: ToastOptions =
      typeof typeOrOpts === 'string' ? { type: typeOrOpts, duration } : typeOrOpts

    const notification: Notification = {
      id: nextId++,
      type: opts.type ?? 'info',
      severity: 'toast',
      title: opts.title,
      message,
      duration: opts.duration ?? duration,
      createdAt: Date.now(),
    }
    toasts.value.push(notification)

    // 自动移除
    if (notification.duration > 0) {
      setTimeout(() => removeToast(notification.id), notification.duration)
    }
  }

  /** 已展示的远程通知 ID，避免重连补发导致重复弹出。 */
  const remoteNotificationIds = new Set<string>()

  /** 远程通知只按稳定 notificationId 展示一次；本地反馈 Toast 不进入远程协议。 */
  function toastRemote(id: string, message: string, options: ToastOptions = {}) {
    if (id && remoteNotificationIds.has(id)) return
    if (id) {
      remoteNotificationIds.add(id)
      if (remoteNotificationIds.size > 2_000) {
        remoteNotificationIds.delete(remoteNotificationIds.values().next().value!)
      }
    }
    toast(message, options)
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
      // 静默错误仅记日志，不显示 UI
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
    toastRemote,
    showModal,
    closeModal,
    removeToast,
    notifyByCode,
  }
})

/** 错误码 → UI 严重性映射 */
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
