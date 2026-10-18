import type { SurfaceFrame, PetConversationTarget } from '@infos/shared'
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useGateway } from '../gateway/useGateway'
import { usePetStateStore } from '../../stores'
import { threadsApi } from '../../api/modules/threadsApi'
import { agentApi } from '../../api/modules/agentApi'
import { invoke, isElectron, listen } from '../../utils/ipcAdapter'

export interface PetReply extends PetConversationTarget {
  spokenReply: string
}

/** 桌宠只投影对话状态、口语答复与消息位置，不渲染或复制完整正文。 */
export function usePetGateway() {
  const activeAgentId = ref('pero')
  const activeSessionId = ref<string | null>(null)
  const isThinking = ref(false)
  const stage = ref('')
  const hint = ref('')
  const latestReply = ref<PetReply | null>(null)
  const unread = ref(false)
  const petState = usePetStateStore()
  let disposed = false
  let stateGeneration = 0
  let agentGeneration = 0
  let agentReady = false
  let surfaceId = ''
  let presenceGeneration = 0
  let presenceTimer: ReturnType<typeof setInterval> | undefined
  const gateway = useGateway({ onSurface: applySurface })
  const chatState = computed(() => ({
    ...petState.stateFor(activeAgentId.value),
    isThinking: isThinking.value,
    thinkingMessage: stage.value,
  }))
  const conversationTarget = computed<PetConversationTarget>(() => ({
    agentId: activeAgentId.value,
    threadId: activeSessionId.value ?? undefined,
    messageId:
      latestReply.value?.threadId === activeSessionId.value
        ? latestReply.value.messageId
        : undefined,
  }))
  async function publishPresence(): Promise<void> {
    if (!isElectron() || disposed || !agentReady || !gateway.sessionId.value) return
    const generation = ++presenceGeneration
    const session = gateway.sessionId.value
    const agentId = activeAgentId.value
    try {
      const state = (await invoke('get-pet-window-state')) as { visible?: boolean } | null
      if (
        disposed ||
        generation !== presenceGeneration ||
        session !== gateway.sessionId.value ||
        agentId !== activeAgentId.value
      )
        return
      await gateway.request(
        'gateway.pet_presence',
        { agentId, visible: state?.visible === true },
        10_000,
      )
    } catch {
      /* 状态不能确认时不补报显示；连接租约到期后后端自动停用口语提示。 */
    }
  }
  function acceptReply(data: Record<string, unknown>, markUnread = true) {
    if (data.agentId !== activeAgentId.value || typeof data.threadId !== 'string') return
    const messageId = typeof data.messageId === 'string' ? data.messageId : undefined
    if (messageId && latestReply.value?.messageId === messageId) return
    activeSessionId.value = data.threadId
    latestReply.value = {
      agentId: activeAgentId.value,
      threadId: data.threadId,
      messageId,
      spokenReply:
        typeof data.spokenReply === 'string' && data.spokenReply.length <= 240
          ? data.spokenReply
          : '',
    }
    isThinking.value = false
    stage.value = ''
    if (markUnread) unread.value = true
  }
  function applySurface(frame: SurfaceFrame) {
    const operation = frame.operation
    if (operation.type === 'surface.open') {
      if (operation.principalId !== activeAgentId.value) return
      surfaceId = frame.surfaceId
      activeSessionId.value = operation.threadId
      isThinking.value = true
      stage.value = '正在思考'
      return
    }
    if (operation.type === 'surface.commit') {
      if (operation.surface.principalId !== activeAgentId.value) return
      acceptReply({
        agentId: operation.surface.principalId,
        threadId: operation.snapshot.threadId,
        messageId: operation.message.messageId,
        spokenReply: operation.message.spokenReply,
      })
      return
    }
    if (frame.surfaceId !== surfaceId) return
    if (operation.type === 'surface.fail') {
      isThinking.value = false
      latestReply.value = null
      unread.value = true
      hint.value = '回复遇到问题，请在主应用查看'
    } else if (operation.type === 'surface.upsert-node' && operation.node.kind === 'status') {
      const props = operation.node.props as { label?: string; state?: string }
      stage.value =
        props.label || (operation.node.props as { message?: string }).message || '正在处理'
      if (props.state === 'completed' || props.state === 'failed') isThinking.value = false
    }
  }
  function notification(data: Record<string, unknown>) {
    if (data.principalId && data.principalId !== activeAgentId.value) return
    hint.value =
      typeof data.title === 'string' ? data.title.slice(0, 70) : '有新事项，请在主应用查看'
  }
  function stateUpdate(data: Record<string, unknown>) {
    if (data.agentId && data.agentId !== activeAgentId.value) return
    petState.applyPush(data)
  }
  watch(
    [activeAgentId, activeSessionId],
    ([agentId, threadId]) => {
      petState.selectThread(agentId, threadId ?? '')
    },
    { immediate: true },
  )
  async function restore() {
    const agentId = activeAgentId.value
    const generation = ++stateGeneration
    try {
      await gateway.selectPrincipal(agentId)
      if (disposed || generation !== stateGeneration) return
      await publishPresence()
      const latest = await threadsApi.getLatest({ agentId, channel: 'desktop' })
      if (disposed || generation !== stateGeneration) return
      const thread = latest.data?.thread
      if (!thread) return
      activeSessionId.value = thread.id
      await gateway.subscribe('thread:' + thread.id)
      const response = await threadsApi.getProjection(thread.id, { pageSize: 1 })
      if (disposed || generation !== stateGeneration) return
      const message = [...(response.data?.messages ?? [])]
        .reverse()
        .find((item) => item.role === 'assistant')
      if (message && !latestReply.value)
        acceptReply(
          {
            agentId,
            threadId: thread.id,
            messageId: message.messageId,
            spokenReply: message.spokenReply,
          },
          false,
        )
    } catch {
      /* 重连恢复失败时由连接状态提示，保留现有投影。 */
    }
  }
  async function loadAgent(agentId?: string) {
    const generation = ++agentGeneration
    let id = agentId
    if (!id && isElectron()) {
      const selected = await invoke('get-client-default-agent')
      if (typeof selected === 'string' && selected) id = selected
    }
    if (!id) {
      const response = await agentApi.getActive()
      id = response.data?.agentId || response.data?.id || 'pero'
    }
    if (disposed || generation !== agentGeneration) return
    if (agentReady && id === activeAgentId.value) return
    presenceGeneration++
    if (agentReady && gateway.sessionId.value) {
      void gateway
        .request('gateway.pet_presence', { agentId: activeAgentId.value, visible: false }, 1000)
        .catch(() => {})
    }
    stateGeneration++
    agentReady = true
    activeAgentId.value = id
    activeSessionId.value = null
    latestReply.value = null
    unread.value = false
    hint.value = ''
    isThinking.value = false
    surfaceId = ''
    await petState.load(id, '')
    if (disposed || generation !== agentGeneration) return
    await restore()
  }
  async function sendChat(text: string, speak = true): Promise<boolean> {
    if (!text.trim() || isThinking.value) return false
    isThinking.value = true
    stage.value = '正在思考'
    hint.value = ''
    const requestAgentId = activeAgentId.value
    try {
      await gateway.selectPrincipal(requestAgentId, true)
      await publishPresence()
      const response = await gateway.request(
        'chat',
        {
          messages: [{ role: 'user', content: text }],
          source: 'desktop',
          agentId: requestAgentId,
          capabilityScope: 'ambient',
          speak,
        },
        300_000,
      )
      if (activeAgentId.value !== requestAgentId || disposed) return false
      acceptReply({ ...response, agentId: requestAgentId })
      if (activeSessionId.value)
        await gateway.subscribe('thread:' + activeSessionId.value).catch(() => {})
      return true
    } catch {
      if (activeAgentId.value !== requestAgentId || disposed) return false
      isThinking.value = false
      latestReply.value = null
      unread.value = true
      hint.value = '消息发送失败，请检查连接后重试'
      return false
    }
  }
  function stopSpeech(agentId = activeAgentId.value) {
    void gateway.request('stop_speech', { agentId }).catch(() => {})
  }
  function proactiveReply(data: Record<string, unknown>) {
    acceptReply(data)
  }
  const removeAgentListeners: Array<() => void> = []
  function agentChanged(data: unknown) {
    const id = (data as { agentId?: unknown } | null)?.agentId
    if (typeof id === 'string' && id)
      void loadAgent(id).catch(() => {
        if (!disposed) hint.value = '角色信息暂时无法读取'
      })
  }
  function backendAgentChanged(data: Record<string, unknown>) {
    // 桌面端以当前客户端选择为准，Web 端沿用后端活跃角色。
    if (!isElectron()) agentChanged(data)
  }
  async function bindAgentEvent(channel: string) {
    const remove = await listen(channel, agentChanged)
    if (disposed) remove()
    else removeAgentListeners.push(remove)
  }
  async function bindVisibilityEvent() {
    const remove = await listen('pet-window-visibility-changed', () => {
      void publishPresence()
    })
    if (disposed) remove()
    else removeAgentListeners.push(remove)
  }
  watch(gateway.sessionId, (session) => {
    if (session && agentReady) void restore()
  })
  onMounted(() => {
    gateway.onPush('conversation_reply_ready', acceptReply)
    gateway.onPush('proactive_message', proactiveReply)
    gateway.onPush('durable_notification', notification)
    gateway.onPush('state_update', stateUpdate)
    gateway.onPush('agent_changed', backendAgentChanged)
    void gateway.connect()
    presenceTimer = setInterval(() => {
      void publishPresence()
    }, 30_000)
    void (async () => {
      await Promise.all([
        bindAgentEvent('client-agent-changed'),
        bindAgentEvent('agent_changed'),
        bindVisibilityEvent(),
      ])
      if (!disposed) await loadAgent()
    })().catch(() => {
      if (!disposed) hint.value = '角色信息暂时无法读取'
    })
  })
  onUnmounted(() => {
    if (presenceTimer) clearInterval(presenceTimer)
    presenceGeneration++
    if (agentReady && gateway.sessionId.value) {
      void gateway
        .request('gateway.pet_presence', { agentId: activeAgentId.value, visible: false }, 1000)
        .catch(() => {})
    }
    disposed = true
    gateway.offPush('conversation_reply_ready', acceptReply)
    gateway.offPush('proactive_message', proactiveReply)
    gateway.offPush('durable_notification', notification)
    gateway.offPush('state_update', stateUpdate)
    gateway.offPush('agent_changed', backendAgentChanged)
    for (const remove of removeAgentListeners) remove()
    gateway.disconnect()
  })
  return {
    chatState,
    activeAgentId,
    activeSessionId,
    conversationTarget,
    latestReply,
    unread,
    hint,
    wsState: gateway.state,
    sendChat,
    stopSpeech,
    selectPrincipal: gateway.selectPrincipal,
  }
}
