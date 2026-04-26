/**
 * useDashboardContext — Dashboard 全局共享状态
 *
 * 通过 provide/inject 在 DashboardView 与所有 Tab 组件之间共享：
 * - isBackendOnline: 后端在线检测 (systemApi.health 轮询)
 * - activeAgentId: 当前活跃 Agent ID
 * - refreshKey: 全局刷新计数器 (Tab watch 此值重新加载数据)
 * - currentTab: 当前选中的 Tab ID
 * - openConfirm: 全局确认弹窗 (Promise 模式)
 * - handleQuitApp: 退出系统
 *
 * @module packages/frontend/src/composables/dashboard/useDashboardContext
 */

import { ref, inject, onMounted, onUnmounted, type InjectionKey, type Ref } from 'vue'
import { systemApi } from '../../api/modules/systemApi'
import { agentApi } from '../../api/modules/agentApi'
import { invoke } from '../../utils/ipcAdapter'
import { logger } from '../../lib/logger'

// ── 类型定义 ──

/** 确认弹窗配置 */
export interface ConfirmOptions {
  type?: 'warning' | 'info' | 'error'
  /** prompt 模式: 带输入框 */
  isPrompt?: boolean
  inputValue?: string
  inputPlaceholder?: string
}

/** 确认弹窗结果 */
export interface ConfirmResult {
  action: 'confirm'
  /** prompt 模式下的输入值 */
  value?: string
}

/** openConfirm 函数签名 */
export type OpenConfirmFn = (
  title: string,
  content: string,
  options?: ConfirmOptions,
) => Promise<ConfirmResult>

export interface DashboardContext {
  /** 后端是否在线 */
  isBackendOnline: Ref<boolean>
  /** 当前活跃 Agent ID */
  activeAgentId: Ref<string>
  /** 全局刷新计数器 (变化时 Tab 应重新加载数据) */
  refreshKey: Ref<number>
  /** 当前 Tab ID */
  currentTab: Ref<string>
  /** 触发全局刷新 */
  triggerRefresh: () => Promise<void>
  /** 是否正在刷新 */
  isRefreshing: Ref<boolean>

  // ── 确认弹窗 ──
  /** 打开确认弹窗 (Promise: resolve = 确认, reject = 取消) */
  openConfirm: OpenConfirmFn
  /** 确认弹窗是否可见 */
  showConfirm: Ref<boolean>
  /** 弹窗标题 */
  confirmTitle: Ref<string>
  /** 弹窗内容 */
  confirmContent: Ref<string>
  /** 弹窗类型 */
  confirmType: Ref<'warning' | 'info' | 'error'>
  /** 是否为 prompt 模式 */
  confirmIsPrompt: Ref<boolean>
  /** prompt 输入值 */
  confirmPromptValue: Ref<string>
  /** prompt 占位符 */
  confirmPromptPlaceholder: Ref<string>
  /** 确认回调 */
  handleConfirm: () => void
  /** 取消回调 */
  handleCancel: () => void

  // ── 退出 ──
  /** 退出系统 */
  handleQuitApp: () => Promise<void>
}

/** provide/inject 键 */
export const DASHBOARD_CTX_KEY: InjectionKey<DashboardContext> = Symbol('DashboardContext')

// ── 健康检查轮询间隔 ──
const HEALTH_CHECK_INTERVAL = 15_000 // 15 秒
const HEALTH_CHECK_TIMEOUT = 5_000 // 超时 5 秒

/**
 * 创建 Dashboard 共享上下文 (仅在 DashboardView 中调用一次)
 *
 * 职责:
 * 1. 启动后端健康检查轮询
 * 2. 获取活跃 Agent ID
 * 3. 提供 triggerRefresh() 供全局刷新按钮调用
 */
