/**
 * useDashboard.ts
 * Dashboard 共享基础状态：API基地址、fetch工具、confirm弹窗、全局刷新
 */
import { ref } from 'vue'
import { invoke } from '@/utils/ipcAdapter'
import { API_BASE } from '@/config'
// 重新导出 API_BASE，方便已有的下游组件直接从本模块导入
export { API_BASE }
import type {
  ConfirmOptions,
  ConfirmResult,
  OpenConfirmFn,
  ParticleItem,
  MenuGroup,
  ConnectionInfo,
  UpdateStatus
} from './types'


// ─── API 错误类（可用于 catch 中精确判断） ───────────────────────────────────
export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, message: string, detail = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

// ─── 带超时的 fetch 包装 ─────────────────────────────────────────────────────
export const fetchWithTimeout = async (
  url: string,
  options: RequestInit & { silent?: boolean; throwOnError?: boolean } = {},
  timeout = 5000
): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  const { silent, throwOnError, ...fetchOptions } = options
  
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal })
    clearTimeout(id)
    
    // 如果响应不 OK，尝试解析统一的报错结构 (P0-3)
    if (!response.ok) {
      let errorMsg = `请求失败 (${response.status})`
      let errorDetail = ''

      try {
        const errorData = await response.clone().json()
        const errorObj = errorData.error || errorData
        
        // 按照优先级提取信息：error.message -> message -> detail
        errorMsg = errorObj.message || errorObj.detail || errorMsg
        errorDetail = errorObj.detail && errorObj.detail !== errorMsg ? `\n详情: ${errorObj.detail}` : ''
      } catch {
        // JSON 解析失败时使用默认错误消息
      }

      if (!silent) {
        window.$notify(errorMsg + errorDetail, 'error')
      }

      // 当 throwOnError 为 true 时，抛出 ApiError 防止调用方误 .json()
      if (throwOnError) {
        throw new ApiError(response.status, errorMsg, errorDetail)
      }
    }

    
    return response
  } catch (error: unknown) {
    clearTimeout(id)

    // 如果是已经构造好的 ApiError，直接 re-throw
    if (error instanceof ApiError) {
      throw error
    }

    const err = error as Error
    let errorMsg = err.message
    if (err.name === 'AbortError') {
      errorMsg = `请求超时 (${timeout}ms)`
    } else if (err.message === 'Failed to fetch') {
      errorMsg = '无法连接到后端服务。请检查后端是否已启动'
    } else if (err.message.includes('NetworkError')) {
      errorMsg = '网络连接错误'
    }
    if (!silent) {
      window.$notify(errorMsg, 'error')
    }
    throw error
  }
}

// ─── 安全的 JSON fetch 包装（推荐新代码使用） ─────────────────────────────────
/**
 * 一步完成 fetch + OK 校验 + JSON 解析，失败时自动 throw ApiError。
 *
 * 与 fetchWithTimeout 的区别：
 *   - 非 OK 响应 **一定** 会 throw（不需要手动 if (!res.ok)）
 *   - 自动调用 .json() 并返回 T 类型数据
 *   - 适用于所有「成功时返回 JSON」的接口
 *
 * @example
 * ```ts
 * const data = await fetchJson<Memory[]>(`${API_BASE}/memories`, {}, 5000)
 * // data 已经是 Memory[]，无需 res.ok 检查
 * ```
 */
export const fetchJson = async <T = unknown>(
  url: string,
  options: RequestInit & { silent?: boolean } = {},
  timeout = 5000
): Promise<T> => {
  const response = await fetchWithTimeout(url, { ...options, throwOnError: true }, timeout)
  return (await response.json()) as T
}

