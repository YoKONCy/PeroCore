/**
 * taskCenterStore — 统一任务中心状态管理（M05 篇2-4）
 *
 * 职责：
 * - 进行中任务列表 / 历史任务列表 / 各 Agent 活跃计数
 * - Gateway 后台任务事件订阅（created/started/progress/completed/failed/cancelled）
 *   只增量更新对应任务，绝不切换前台角色（M05 §6 约束）
 * - 孵化联动：任务完成/失败时推 TaskToast（M05-A5 决策，系统级通知在篇3 接入）
 *
 * 数据边界：
 * - Gateway事件仅作为Projection失效通知，不携带业务权威状态
 * - 任务事实与Surface统一从REST Projection读取
 * - 历史视图纯REST分页查询
 *
 * @module packages/frontend/src/stores/taskCenterStore
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { backgroundTasksApi } from '../api/modules/backgroundTasksApi'
import type {
  BackgroundTaskInfo,
  BackgroundTaskQueryParams,
  BackgroundTaskStatus,
} from '../api/modules/backgroundTasksApi'
import { useTaskToastStore } from './taskToastStore'
import { useAgentStore } from './useAgentStore'
import { useThreadStore } from './useThreadStore'
import { useCompositorStore } from './useCompositorStore'
import { getApiBaseUrl } from '../api/transport'
import { invoke, isElectron } from '../utils/ipcAdapter'
import { logger } from '../lib/logger'
import { uiSound } from '../services/ui/uiSound'

/**
 * M05-篇3-3: 孵化（任务完成/失败）时发系统级通知
 * 浏览器环境用 Web Notification API；Electron 环境走 IPC 到原生 toast
 */
async function sendSystemNotification(title: string, body: string): Promise<void> {
  try {
    if (isElectron() || typeof Notification !== 'undefined') {
      await invoke('show-notification', { title, body })
    }
  } catch (err) {
    logger.warn('taskCenterStore', '系统通知失败', err)
  }
}

/** 活跃状态集合（进行中视图） */
const ACTIVE_STATUSES: BackgroundTaskStatus[] = ['queued', 'running', 'paused', 'waiting_input']

/** 终态集合（历史视图） */
const FINISHED_STATUSES: BackgroundTaskStatus[] = ['completed', 'failed', 'cancelled']

