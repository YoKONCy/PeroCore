import {
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import type { TaskPlan } from '@infos/shared'
import { taskPlansApi } from '../../api/modules/taskPlansApi'
import { ApiError } from '../../api/errors'
import { useGateway } from '../gateway/useGateway'

/** REST 提供清单事实；推送合并为刷新，切换与隐藏时废弃迟到响应。 */
export function useThreadPlan(threadId: Ref<string>, agentId: Ref<string>) {
  const plan = shallowRef<TaskPlan | null>(null)
  const gateway = useGateway()
  let active = false
  let generation = 0
  let loading = ''
  let again = false
  let blocked = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function refresh() {
    if (!active || blocked || !threadId.value || !agentId.value) return
    const key = `${generation}:${agentId.value}:${threadId.value}`
    if (loading === key) {
      again = true
      return
    }
    clearTimeout(timer)
    loading = key
    const sequence = generation
    let fatal = false
    try {
      const result = await taskPlansApi.get(threadId.value, agentId.value)
      if (active && sequence === generation) plan.value = result.data ?? null
    } catch (error) {
      fatal =
        error instanceof ApiError &&
        ['NOT_FOUND', 'FORBIDDEN', 'AUTH_REQUIRED', 'UNAUTHORIZED'].includes(error.code)
      if (fatal && sequence === generation) {
        blocked = true
        plan.value = null
      }
    } finally {
      if (loading === key) loading = ''
      if (active && sequence === generation && !fatal) {
        timer = setTimeout(() => void refresh(), again ? 180 : 30_000)
        again = false
      }
    }
  }

  function invalidated(payload: Record<string, unknown>) {
    const task = payload.task as { agentId?: string } | undefined
    if (
      (payload.agentId && payload.agentId !== agentId.value) ||
      (task?.agentId && task.agentId !== agentId.value)
    )
      return
    const action = String(payload.action ?? '')
    if (action === 'plan_changed' && payload.threadId !== threadId.value) return
    if (
      action === 'plan_changed' ||
      action === 'proactive_work_changed' ||
      action.startsWith('background_task_')
    ) {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 100)
    }
  }
  function start() {
    if (active) return
    active = true
    gateway.onPush('*', invalidated)
    gateway.connect()
    void refresh()
  }
  function stop() {
    active = false
    generation++
    clearTimeout(timer)
    gateway.offPush('*', invalidated)
  }
  watch([threadId, agentId], () => {
    generation++
    clearTimeout(timer)
    loading = ''
    again = false
    blocked = false
    plan.value = null
    void refresh()
  })
  watch(gateway.state, (state) => {
    if (state === 'connected') {
      blocked = false
      void refresh()
    }
  })
  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)
  return { plan, refresh }
}