// ─── LLM 错误信息格式化 ────────────────────────────────────────────────────────
export const formatLLMError = (error: unknown): string => {
  const err = error as Error
  if (err.name === 'AbortError') return '请求超时 (Timeout)'
  const msg = err.message || String(error)
  if (msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('Incorrect API key'))
    return 'API Key 无效，请检查配置 (401 Unauthorized)'
  if (msg.includes('404') || msg.includes('model_not_found'))
    return '请求的模型不存在或端点错误 (404 Not Found)'
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('insufficient_quota'))
    return '请求过于频繁或余额不足 (429 Rate Limit)'
  if (msg.includes('500') || msg.includes('internal_server_error'))
    return '服务商服务器内部错误 (500 Internal Server Error)'
  if (msg.includes('503') || msg.includes('service_unavailable'))
    return '服务暂时不可用 (503 Service Unavailable)'
  if (msg.includes('Failed to fetch')) return '无法连接到服务器，请检查网络 (Failed to fetch)'
  return msg
}

// ─── useDashboard 组合式函数 ──────────────────────────────────────────────────
export function useDashboard() {
  // --- 全局 UI 状态 ---
  const currentTab = ref<string>('overview')
  const isBackendOnline = ref<boolean>(false)
  const isSaving = ref<boolean>(false)
  const isGlobalRefreshing = ref<boolean>(false)

  // --- 粒子背景 ---
  const particles = ref<ParticleItem[]>([])
  const initParticles = (): void => {
    particles.value = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      style: {
        top: `${Math.random() * 100}%`,
        left: `${Math.random() * 100}%`,
        animationDelay: `${Math.random() * 5}s`,
        animationDuration: `${10 + Math.random() * 15}s`,
        willChange: 'transform, opacity'
      },
      icon: i % 2 === 0 ? 'sparkle' : 'heart',
      size: i % 3 === 0 ? 'sm' : 'xs'
    }))
  }

  // --- Confirm 弹窗 ---
  const showConfirmModal = ref<boolean>(false)
  const confirmModalTitle = ref<string>('')
  const confirmModalContent = ref<string>('')
  const confirmCallback = ref<(() => void) | null>(null)
  const confirmCancelCallback = ref<(() => void) | null>(null)
  const confirmType = ref<'warning' | 'info' | 'error' | 'success'>('warning')
  const isPrompt = ref<boolean>(false)
  const promptValue = ref<string>('')
  const promptPlaceholder = ref<string>('')

  const openConfirm: OpenConfirmFn = (
    title: string,
    content: string,
    options: ConfirmOptions = {}
  ): Promise<ConfirmResult> => {
    return new Promise((resolve, reject) => {
      confirmModalTitle.value = title
      confirmModalContent.value = content
      confirmType.value = (options.type as typeof confirmType.value) ?? 'warning'
      isPrompt.value = !!options.isPrompt
      promptValue.value = options.inputValue ?? ''
      promptPlaceholder.value = options.inputPlaceholder ?? ''

      confirmCallback.value = () => {
        resolve(
          isPrompt.value ? { value: promptValue.value, action: 'confirm' } : { action: 'confirm' }
        )
        showConfirmModal.value = false
      }
      confirmCancelCallback.value = () => {
        reject(new Error('User cancelled'))
        showConfirmModal.value = false
      }
      showConfirmModal.value = true
    })
  }

  const handleConfirm = (): void => {
    confirmCallback.value?.()
  }
  const handleCancel = (): void => {
    confirmCancelCallback.value?.()
  }

  // --- 图片查看器 ---
  const showImageViewer = ref<boolean>(false)
  const imageViewerList = ref<string[]>([])
  const imageViewerIndex = ref<number>(0)

  const openImageViewer = (imgs: string[], idx: number): void => {
    imageViewerList.value = imgs
    imageViewerIndex.value = idx
    showImageViewer.value = true
  }

  // --- App 版本 / 更新 ---
  const appVersion = ref<string>('...')
  const updateStatus = ref<UpdateStatus>({ type: 'idle' })
  const isCheckingUpdate = ref<boolean>(false)

  const checkForUpdates = async (): Promise<void> => {
    if (isCheckingUpdate.value) return
    isCheckingUpdate.value = true
    try {
      await invoke('check_update')
    } catch {
      window.$notify('检查更新失败', 'error')
      isCheckingUpdate.value = false
    }
  }

  const handleUpdateMessage = (data: UpdateStatus, openConfirmFn: OpenConfirmFn): void => {
    updateStatus.value = data
    switch (data.type) {
      case 'checking':
        isCheckingUpdate.value = true
        break
      case 'not-available':
        isCheckingUpdate.value = false
        window.$notify('当前已是最新版本', 'success')
        break
      case 'error':
        isCheckingUpdate.value = false
        window.$notify(`更新错误: ${data.error}`, 'error')
        break
      case 'available':
        isCheckingUpdate.value = false
        openConfirmFn('发现新版本', `检测到新版本 v${data.info?.version}，是否立即更新？`, {
          type: 'info'
        })
          .then(() => invoke('download_update'))
          .catch(() => {})
        break
      case 'downloaded':
        openConfirmFn('更新就绪', '更新已下载完毕，是否立即重启以安装？', { type: 'success' })
          .then(() => invoke('quit_and_install'))
          .catch(() => {})
        break
    }
  }

  // --- 连接二维码 ---
  const showQrModal = ref<boolean>(false)
  const connectionInfo = ref<ConnectionInfo | null>(null)
  const isLoadingConnection = ref<boolean>(false)

  const fetchConnectionInfo = async (): Promise<void> => {
    isLoadingConnection.value = true
    try {
      const res = await fetch(`${API_BASE}/connection/info`)
      if (res.ok) {
        connectionInfo.value = (await res.json()) as ConnectionInfo
        showQrModal.value = true
      } else {
        window.$notify('获取连接信息失败', 'error')
      }
    } catch {
      window.$notify('无法连接到后端服务', 'error')
    } finally {
      isLoadingConnection.value = false
    }
  }

  // --- 退出 ---
  const handleQuitApp = async (): Promise<void> => {
    try {
      await openConfirm(
        '退出 萌动链接：PeroperoChat！',
        '确定要关闭 Peropero 并退出所有相关程序吗？',
        {
          type: 'warning'
        }
      )
      await invoke('quit_app')
    } catch (e) {
      if ((e as Error).message !== 'User cancelled') console.error('Failed to quit app', e)
    }
  }

  // --- 标签选择 ---
  const handleTabSelect = (index: string): void => {
    if (currentTab.value === index) return
    currentTab.value = index
  }

  // --- 菜单结构 ---
  const menuGroups: MenuGroup[] = [
    {
      title: null,
      items: [
        { id: 'overview', label: '总览', icon: 'desktop' },
        { id: 'logs', label: '对话日志', icon: 'chat' },
        { id: 'memories', label: '核心记忆', icon: 'brain' },
        { id: 'tasks', label: '待办任务', icon: 'list' }
      ]
    },
    {
      title: 'CONFIGURATION',
      items: [
        { id: 'user_settings', label: '用户设定', icon: 'user' },
        { id: 'model_config', label: '模型配置', icon: 'settings' },
        { id: 'voice_config', label: '语音功能', icon: 'mic' },
        { id: 'mcp_config', label: 'MCP 配置', icon: 'terminal' }
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { id: 'napcat', label: 'NapCat 管理', icon: 'terminal' },
        { id: 'terminal', label: '系统终端', icon: 'desktop' },
        { id: 'system_reset', label: '危险区域', icon: 'alert', variant: 'danger' }
      ]
    }
  ]

  return {
    // 状态
    currentTab,
    isBackendOnline,
    isSaving,
    isGlobalRefreshing,
    particles,
    initParticles,
    // 确认弹窗
    showConfirmModal,
    confirmModalTitle,
    confirmModalContent,
    confirmCallback,
    confirmCancelCallback,
    confirmType,
    isPrompt,
    promptValue,
    promptPlaceholder,
    openConfirm,
    handleConfirm,
    handleCancel,
    // 图片查看器
    showImageViewer,
    imageViewerList,
    imageViewerIndex,
    openImageViewer,
    // 更新
    appVersion,
    updateStatus,
    isCheckingUpdate,
    checkForUpdates,
    handleUpdateMessage,
    // 连接
    showQrModal,
    connectionInfo,
    isLoadingConnection,
    fetchConnectionInfo,
    // 退出
    handleQuitApp,
    // 导航
    handleTabSelect,
    menuGroups
  }
}
