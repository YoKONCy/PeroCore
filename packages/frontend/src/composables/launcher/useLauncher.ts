/**
 * useLauncher — 启动器流程 composable
 *
 * 管理启动流程状态机: connecting → checking → ready → entering → done
 *
 * 正确流程:
 *   主进程启动后端 → 等待后端就绪 → EULA → 系统检查 → 就绪 → 新手引导(可选)
 *   → 点击启动 → 隐藏 Launcher → 拉起 Pet3D 桌宠窗口
 *
 * Pet3D 桌宠是整个应用的核心入口，Chat/Dashboard 从桌宠或托盘拉起。
 *
 * @module packages/frontend/src/composables/launcher/useLauncher
 */
import { ref, computed } from 'vue'
import { systemApi } from '../../api/modules/systemApi'
import { configApi } from '../../api/modules/configApi'
import { modelApi } from '../../api/modules/modelApi'
import { memoryApi } from '../../api/modules/memoryApi'
import { agentApi } from '../../api/modules/agentApi'
import { invoke, isElectron } from '../../utils/ipcAdapter'
import { logger } from '../../lib/logger'

export type LaunchPhase = 'connecting' | 'checking' | 'ready' | 'entering' | 'done'

export interface CheckItem {
  id: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'warn' | 'error'
  message?: string
}

