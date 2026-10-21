import { t as __t } from '../../i18n/index'
import {
  computed,
  inject,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue'
import { schedulerApi, type CompanionActivity } from '../../api/modules/schedulerApi'
import { useGateway } from '../gateway/useGateway'
import { ApiError } from '../../api/errors'
import { useWindowVisibility } from '../main/useWindowVisibility'

/** REST 是活动事实来源；Gateway 只触发刷新，角色切换后丢弃旧请求结果。 */
export function useCompanionActivity(agentId: Ref<string>) {
  const windowVisible = useWindowVisibility()
  const mainSurface = inject<Ref<boolean>>('infos:main-surface-visible', ref(true))
  let mounted = false
  let componentVisible = true
  const activity = ref<CompanionActivity | null>(null)
  const error = ref('')
  const busy = ref(false)
  let active = false
  let generation = 0
  let loadingAgent: string | null = null
  let loadingGeneration = -1
  let refreshAgain = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const gateway = useGateway()

  function clearTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  async function refresh(): Promise<void> {
    if (!active || !agentId.value) return
    const id = agentId.value
    if (loadingAgent === id) {
      refreshAgain = true
      return
    }
    clearTimer()
    const requestGeneration = generation
    let fatal = false
    loadingAgent = id
    loadingGeneration = requestGeneration
    try {
      const response = await schedulerApi.activity(id)
      if (active && requestGeneration === generation && id === agentId.value) {
        activity.value = response.data ?? null
        error.value = ''
      }
    } catch (cause) {
      fatal =
        cause instanceof ApiError &&
        ['FORBIDDEN', 'NOT_FOUND', 'AUTH_REQUIRED', 'UNAUTHORIZED'].includes(cause.code)
      if (active && requestGeneration === generation)
        error.value = cause instanceof Error ? cause.message : '活动状态加载失败'
    } finally {
      if (loadingAgent === id && loadingGeneration === requestGeneration) loadingAgent = null
      if (active && requestGeneration === generation && !fatal) {
        const delay = refreshAgain ? 250 : 30_000
        refreshAgain = false
        timer = setTimeout(() => void refresh(), delay)
      }
    }
  }

  const summary = computed(() => {
    if (error.value) return __t('ui.pet', '工作状态暂不可用')
    const state = activity.value
    if (!state) return __t('ui.pet', '正在读取工作状态…')
    const waiting = state.tasks.find((task) => ['waiting_input', 'blocked'].includes(task.status))
    if (waiting) return __t('ui.pet', '需要你：{0}', [waiting.title])
    const suggestions = state.suggestions.filter((item) => item.status === 'open')
    if (suggestions.length) return __t('ui.pet', '有 {0} 条建议待处理', [suggestions.length])
    if (state.scheduled.some((item) => item.status === 'failed'))
      return __t('ui.pet', '有计划派发失败，需要查看')
    const failed = state.recent.find((task) => task.status === 'failed' && !task.readAt)
    if (failed) return __t('ui.pet', '任务遇到问题：{0}', [failed.title])
    const running = state.tasks.find((task) => task.status === 'running')
    if (running) return __t('ui.pet', '正在处理：{0}', [running.title])
    if (state.tasks.length) return __t('ui.pet', '有 {0} 项工作等待继续', [state.tasks.length])
    if (state.scheduled.length)
      return __t('ui.pet', '已安排 {0} 项提醒与跟进', [state.scheduled.length])
    return __t('ui.pet', '暂时没有待处理事项')
  })
  const needsAttention = computed(
    () =>
      !!activity.value &&
      (activity.value.suggestions.some((item) => item.status === 'open') ||
        activity.value.tasks.some((task) => ['waiting_input', 'blocked'].includes(task.status)) ||
        activity.value.scheduled.some((item) => item.status === 'failed') ||
        activity.value.recent.some((task) => task.status === 'failed' && !task.readAt)),
  )

  async function perform(action: () => Promise<unknown>): Promise<void> {
    if (busy.value) return
    busy.value = true
    const requestGeneration = generation
    try {
      await action()
      if (requestGeneration === generation) await refresh()
    } catch (cause) {
      if (requestGeneration === generation)
        error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
    } finally {
      busy.value = false
    }
  }

  function invalidated(payload: Record<string, unknown>) {
    if (payload.agentId && payload.agentId !== agentId.value) return
    if (
      payload.action === 'proactive_work_changed' ||
      String(payload.action ?? '').startsWith('background_task_')
    )
      void refresh()
  }
  function start() {
    if (active || !mounted || !componentVisible || !windowVisible.value || !mainSurface.value)
      return
    active = true
    gateway.onPush('*', invalidated)
    gateway.connect()
    void refresh()
  }
  function stop() {
    active = false
    generation++
    loadingAgent = null
    clearTimer()
    gateway.offPush('*', invalidated)
  }
  watch(agentId, () => {
    generation++
    activity.value = null
    error.value = ''
    loadingAgent = null
    refreshAgain = false
    void refresh()
  })
  watch(gateway.state, (state) => {
    if (state === 'connected') void refresh()
  })
  watch([windowVisible, mainSurface], () => {
    stop()
    start()
  })
  onMounted(() => {
    mounted = true
    start()
  })
  onActivated(() => {
    componentVisible = true
    start()
  })
  onDeactivated(() => {
    componentVisible = false
    stop()
  })
  onUnmounted(stop)

  return { activity, summary, needsAttention, error, busy, refresh, perform }
}
