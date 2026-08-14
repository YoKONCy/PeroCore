/**
 * taskToastStore — 统一任务中心 toast 队列
 *
 * 独立于现有 useNotificationStore，专职管理任务类 toast 的
 * 入队 / 更新 / 移除。完全脱离后端可独立工作。
 *
 * @see components/taskCenter/
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TaskToastItem } from '../components/taskCenter'

// 自增 id 计数器
let nextId = 0

/** 队列上限，超出时丢弃最旧的一条 */
const MAX_TOASTS = 5

export const useTaskToastStore = defineStore('taskToast', () => {
  // ── 状态 ──
  const toasts = ref<TaskToastItem[]>([])

  // ── Getters ──

  /** 未 dismissed（即当前队列中）的 toast 数 */
  const activeCount = computed(() => toasts.value.length)

  /** 待审批 toast 数（供对话 tab 小红点使用） */
  const approvalPendingCount = computed(
    () => toasts.value.filter((t) => t.type === 'task_approval_requested').length,
  )

  // ── Actions ──

  /** 入队一条新 toast，自动生成 id 与 createdAt */
  function push(item: Omit<TaskToastItem, 'id' | 'createdAt'>): string {
    const id = `task-toast-${nextId++}`
    const toast: TaskToastItem = {
      ...item,
      id,
      createdAt: Date.now(),
    }

    // 超出上限时移除最旧的一条（数组尾部为最新）
    if (toasts.value.length >= MAX_TOASTS) {
      toasts.value.shift()
    }
    toasts.value.push(toast)
    return id
  }

  /** 通过 id 部分更新（用于 progress 推进等场景） */
  function update(id: string, patch: Partial<TaskToastItem>) {
    const target = toasts.value.find((t) => t.id === id)
    if (!target) return
    Object.assign(target, patch)
  }

  /** 移除指定 toast */
  function dismiss(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      toasts.value.splice(idx, 1)
    }
  }

  /** 清空全部 toast */
  function dismissAll() {
    toasts.value = []
  }

  return {
    toasts,
    activeCount,
    approvalPendingCount,
    push,
    update,
    dismiss,
    dismissAll,
  }
})
