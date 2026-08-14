/**
 * useApprovalStore — 工具审批全局状态（跨 Tab 单例）
 *
 * 审批不是任何 Tab 的专属逻辑：对话、工作区、任务中心共享同一份 pending 集合。
 * 数据流：轮询（兜底）+ resolve 后即时移除；后续可叠加 Gateway 推送加速。
 *
 * @module packages/frontend/src/stores/useApprovalStore
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  approvalsApi,
  type ApprovalRequest,
  type ApprovalDecision,
} from '../api/modules/approvalsApi'
import { uiSound } from '../services/ui/uiSound'

const POLL_INTERVAL_MS = 4_000

export const useApprovalStore = defineStore('approval', () => {
  const pending = ref<Map<string, ApprovalRequest>>(new Map())
  const isResolving = ref<Record<string, boolean>>({})
  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** 未完成审批数量（全局角标） */
  const pendingCount = computed(() => pending.value.size)

  /** 按 Agent 过滤的 pending 视图（新到旧排序） */
  function forAgent(agentId: string): ApprovalRequest[] {
    return [...pending.value.values()]
      .filter((request) => request.agentId === agentId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }

  /** 按 Agent + Thread 过滤（对话流内嵌用） */
  function forThread(agentId: string, threadId: string): ApprovalRequest[] {
    return forAgent(agentId).filter(
      (request) => request.threadId === threadId || request.sessionId === threadId,
    )
  }

  /** 刷新 pending 集合（与后端状态对齐） */
  async function refresh(): Promise<void> {
    try {
      const res = await approvalsApi.list({ status: 'pending' })
      pending.value = new Map((res.data?.requests ?? []).map((request) => [request.id, request]))
    } catch {
      // 后端未就绪时静默，等待下一轮
    }
  }

  /** 决策（可选附言），成功后从 pending 移除 */
  async function resolve(id: string, decision: ApprovalDecision, message?: string): Promise<void> {
    if (isResolving.value[id]) return
    isResolving.value = { ...isResolving.value, [id]: true }
    try {
      await approvalsApi.resolve(id, decision, message)
      const map = new Map(pending.value)
      map.delete(id)
      pending.value = map
    } finally {
      isResolving.value = { ...isResolving.value, [id]: false }
    }
  }

  /** 接收 Gateway 新审批，轮询只作为断线兜底。 */
  function receive(request: ApprovalRequest): void {
    if (request.status !== 'pending') return
    const isNew = !pending.value.has(request.id)
    const map = new Map(pending.value)
    map.set(request.id, request)
    pending.value = map
    if (isNew) void uiSound.play('approval.required')
  }

  /** 接收 Gateway 审批完成事件并即时移除。 */
  function remove(id: string): void {
    const map = new Map(pending.value)
    map.delete(id)
    pending.value = map
  }

  /** 启动全局轮询（在 MainView 挂载时调用一次） */
  function startPolling(): void {
    if (pollTimer) return
    void refresh()
    pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    pending,
    pendingCount,
    isResolving,
    forAgent,
    forThread,
    refresh,
    resolve,
    receive,
    remove,
    startPolling,
    stopPolling,
  }
})