export function createDashboardContext(currentTab: Ref<string>): DashboardContext {
  const isBackendOnline = ref(false)
  const activeAgentId = ref('pero')
  const refreshKey = ref(0)
  const isRefreshing = ref(false)

  let healthTimer: ReturnType<typeof setInterval> | null = null

  // ── 健康检查 ──
  async function checkHealth() {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

      const res = await systemApi.health()
      clearTimeout(timeout)

      const wasOffline = !isBackendOnline.value
      isBackendOnline.value = res.data?.status === 'ok'

      // 从 offline → online: 自动拉取活跃 Agent
      if (wasOffline && isBackendOnline.value) {
        await fetchActiveAgent()
      }
    } catch {
      isBackendOnline.value = false
    }
  }

  // ── 获取活跃 Agent ──
  async function fetchActiveAgent() {
    try {
      const res = await agentApi.getActive()
      if (res.data?.agentId) {
        activeAgentId.value = res.data.agentId
      }
    } catch {
      // 静默，保持默认值
    }
  }

  // ── 全局刷新 ──
  async function triggerRefresh() {
    if (isRefreshing.value) return
    isRefreshing.value = true

    try {
      await checkHealth()

      if (isBackendOnline.value) {
        await fetchActiveAgent()
        refreshKey.value++
      }
    } finally {
      setTimeout(() => {
        isRefreshing.value = false
      }, 600)
    }
  }

  // ── 确认弹窗 (Promise 模式，参照 v1) ──
  const showConfirm = ref(false)
  const confirmTitle = ref('')
  const confirmContent = ref('')
  const confirmType = ref<'warning' | 'info' | 'error'>('warning')
  const confirmIsPrompt = ref(false)
  const confirmPromptValue = ref('')
  const confirmPromptPlaceholder = ref('')
  let _confirmResolve: ((result: ConfirmResult) => void) | null = null
  let _confirmReject: ((err: Error) => void) | null = null

  const openConfirm: OpenConfirmFn = (title, content, options = {}) => {
    return new Promise<ConfirmResult>((resolve, reject) => {
      confirmTitle.value = title
      confirmContent.value = content
      confirmType.value = options.type ?? 'warning'
      confirmIsPrompt.value = !!options.isPrompt
      confirmPromptValue.value = options.inputValue ?? ''
      confirmPromptPlaceholder.value = options.inputPlaceholder ?? ''
      _confirmResolve = resolve
      _confirmReject = reject
      showConfirm.value = true
    })
  }

  function handleConfirm() {
    const result: ConfirmResult = confirmIsPrompt.value
      ? { action: 'confirm', value: confirmPromptValue.value }
      : { action: 'confirm' }
    _confirmResolve?.(result)
    showConfirm.value = false
    _confirmResolve = null
    _confirmReject = null
  }

  function handleCancel() {
    _confirmReject?.(new Error('User cancelled'))
    showConfirm.value = false
    _confirmResolve = null
    _confirmReject = null
  }

  // ── 退出系统 ──
  async function handleQuitApp() {
    try {
      await openConfirm('退出萌动链接', '确定要关闭 PeroCore 并退出所有相关程序吗？', {
        type: 'warning',
      })
      await invoke('quit-app')
    } catch (e) {
      if ((e as Error).message !== 'User cancelled') {
        logger.error('Dashboard', '退出失败', e)
      }
    }
  }

  // ── 生命周期 ──
  onMounted(async () => {
    await checkHealth()
    healthTimer = setInterval(checkHealth, HEALTH_CHECK_INTERVAL)
  })

  onUnmounted(() => {
    if (healthTimer) {
      clearInterval(healthTimer)
      healthTimer = null
    }
  })

  return {
    isBackendOnline,
    activeAgentId,
    refreshKey,
    currentTab,
    triggerRefresh,
    isRefreshing,
    // 确认弹窗
    openConfirm,
    showConfirm,
    confirmTitle,
    confirmContent,
    confirmType,
    confirmIsPrompt,
    confirmPromptValue,
    confirmPromptPlaceholder,
    handleConfirm,
    handleCancel,
    // 退出
    handleQuitApp,
  }
}

/**
 * 在 Tab 组件中注入 Dashboard 上下文
 *
 * 使用示例:
 * ```ts
 * const { isBackendOnline, refreshKey, activeAgentId } = useDashboardContext()
 * watch(refreshKey, () => loadData())
 * ```
 */
export function useDashboardContext(): DashboardContext {
  const ctx = inject(DASHBOARD_CTX_KEY)
  if (!ctx) {
    // 兜底: 没有 provider 时返回独立状态 (例如单独调试 Tab)
    const noop = async () => {}
    return {
      isBackendOnline: ref(true),
      activeAgentId: ref('pero'),
      refreshKey: ref(0),
      currentTab: ref('overview'),
      triggerRefresh: noop,
      isRefreshing: ref(false),
      openConfirm: () => Promise.resolve({ action: 'confirm' }),
      showConfirm: ref(false),
      confirmTitle: ref(''),
      confirmContent: ref(''),
      confirmType: ref<'warning' | 'info' | 'error'>('warning'),
      confirmIsPrompt: ref(false),
      confirmPromptValue: ref(''),
      confirmPromptPlaceholder: ref(''),
      handleConfirm: () => {},
      handleCancel: () => {},
      handleQuitApp: noop,
    }
  }
  return ctx
}
