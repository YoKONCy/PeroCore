/**
 * usePetGateway — 桌宠 Gateway 对话同步 composable
 *
 * 将 Gateway WS 事件同步到桌宠交互层:
 * - stream_delta → 实时追加气泡文字 (逐字显示)
 * - stream_end → 标记回复完成
 * - state_update → 心情/氛围/想法同步
 * - notification → Agent 通知 → 气泡提示
 * - tool_status → 工具执行状态 → 思考气泡
 * - 音频 chunk → usePetAudio 播放链路
 *
 * @module packages/frontend/src/composables/pet/usePetGateway
 */

import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useGateway } from '../gateway/useGateway'
import type { GatewayNotification, TaskProgress } from '../gateway/useGateway'
import { useNotificationStore, usePetStateStore } from '../../stores'
import { agentApi } from '../../api/modules/agentApi'
import { listen } from '../../utils/ipcAdapter'

// ── 导出类型 ──

export interface PetChatState {
  /** 是否正在思考 (等待 AI 回复) */
  isThinking: boolean
  /** 思考阶段描述 */
  thinkingMessage: string
  /** 当前气泡文字 (来自 AI) */
  currentText: string
  /** 心情 */
  mood: string
  /** 氛围 */
  vibe: string
  /** 想法 */
  mind: string
}

/** usePetGateway 配置选项 */
export interface PetGatewayOptions {
  /** Gateway 推送的 TTS 音频 chunk → 播放 */
  onAudioChunk?: (data: ArrayBuffer) => void
}

/**
 * 过滤 Thinking/Monologue 等内部推理内容
 *
 * LLM 输出中包含的 <think>...</think> 标签是内部推理过程，
 * 不应作为可见回复显示给用户。
 * 需要同时处理不完整的标签（如流式输出中标签可能被截断）。
 */
function stripInternalThinking(text: string): { visible: string; hasThinking: boolean } {
  // 检测是否全是内部推理内容（可能被截断）
  const trimmed = text.trim()
  if (!trimmed) return { visible: '', hasThinking: false }

  // <think>...</think>（大小写不敏感，跨行）
  const thinkFullBlockRegex = /<think[\s\S]*?<\/think>/gi
  // 只有开标签没有闭标签（流式输出中闭标签尚未输出）
  const thinkOpenTagOnlyRegex = /^[\s\u3000]*<think[\s\S]*/gi
  // 只有闭标签
  const thinkCloseTagOnlyRegex = /^[\s\u3000]*<\/think>[\s\u3000]*$/gi

  // 移除完整块
  let visible = text.replace(thinkFullBlockRegex, '')
  // 移除只有开标签的行
  visible = visible.replace(thinkOpenTagOnlyRegex, '')
  // 移除只有闭标签的行
  visible = visible.replace(thinkCloseTagOnlyRegex, '')

  // 判断原文本是否包含 Thinking 内容
  const hasThinking =
    thinkFullBlockRegex.test(text) ||
    thinkOpenTagOnlyRegex.test(text) ||
    thinkCloseTagOnlyRegex.test(text)

  return { visible: visible.trim(), hasThinking }
}

/**
 * 聊天错误码 → 用户友好消息
 *
 * 使用看板娘口吻翻译技术错误，让用户不会看到令人困惑的技术术语。
 * 错误码来源: 后端 AppError.code → Gateway RPC error → err.code
 */
const CHAT_ERROR_MESSAGES: Record<string, { title: string; message: string }> = {
  LLM_ERROR: { title: 'AI 服务异常', message: '请检查模型配置后再试试' },
  LLM_RATE_LIMITED: { title: 'AI 服务繁忙', message: '请过一会儿再找我聊天吧~' },
  LLM_TIMEOUT: { title: 'AI 响应超时', message: '要不再试一次？' },
  EMBEDDING_ERROR: { title: '向量服务异常', message: '记忆检索遇到了问题' },
  MODEL_NOT_FOUND: { title: '模型未配置', message: '去设置里添加一个 AI 模型吧~' },
  CONFIG_ERROR: { title: '配置异常', message: '检查一下设置吧' },
  RATE_LIMITED: { title: '请求频率过高', message: '让我休息一下吧~' },
  NETWORK_ERROR: { title: '网络连接失败', message: '检查一下网络连接？' },
  GATEWAY_TIMEOUT: { title: '服务响应超时', message: '后端服务可能在启动中' },
  SERVICE_UNAVAILABLE: { title: '服务不可用', message: '可能在维护中...' },
  SERVICE_INITIALIZING: { title: '服务启动中', message: '马上就好~' },
  GATEWAY_ERROR: { title: '消息发送失败', message: '检查一下后端是否在运行？' },
  DEFAULT: { title: '发送失败', message: '再试一次吧~' },
}