export const useTaskCenterStore = defineStore('taskCenter', () => {
  const taskToast = useTaskToastStore()

  // ── 状态 ──

  /** 进行中任务（按创建时间倒序） */
  const activeTasks = ref<BackgroundTaskInfo[]>([])

  /** 历史任务分页 */
  const historyTasks = ref<BackgroundTaskInfo[]>([])
  const historyTotal = ref(0)

  /** 等待任务中心消费并打开的任务结果 */
  const pendingOpenTask = ref<BackgroundTaskInfo | null>(null)

  /** 各 Agent 活跃任务数（聊天徽章数据源） */
  const activeCountByAgent = ref<Record<string, number>>({})

  /** 列表加载状态 */
  const isLoadingActive = ref(false)
  const isLoadingHistory = ref(false)

  /** 当前筛选条件（历史视图） */
  const historyFilter = ref<BackgroundTaskQueryParams>({ page: 1, pageSize: 20 })

  // ── 计算属性 ──

  /** 进行中任务总数（小红点） */
  const activeCount = computed(() => activeTasks.value.length)

  /** 指定 Agent 的进行中任务数 */
  function activeCountOf(agentId: string): number {
    return activeCountByAgent.value[agentId] ?? 0
  }

  /** 某 Agent 的进行中任务列表（任务中心按角色分组用） */
  const tasksByAgent = computed(() => {
    const map = new Map<string, BackgroundTaskInfo[]>()
    for (const task of activeTasks.value) {
      const list = map.get(task.agentId) ?? []
      list.push(task)
      map.set(task.agentId, list)
    }
    return map
  })

  // ── REST 加载 ──

  /** 刷新进行中任务列表 + 各 Agent 计数 */
  async function refreshActive(): Promise<void> {
    isLoadingActive.value = true
    try {
      // 拉取全部活跃状态（四态合并，客户端排序）
      const pages = await Promise.all(
        ACTIVE_STATUSES.map((status) => backgroundTasksApi.list({ status, pageSize: 100 })),
      )
      const merged = pages.flatMap((res) => res.data?.items ?? [])
      merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      activeTasks.value = merged

      const counts = await backgroundTasksApi.activeCount()
      const map: Record<string, number> = {}
      for (const item of counts.data ?? []) map[item.agentId] = item.count
      activeCountByAgent.value = map
    } catch (err) {
      logger.warn('taskCenterStore', '刷新进行中任务失败', err)
    } finally {
      isLoadingActive.value = false
    }
  }

  /** 刷新历史任务（分页 + 筛选） */
  async function refreshHistory(filter: BackgroundTaskQueryParams = {}): Promise<void> {
    isLoadingHistory.value = true
    historyFilter.value = { ...historyFilter.value, ...filter }
    try {
      // 历史视图只关心终态；首版按单状态查询或全部，这里统一拉全量后客户端过滤
      // TODO(M05-后续): 后端支持 status in [...] 多值后改服务端过滤
      const res = await backgroundTasksApi.list({
        ...historyFilter.value,
        pageSize: historyFilter.value.pageSize ?? 20,
      })
      const items = (res.data?.items ?? []).filter((t) =>
        historyFilter.value.status
          ? t.status === historyFilter.value.status
          : FINISHED_STATUSES.includes(t.status),
      )
      historyTasks.value = items
      historyTotal.value = res.data?.total ?? 0
    } catch (err) {
      logger.warn('taskCenterStore', '刷新历史任务失败', err)
    } finally {
      isLoadingHistory.value = false
    }
  }

  // ── 操作 ──

  /** 派发任务 */
  async function dispatch(
    req: Parameters<typeof backgroundTasksApi.dispatch>[0],
  ): Promise<string | null> {
    try {
      const res = await backgroundTasksApi.dispatch(req)
      const task = res.data
      if (task) {
        upsertActive(task)
        taskToast.push({
          type: 'task_started',
          agentId: task.agentId,
          avatarUrl: avatarUrlOf(task.agentId),
          title: '任务已派发',
          message: `${task.title}`,
          taskId: task.id,
        })
        return task.id
      }
      return null
    } catch (err) {
      taskToast.push({
        type: 'task_failed',
        title: '任务派发失败',
        message: err instanceof Error ? err.message : '派发失败',
      })
      return null
    }
  }

  /** 暂停 */
  async function pause(id: string): Promise<void> {
    await backgroundTasksApi.pause(id)
  }

  /** 恢复 */
  async function resume(id: string): Promise<void> {
    await backgroundTasksApi.resume(id)
  }

  /** 取消 */
  async function cancel(id: string): Promise<void> {
    await backgroundTasksApi.cancel(id)
  }

  /** 基于历史任务一键重新派发。 */
  async function retry(id: string): Promise<BackgroundTaskInfo | null> {
    const res = await backgroundTasksApi.retry(id)
    if (res.data) upsertActive(res.data)
    return res.data ?? null
  }

  /** 标记单条历史记录已读，并同步本地状态。 */
  async function markRead(id: string): Promise<void> {
    await backgroundTasksApi.markRead(id)
    const task = historyTasks.value.find((item) => item.id === id)
    if (task) task.readAt = new Date().toISOString()
  }

  /** 一键标记全部历史记录已读。 */
  async function markAllRead(): Promise<number> {
    const response = await backgroundTasksApi.markAllRead()
    const now = new Date().toISOString()
    for (const task of historyTasks.value) task.readAt ??= now
    return response.data?.count ?? 0
  }

  /** 删除历史记录并同步本地列表。 */
  async function remove(id: string): Promise<void> {
    await backgroundTasksApi.delete(id)
    historyTasks.value = historyTasks.value.filter((t) => t.id !== id)
  }

  // ── Gateway 事件处理（M05 §6：只更新对应任务，不切换前台角色） ──

  /** 插入/更新进行中任务 */
  function upsertActive(task: BackgroundTaskInfo): void {
    const idx = activeTasks.value.findIndex((t) => t.id === task.id)
    if (ACTIVE_STATUSES.includes(task.status)) {
      if (idx >= 0) {
        const next = [...activeTasks.value]
        next[idx] = task
        activeTasks.value = next
      } else {
        activeTasks.value = [task, ...activeTasks.value]
      }
    } else {
      // 终态：从进行中移除，职责交给历史视图（用户进入历史时再拉取）
      if (idx >= 0) {
        activeTasks.value = activeTasks.value.filter((t) => t.id !== task.id)
      }
    }
    // 同步 Agent 计数
    syncCountFromTasks()
  }

  /** 从当前进行中列表重算各 Agent 计数 */
  function syncCountFromTasks(): void {
    const map: Record<string, number> = {}
    for (const task of activeTasks.value) {
      map[task.agentId] = (map[task.agentId] ?? 0) + 1
    }
    activeCountByAgent.value = map
  }

  /** Gateway只负责通知Projection失效，业务事实必须重新读取。 */
  async function handleGatewayEvent(action: string, taskId: string): Promise<void> {
    const [detail, projection] = await Promise.all([
      backgroundTasksApi.detail(taskId),
      backgroundTasksApi.projection(taskId),
    ])
    const task = detail.data
    if (!task) return
    upsertActive(task)
    if (projection.data) {
      useCompositorStore().replaceScope(`background-task:${taskId}`, projection.data.surfaces)
    }

    // M05-A5: 孵化联动 —— 完成/失败时推任务专属 Toast
    if (action === 'background_task_completed') {
      const title = `任务完成 ✓ ${task.title}`
      const body = `${task.agentId} 已完成该任务（工具调用 ${task.toolCallCount} 次）`
      taskToast.push({
        type: 'task_completed',
        agentId: task.agentId,
        avatarUrl: avatarUrlOf(task.agentId),
        title: '任务已完成',
        message: `${task.title}（工具调用 ${task.toolCallCount} 次）`,
        taskId: task.id,
      })
      void uiSound.play('task.complete')
      void sendSystemNotification(title, body)
      if (task.completionAction === 'open_result') {
        pendingOpenTask.value = task
      } else if (task.completionAction === 'send_to_chat' && task.targetThreadId) {
        const threadStore = useThreadStore()
        if (task.targetThreadId === threadStore.threadId) {
          void threadStore.refreshCurrentThread()
        }
      }
    } else if (action === 'background_task_failed') {
      const title = `任务失败 ✗ ${task.title}`
      const body = `${task.agentId} ${task.errorMessage ?? '未知错误'}`
      taskToast.push({
        type: 'task_failed',
        agentId: task.agentId,
        avatarUrl: avatarUrlOf(task.agentId),
        title: '任务失败',
        message: `${task.title}：${task.errorMessage ?? '未知错误'}`,
        taskId: task.id,
      })
      void uiSound.play('task.failed')
      void sendSystemNotification(title, body)
    }
  }

  /** 清除已消费的自动打开任务 */
  function consumePendingOpenTask(): void {
    pendingOpenTask.value = null
  }

  /** 查询 Agent 头像（用于 toast 展示，找不到返回 undefined） */
  function avatarUrlOf(agentId: string): string | undefined {
    const agentStore = useAgentStore()
    const url = agentStore.agents.find((a) => a.id === agentId)?.avatarUrl
    return url ? `${getApiBaseUrl()}${url}` : undefined
  }

  // ── Gateway 订阅注册 ──

  /** 已注册的标志（避免重复注册多个监听） */
  let gatewayBound = false

  /**
   * 绑定 Gateway 事件
   *
   * 应在 MainView onMounted 调用一次；onPush 回调由 core useGateway 管理，
   * 组件卸载时通过返回的解绑函数释放。
   */
  function bindGateway(gateway: {
    onPush: (action: string, handler: (payload: Record<string, unknown>) => void) => void
    offPush: (action: string, handler: (payload: Record<string, unknown>) => void) => void
  }): () => void {
    if (gatewayBound) return () => {}
    gatewayBound = true

    const handler = (payload: Record<string, unknown>) => {
      const action = payload.action as string | undefined
      const taskId =
        typeof payload.taskId === 'string'
          ? payload.taskId
          : typeof (payload.task as { id?: unknown } | undefined)?.id === 'string'
            ? String((payload.task as { id: string }).id)
            : undefined
      if (!action || !taskId || !action.startsWith('background_task_')) return
      void handleGatewayEvent(action, taskId).catch((error) => {
        logger.warn('TaskCenter', `刷新任务Projection失败: ${error}`)
      })
    }

    gateway.onPush('*', handler)

    return () => {
      gateway.offPush('*', handler)
      gatewayBound = false
    }
  }

  return {
    // 状态
    activeTasks,
    historyTasks,
    historyTotal,
    pendingOpenTask,
    activeCountByAgent,
    isLoadingActive,
    isLoadingHistory,
    historyFilter,
    // 计算
    activeCount,
    tasksByAgent,
    // 方法
    activeCountOf,
    refreshActive,
    refreshHistory,
    dispatch,
    pause,
    resume,
    cancel,
    retry,
    markRead,
    markAllRead,
    remove,
    consumePendingOpenTask,
    handleGatewayEvent,
    bindGateway,
  }
})
