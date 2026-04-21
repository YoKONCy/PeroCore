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

import { ref, onMounted, onUnmounted } from 'vue'
import { useGateway } from '../gateway/useGateway'
import type { GatewayNotification, TaskProgress } from '../gateway/useGateway'

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

export function usePetGateway(options?: PetGatewayOptions) {
  // ── 状态 ──

  const chatState = ref<PetChatState>({
    isThinking: false,
    thinkingMessage: '努力思考中...',
    currentText: '',
    mood: '开心',
    vibe: '平静',
    mind: '...',
  })

  /** 流式回复缓冲 */
  let streamBuffer = ''
  /** 当前活跃的 session ID */
  const activeSessionId = ref<string | null>(null)

  // ── Gateway 连接 ──

  const {
    connect,
    disconnect,
    send,
    request,
    state: wsState,
  } = useGateway({
    // 流式文字 delta (逐字推送)
    onStreamDelta: (data) => {
      streamBuffer += data.content
      chatState.value.currentText = streamBuffer
      chatState.value.isThinking = false
      activeSessionId.value = data.sessionId
    },

    // 流结束
    onStreamEnd: (_data) => {
      chatState.value.isThinking = false
      // 保持 currentText 不清空，让气泡继续显示
      streamBuffer = ''
    },

    // 状态更新 (心情/氛围/想法)
    onStateUpdate: (data) => {
      if (data.mood) chatState.value.mood = data.mood as string
      if (data.vibe) chatState.value.vibe = data.vibe as string
      if (data.mind) chatState.value.mind = data.mind as string
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
    streamBuffer = ''

    try {
      // 使用 RPC 请求发送聊天
      await request('chat', {
        messages: [{ role: 'user', content: text }],
        source,
        sessionId: activeSessionId.value || 'default',
      })
    } catch (err) {
      console.error('[PetGateway] 发送消息失败:', err)
      chatState.value.isThinking = false
      chatState.value.currentText = '发送消息失败了...再试一次吧 😿'
    }
  }

  /**
   * 中断当前思考任务
   */
  function abortThinking(): void {
    if (!chatState.value.isThinking) return
    send('abort', { sessionId: activeSessionId.value || 'default' })
    chatState.value.isThinking = false
    chatState.value.currentText = '(已中断)'
  }

  // ── 生命周期 ──

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    disconnect()
  })

  return {
    /** 对话状态 (响应式) */
    chatState,
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