export function usePetGateway(options?: PetGatewayOptions) {
  const petStateStore = usePetStateStore()
  // ── 状态 ──

  const chatState = ref<Omit<PetChatState, 'mood' | 'vibe' | 'mind'>>({
    isThinking: false,
    thinkingMessage: '努力思考中...',
    currentText: '',
  })
  const petStatus = computed(() => petStateStore.stateFor(activeAgentId.value))
  const displayState = computed<PetChatState>(() => ({
    ...chatState.value,
    ...petStatus.value,
  }))

  /** 当前活跃的 session ID */
  const activeSessionId = ref<string | null>(null)
  /** 当前活跃的 agentId (用于过滤 state_update，避免非活跃 agent 的更新污染显示) */
  const activeAgentId = ref('pero')
  /** 是否已收到过真正的可见文本 (非纯 Thinking 内容) */
  let hasReceivedVisibleText = false

  // ── Gateway 连接 ──

  const {
    connect,
    disconnect,
    send,
    request,
    onPush,
    offPush,
    state: wsState,
  } = useGateway({
    // 流式文字 delta (逐字推送)
    onStreamDelta: (data) => {
      // 过滤 Thinking/Monologue 等内部推理内容
      const { visible, hasThinking } = stripInternalThinking(data.content)

      // 追加过滤后的可见文本到 buffer
      if (visible) {
        hasReceivedVisibleText = true
        chatState.value.currentText += visible
      }

      // 只有在收到过真正的可见文本后才退出思考状态
      // 纯 Thinking 内容、工具调用内容等不应触发思考状态结束
      if (hasReceivedVisibleText && !hasThinking) {
        chatState.value.isThinking = false
      }

      activeSessionId.value = data.sessionId
    },

    // 流结束
    onStreamEnd: (_data) => {
      chatState.value.isThinking = false
      // 没有可见文本时清空内容，避免气泡停留在“思考中”旧状态
      if (!hasReceivedVisibleText) {
        chatState.value.currentText = ''
      }
      hasReceivedVisibleText = false
    },

    // 状态更新 (心情/氛围/想法)
    onStateUpdate: (data) => {
      // 仅接受当前活跃 agent 的状态更新 (广播带 agentId，缺省时兼容旧逻辑放行)
      if (data.agentId && data.agentId !== activeAgentId.value) return
      petStateStore.apply(activeAgentId.value, {
        mood: typeof data.mood === 'string' ? data.mood : undefined,
        vibe: typeof data.vibe === 'string' ? data.vibe : undefined,
        mind: typeof data.mind === 'string' ? data.mind : undefined,
      })
      void petStateStore.load(activeAgentId.value)
    },

    // Agent 通知
    onNotification: (notif: GatewayNotification) => {
      chatState.value.currentText = notif.body || notif.title
      chatState.value.isThinking = false
    },

    // 工具执行状态
    onToolStatus: (data) => {
      if (data.state === 'running') {
        chatState.value.isThinking = true
        chatState.value.thinkingMessage = `正在使用工具: ${data.name}...`
      } else if (data.state === 'completed') {
        chatState.value.thinkingMessage = '努力思考中...'
      }
    },

    // 任务进度
    onTaskProgress: (progress: TaskProgress) => {
      if (progress.status === 'running') {
        chatState.value.isThinking = true
        chatState.value.thinkingMessage = progress.message || '任务执行中...'
      } else if (progress.status === 'completed') {
        chatState.value.isThinking = false
      }
    },

    // 心跳
    onHeartbeat: () => {
      // 静默确认
    },

    // TTS 音频 chunk (Gateway 推送, base64 解码后)
    onAudioChunk: (data: ArrayBuffer) => {
      options?.onAudioChunk?.(data)
    },
  })

  // ── 发送消息 ──

  /**
   * 通过 Gateway 发送对话消息
   *
   * @param text - 用户输入文本
   * @param source - 消息来源标识
   */
  async function sendChat(text: string, source = 'desktop'): Promise<void> {
    chatState.value.isThinking = true
    chatState.value.thinkingMessage = '努力思考中...'
    chatState.value.currentText = ''
    hasReceivedVisibleText = false

    try {
      // 每次发送都让后端按当前活跃 Agent 获取最新 Desktop Thread，
      // 保证聊天 Tab 与桌宠始终共享同一份连续历史。
      const response = await request('chat', {
        messages: [{ role: 'user', content: text }],
        source,
        agentId: activeAgentId.value,
        capabilityScope: 'ambient',
      })
      if (typeof response.threadId === 'string') activeSessionId.value = response.threadId
    } catch (err) {
      chatState.value.isThinking = false

      // 错误走 Toast 通知，不污染气泡和聊天记录
      const code = (err as Error & { code?: string })?.code ?? ''
      const info = CHAT_ERROR_MESSAGES[code] || CHAT_ERROR_MESSAGES['DEFAULT']!
      const notif = useNotificationStore()
      notif.toast(info.message, { type: 'error', title: info.title, duration: 6000 })
    }
  }

  /**
   * 中断当前思考任务
   */
  function abortThinking(): void {
    if (!chatState.value.isThinking) return
    // 中断时传 threadId（与发送时一致），为空时不传
    send('abort', { threadId: activeSessionId.value || undefined })
    chatState.value.isThinking = false
    chatState.value.currentText = '(已中断)'
  }

  // ── 加载持久化状态 ──

  /**
   * 启动时从后端拉取持久化的角色状态 (pet_states 表)，
   * 恢复 finish_task 上次写入的 mood/vibe/mind，避免重启后丢失。
   */
  async function loadPetState(agentIdOverride?: string): Promise<void> {
    try {
      const agentId = agentIdOverride ?? (await agentApi.getActive())?.data?.agentId ?? 'pero'
      activeAgentId.value = agentId
      await petStateStore.load(agentId)
    } catch {
      // 静默：拉取失败时保留默认值
    }
  }

  /** 接收后台主动行为，仅显示当前角色的消息。 */
  function handleProactiveMessage(payload: Record<string, unknown>): void {
    if (payload.agentId !== activeAgentId.value || typeof payload.content !== 'string') return
    chatState.value.currentText = payload.content
    chatState.value.isThinking = false
    hasReceivedVisibleText = true
    if (typeof payload.threadId === 'string') activeSessionId.value = payload.threadId
  }

  // ── 生命周期 ──

  /** agent_changed 事件取消监听器 */
  let unlistenAgentChanged: (() => void) | null = null

  onMounted(() => {
    onPush('proactive_message', handleProactiveMessage)
    connect()
    loadPetState()
    // 切换 Agent 时重新拉取对应角色的持久化状态，保证 mood/vibe/mind 跟随切换
    listen('agent_changed', (payload) => {
      const agentId = (payload as { agentId?: unknown } | null)?.agentId
      if (typeof agentId === 'string' && agentId && agentId !== activeAgentId.value) {
        loadPetState(agentId)
      }
    }).then((unlisten) => {
      unlistenAgentChanged = unlisten
    })
  })

  onUnmounted(() => {
    offPush('proactive_message', handleProactiveMessage)
    disconnect()
    unlistenAgentChanged?.()
    unlistenAgentChanged = null
  })

  return {
    /** 视图状态：交互状态与共享三状态的合成结果。 */
    chatState: displayState,
    /** WS 连接状态 */
    wsState,
    /** 当前活跃 session */
    activeSessionId,
    /** 发送聊天消息 */
    sendChat,
    /** 中断思考 */
    abortThinking,
  }
}
