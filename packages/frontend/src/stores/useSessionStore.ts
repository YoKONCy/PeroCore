/**
 * useSessionStore — 会话状态管理
 *
 * 管理当前聊天会话的消息列表、输入、生成状态等。
 * 消息列表使用 shallowRef 以避免深度响应性能问题。
 *
 * @see 12_FRONTEND_PERFORMANCE.md §3.8
 */

import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'

/** 聊天消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** 时间戳 (ISO) */
  timestamp: string
  /** 是否正在流式生成中 */
  isStreaming?: boolean
  /** 发送者 ID (多 Agent 场景) */
  senderId?: string
  /** 用户消息附带的图片 URLs */
  images?: string[]
  /** 工具调用信息 */
  toolCalls?: Array<{
    name: string
    args: string
    result?: string
    isError?: boolean
  }>
}

/** 生成状态 */
export type GenerationState = 'idle' | 'thinking' | 'generating' | 'tool_calling'

export const useSessionStore = defineStore('session', () => {
  // ── 状态 ──
  const sessionId = ref<string>('')
  const source = ref<string>('desktop')

  /** 消息列表 (shallowRef 避免深度代理) */
  const messages = shallowRef<ChatMessage[]>([])

  /** 当前生成状态 */
  const generationState = ref<GenerationState>('idle')

  /** 用户输入 */
  const inputText = ref('')

  /** 当前正在生成的消息 ID */
  const streamingMessageId = ref<string | null>(null)

  // ── 动作 ──

  /** 添加消息 (触发 shallowRef 更新) */
  function addMessage(msg: ChatMessage) {
    messages.value = [...messages.value, msg]
  }

  /** 更新最后一条消息的内容 (流式追加) */
  function appendToLast(content: string) {
    const list = messages.value
    if (list.length === 0) return

    const last = list[list.length - 1]!
    const updated = { ...last, content: last.content + content }
    messages.value = [...list.slice(0, -1), updated]
  }

  /** 完成流式生成 */
  function finishStreaming() {
    const list = messages.value
    if (list.length === 0) return

    const last = list[list.length - 1]!
    const updated = { ...last, isStreaming: false }
    messages.value = [...list.slice(0, -1), updated]

    generationState.value = 'idle'
    streamingMessageId.value = null
  }

  /** 清空当前会话 */
  function clearSession() {
    messages.value = []
    sessionId.value = ''
    generationState.value = 'idle'
    streamingMessageId.value = null
    inputText.value = ''
  }

  /** 设置新会话 */
  function startSession(newSessionId: string, newSource = 'desktop') {
    clearSession()
    sessionId.value = newSessionId
    source.value = newSource
  }

  /** 是否正在生成 (便捷 getter) */
  const isGenerating = computed(() => generationState.value !== 'idle')

  return {
    sessionId,
    source,
    messages,
    generationState,
    isGenerating,
    inputText,
    streamingMessageId,
    addMessage,
    appendToLast,
    finishStreaming,
    clearSession,
    startSession,
  }
})
