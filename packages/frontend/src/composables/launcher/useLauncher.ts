/**
 * useLauncher — 启动器流程 composable
 *
 * 管理启动流程状态机: connecting → checking → ready → entering → done
 * F1 阶段: mock 延时模拟，F3 替换为真实 API 健康检查。
 */
import { ref, computed } from 'vue'

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

  const checks = ref<CheckItem[]>([
    { id: 'backend', label: '后端服务', status: 'pending' },
    { id: 'database', label: '数据库连接', status: 'pending' },
    { id: 'model', label: '模型可用性', status: 'pending' },
    { id: 'memory', label: '记忆系统', status: 'pending' },
    { id: 'extension', label: '扩展加载', status: 'pending' },
  ])

  const allChecksOk = computed(() => checks.value.every((c) => c.status === 'ok' || c.status === 'warn'))
  const hasError = computed(() => checks.value.some((c) => c.status === 'error'))

  // 模拟逐项检查
  async function runChecks() {
    phase.value = 'checking'
    for (let i = 0; i < checks.value.length; i++) {
      checks.value[i].status = 'running'
      // TODO: F3 替换为真实健康检查 API
      await delay(400 + Math.random() * 300)
      checks.value[i].status = 'ok'
      checks.value[i].message = '正常'
      progress.value = Math.round(((i + 1) / checks.value.length) * 100)
    }
    phase.value = 'ready'
  }

  async function startLaunch() {
    phase.value = 'connecting'
    progress.value = 0
    errorMessage.value = ''
    checks.value.forEach((c) => { c.status = 'pending'; c.message = undefined })
    await delay(600)
    await runChecks()
  }

  function enterApp() {
    phase.value = 'entering'
    setTimeout(() => { phase.value = 'done' }, 500)
  }

  function retry() {
    startLaunch()
  }

  return {
    phase, progress, errorMessage,
    checks, allChecksOk, hasError,
    startLaunch, enterApp, retry,
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
