import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { PetConversationTarget } from '@infos/shared'
import { approvalsApi } from '../../api/modules/approvalsApi'
import { agentInputsApi } from '../../api/modules/agentInputsApi'
import { useCompanionActivity } from './useCompanionActivity'
import { useGateway } from '../gateway/useGateway'
import { useWindowVisibility } from '../main/useWindowVisibility'

/** 只保留需要用户处理的摘要，审批、问题和任务正文仍由主应用承载。 */
export function usePetAttention(agentId: Ref<string>) {
  const windowVisible = useWindowVisibility()
  const { activity, summary, needsAttention } = useCompanionActivity(agentId)
  const pending = ref<{
    id: string
    kind: 'approval' | 'question'
    label: string
    target: PetConversationTarget
  } | null>(null)
  const gateway = useGateway()
  let disposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  async function refresh() {
    if (disposed || !windowVisible.value) return
    const id = agentId.value
    const sequence = ++generation
    try {
      const [approvals, inputs] = await Promise.all([
        approvalsApi.list({ status: 'pending', agentId: id }),
        agentInputsApi.list({ status: 'pending', agentId: id }),
      ])
      if (disposed || sequence !== generation) return
      const approval = approvals.data?.requests[0]
      const input = inputs.data?.requests[0]
      pending.value = approval
        ? {
            id: approval.id,
            kind: 'approval',
            label: '需要确认：' + approval.toolName,
            target: { agentId: id, threadId: approval.threadId, taskId: approval.taskId },
          }
        : input
          ? {
              id: input.id,
              kind: 'question',
              label:
                input.questions && input.questions.length > 1
                  ? `有 ${input.questions.length} 个问题想问你`
                  : input.question,
              target: { agentId: id, threadId: input.threadId, taskId: input.taskId },
            }
          : null
    } catch {
      /* 断线时保留已知提醒，重连后恢复。 */
    } finally {
      if (!disposed && windowVisible.value && sequence === generation) {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 30_000)
      }
    }
  }
  const attention = computed(
    () => pending.value?.label || (needsAttention.value ? summary.value : ''),
  )
  const key = computed(
    () =>
      pending.value?.id ||
      (needsAttention.value
        ? JSON.stringify([
            activity.value?.tasks
              .filter((t) => ['waiting_input', 'blocked'].includes(t.status))
              .map((t) => t.id),
            activity.value?.suggestions.filter((s) => s.status === 'open').map((s) => s.id),
            activity.value?.recent
              .filter((t) => t.status === 'failed' && !t.readAt)
              .map((t) => t.id),
            activity.value?.scheduled.filter((s) => s.status === 'failed').map((s) => s.id),
          ])
        : ''),
  )
  const actions = [
    'tool_approval_requested',
    'tool_approval_resolved',
    'agent_input_requested',
    'agent_input_resolved',
  ]
  const invalidate = () => {
    void refresh()
  }
  watch(windowVisible, (visible) => {
    generation++
    clearTimeout(timer)
    if (visible) void refresh()
  })
  watch(agentId, () => {
    pending.value = null
    void refresh()
  })
  watch(gateway.sessionId, (session) => {
    if (session) void refresh()
  })
  onMounted(() => {
    for (const action of actions) gateway.onPush(action, invalidate)
    void refresh()
  })
  onUnmounted(() => {
    disposed = true
    generation++
    clearTimeout(timer)
    for (const action of actions) gateway.offPush(action, invalidate)
  })
  return {
    attention,
    attentionKey: key,
    attentionKind: computed(() => pending.value?.kind ?? 'task'),
    attentionTarget: computed(() => pending.value?.target),
    running: computed(() => activity.value?.tasks.some((t) => t.status === 'running') ?? false),
  }
}