export function useLauncher() {
  const phase = ref<LaunchPhase>('connecting')
  const progress = ref(0)
  const errorMessage = ref('')

  /** 启动进度文字 (entering 阶段专用) */
  const enteringText = ref('正在启动...')

  const showEula = ref(false)
  const eulaChecked = ref(false)

  const showOnboarding = ref(false)
  const onboardingCompleted = ref(false)

  const checks = ref<CheckItem[]>([
    { id: 'backend', label: '后端服务', status: 'pending' },
    { id: 'database', label: '数据库连接', status: 'pending' },
    { id: 'model', label: '模型可用性', status: 'pending' },
    { id: 'memory', label: '记忆系统', status: 'pending' },
    { id: 'extension', label: 'Agent 系统', status: 'pending' },
  ])

  const allChecksOk = computed(() =>
    checks.value.every((c) => c.status === 'ok' || c.status === 'warn'),
  )
  const hasError = computed(() => checks.value.some((c) => c.status === 'error'))

  // ── EULA 操作 ──

  /**
   * 检查 EULA 状态
   * 搬迁自 v1: LauncherView.loadConfig() → config.eula_accepted 检查
   */
  async function checkEulaStatus(): Promise<void> {
    try {
      const res = await configApi.get('eula_accepted')
      const accepted = res.data?.value === 'true'
      if (!accepted) {
        showEula.value = true
      } else {
        eulaChecked.value = true
        // EULA 已接受 → 检查引导状态 (否则 onboardingCompleted 永远是 false)
        await checkOnboardingStatus()
      }
    } catch {
      // 配置不存在 = 新用户 → 需要 EULA
      showEula.value = true
    }
  }

  /**
   * 用户同意 EULA
   * 搬迁自 v1: LauncherView.handleAcceptEula()
   */
  async function acceptEula(): Promise<void> {
    try {
      await configApi.set('eula_accepted', 'true')
      showEula.value = false
      eulaChecked.value = true
      errorMessage.value = ''

      // 检查引导状态 — EULA 通过后才可能触发引导
      await checkOnboardingStatus()
      await runChecks()
    } catch (e) {
      logger.error('Launcher', '保存 EULA 状态失败', e)
      errorMessage.value = '保存用户协议状态失败，请确认后端服务已启动后重试'
    }
  }

  /**
   * 用户拒绝 EULA → 退出应用
   * 搬迁自 v1: LauncherView.handleDeclineEula()
   */
  async function declineEula(): Promise<void> {
    await invoke('quit-app')
  }

  // ── 新手引导操作 ──

  /** 检查新手引导是否已完成 */
  async function checkOnboardingStatus(): Promise<void> {
    try {
      const res = await configApi.get('onboarding_completed')
      const completed = res.data?.value
      if (!completed || completed === 'false') {
        // 新用户，引导在就绪后触发
        onboardingCompleted.value = false
      } else {
        onboardingCompleted.value = true
      }
    } catch {
      // 配置不存在 = 新用户
      onboardingCompleted.value = false
    }
  }

  /**
   * 引导完成回调
   * 搬迁自 v1: LauncherView.handleOnboardingFinish()
   */
  async function finishOnboarding(): Promise<void> {
    showOnboarding.value = false
    try {
      await configApi.set('onboarding_completed', 'launcher_done')
      onboardingCompleted.value = true
    } catch (e) {
      logger.error('Launcher', '保存引导状态失败', e)
    }
  }

  // ── 各项检查的具体实现 ──

  /** 检查后端服务是否可达 */
  async function checkBackend(item: CheckItem): Promise<void> {
    try {
      const res = await systemApi.health()
      if (res.data?.status === 'ok') {
        item.status = 'ok'
        item.message = '正常'
      } else {
        item.status = 'ok'
        item.message = '已连接'
      }
    } catch {
      item.status = 'error'
      item.message = '无法连接后端服务'
    }
  }

  /** 检查数据库连接（通过 batch 接口探测，避免 404 WARN 日志） */
  async function checkDatabase(item: CheckItem): Promise<void> {
    try {
      // 用 batch 接口：即使 key 不存在也返回 200，不会触发后端 WARN
      await configApi.batch(['system.initialized'])
      item.status = 'ok'
      item.message = '正常'
    } catch {
      item.status = 'error'
      item.message = '数据库连接失败'
    }
  }

  /** 检查是否至少有一个模型配置 */
  async function checkModel(item: CheckItem): Promise<void> {
    try {
      const res = await modelApi.list()
      const count = res.data?.length ?? 0
      if (count > 0) {
        item.status = 'ok'
        item.message = `${count} 个模型`
      } else {
        // 新用户未配置模型是正常的，不需要警告
        item.status = 'ok'
        item.message = '待配置'
      }
    } catch {
      item.status = 'ok'
      item.message = '待配置'
    }
  }

  /** 检查记忆系统（通过尝试查询） */
  async function checkMemory(item: CheckItem): Promise<void> {
    try {
      await memoryApi.list({ page: 1, pageSize: 1 })
      item.status = 'ok'
      item.message = '正常'
    } catch {
      item.status = 'warn'
      item.message = '记忆系统未就绪'
    }
  }

  /** 检查 Agent 系统 */
  async function checkAgents(item: CheckItem): Promise<void> {
    try {
      const res = await agentApi.list()
      const count = res.data?.length ?? 0
      if (count > 0) {
        item.status = 'ok'
        item.message = `${count} 个 Agent`
      } else {
        // 新用户无 Agent 是正常的
        item.status = 'ok'
        item.message = '待初始化'
      }
    } catch {
      item.status = 'ok'
      item.message = '待初始化'
    }
  }

  // ── 检查执行器映射 ──

  const CHECK_HANDLERS: Record<string, (item: CheckItem) => Promise<void>> = {
    backend: checkBackend,
    database: checkDatabase,
    model: checkModel,
    memory: checkMemory,
    extension: checkAgents,
  }

  /** 逐项执行检查 */
  async function runChecks(): Promise<void> {
    phase.value = 'checking'

    for (let i = 0; i < checks.value.length; i++) {
      const item = checks.value[i]!
      item.status = 'running'

      const handler = CHECK_HANDLERS[item.id]
      if (handler) {
        await handler(item)
      } else {
        item.status = 'ok'
        item.message = '跳过'
      }

      progress.value = Math.round(((i + 1) / checks.value.length) * 100)
    }

    phase.value = hasError.value ? 'checking' : 'ready'

    // 就绪后，如果引导未完成，自动触发引导
    if (phase.value === 'ready' && !onboardingCompleted.value && eulaChecked.value) {
      showOnboarding.value = true
    }
  }

  /** 开始启动流程 */
  async function startLaunch(): Promise<void> {
    phase.value = 'connecting'
    progress.value = 0
    errorMessage.value = ''
    showEula.value = false
    checks.value.forEach((c) => {
      c.status = 'pending'
      c.message = undefined
    })

    // Electron 主进程会随应用自动拉起后端；启动器先等待后端，再读取 EULA/角色等热更新配置
    if (isElectron()) {
      const backendReady = await waitForBackend(30000)
      if (!backendReady) {
        errorMessage.value = '后端服务启动超时，请重启应用或查看日志'
        const backendCheck = checks.value.find((c) => c.id === 'backend')
        if (backendCheck) {
          backendCheck.status = 'error'
          backendCheck.message = '后端服务启动超时'
        }
        phase.value = 'checking'
        return
      }
    }

    await checkEulaStatus()
    if (showEula.value) {
      phase.value = 'checking'
      return
    }

    // 给 UI 一点缓冲时间展示 connecting 动画
    await new Promise((r) => setTimeout(r, 400))
    await runChecks()
  }

  /**
   * 进入应用 — 唤出桌宠入口
   *
   * Electron: 确认后端可用 → 隐藏 Launcher → 拉起 Pet3D 桌宠窗口。
   * Browser/Docker: 直接跳转到 /app。
   *
   * @returns 'pet' | 'browser' — 表示启动目标，供 View 层决定后续行为
   */
  async function enterApp(): Promise<'pet' | 'browser'> {
    phase.value = 'entering'

    if (!isElectron()) {
      // Docker/浏览器模式: 后端已经独立运行，直接跳转
      enteringText.value = '正在进入...'
      phase.value = 'done'
      return 'browser'
    }

    try {
      enteringText.value = '正在确认后端服务状态...'
      const backendReady = await waitForBackend(30000)
      if (!backendReady) {
        throw new Error('后端服务未就绪')
      }

      // 第 1 步: 先隐藏 Launcher，避免后续窗口事件触发竞争
      enteringText.value = '正在召唤 Pero 出现在桌面上...'
      logger.info('Launcher', '先隐藏 Launcher 窗口')
      await invoke('hide-launcher')

      // 第 2 步: 拉起 Pet3D 桌宠窗口 (核心入口！)
      logger.info('Launcher', '正在创建 Pet3D 窗口...')
      await invoke('open-pet-window')

      // 第 3 步: 短暂等待 Pet3D 渲染就绪
      await new Promise((r) => setTimeout(r, 500))
      enteringText.value = '欢迎回来，主人！'

      phase.value = 'done'
      return 'pet'
    } catch (e) {
      logger.error('Launcher', '启动流程出错', e)
      enteringText.value = '启动出错，请重试'
      errorMessage.value = `启动失败: ${e}`
      // 回退到 ready 状态，允许用户重试
      phase.value = 'ready'
      return 'pet'
    }
  }

  /**
   * 轮询等待后端 health 接口就绪
   * @param timeoutMs 超时时间 (毫秒)
   * @returns 是否在超时前就绪
   */
  async function waitForBackend(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    const interval = 1000 // 每秒检测一次

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await systemApi.health()
        if (res.data?.status === 'ok') {
          logger.info('Launcher', '后端已就绪!')
          return true
        }
      } catch {
        // 后端尚未就绪，继续等待
      }
      await new Promise((r) => setTimeout(r, interval))
    }

    return false
  }

  /** 重试 */
  function retry(): void {
    void startLaunch()
  }

  /** 手动触发 EULA 弹窗 */
  function triggerEula(): void {
    showEula.value = true
  }

  /** 手动触发新手引导 */
  function triggerOnboarding(): void {
    showOnboarding.value = true
  }

  return {
    // 原有
    phase,
    progress,
    errorMessage,
    checks,
    allChecksOk,
    hasError,
    startLaunch,
    enterApp,
    retry,
    // 启动进度文字
    enteringText,
    // EULA
    showEula,
    acceptEula,
    declineEula,
    triggerEula,
    // 引导
    showOnboarding,
    finishOnboarding,
    triggerOnboarding,
  }
}
