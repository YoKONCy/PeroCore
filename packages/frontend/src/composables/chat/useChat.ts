/**
 * Chat 对话管道 Composable
 *
 * 串联 SessionStore + ChatApi，管理 SSE 流式对话的完整生命周期：
 * 发送 → thinking → streaming → tool_call → done
 *
 * @module packages/frontend/src/composables/chat/useChat
 */

import { computed } from 'vue'
import { useSessionStore } from '../../stores'
import { useAgentStore } from '../../stores'
import { chatApi } from '../../api/modules/chatApi'
import type { ChatRequest, ChatMessagePayload } from '../../api/modules/chatApi'

/** useChat 配置 */
export interface UseChatOptions {
  /** 消息来源标识 */
  source?: string
}

export function useChat(options: UseChatOptions = {}) {
  const { source = 'desktop' } = options

  const sessionStore = useSessionStore()
  const agentStore = useAgentStore()

  /** 当前是否在生成中 */
  const isGenerating = computed(() => sessionStore.isGenerating)

  /** 当前生成状态 */
  const generationState = computed(() => sessionStore.generationState)

  /** 消息列表 */
  const messages = computed(() => sessionStore.messages)

  /** 当前 AbortController（用于取消流） */
  let currentAbort: AbortController | null = null

  /**
   * 发送消息（流式）
   *
   * 流程：
   * 1. 创建用户消息 → 添加到 store
   * 2. 创建空 assistant 消息占位
   * 3. 发起 SSE 请求 → 增量追加
   * 4. 完成/错误 → 更新状态
   */
  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || sessionStore.isGenerating) return

    // 确保有 session
    if (!sessionStore.sessionId) {
      sessionStore.startSession(`session_${Date.now()}`, source)
    }

    // 1. 添加用户消息
    const userMsg = createMessage('user', trimmed)
    sessionStore.addMessage(userMsg)
    sessionStore.inputText = ''

    // 2. 添加 assistant 占位消息
    const assistantMsg = createMessage('assistant', '', true)
    sessionStore.addMessage(assistantMsg)
    sessionStore.streamingMessageId = assistantMsg.id
    sessionStore.generationState = 'thinking'

    // 3. 构建请求 — 组装 messages 数组 (对齐后端 chatRequestSchema)
    const historyMessages: ChatMessagePayload[] = sessionStore.messages
      .filter((m) => !m.isStreaming) // 排除正在流式的占位消息
      .map((m) => ({ role: m.role as ChatMessagePayload['role'], content: m.content }))

    const request: ChatRequest = {
      messages: historyMessages,
      source,
      agentId: agentStore.activeAgentId,
      sessionId: sessionStore.sessionId,
    }

    // 4. 发起 SSE 流
    currentAbort = chatApi.stream(request, {
      onDelta: (data) => {
        // 首次 delta 时切换到 generating 状态
        if (sessionStore.generationState === 'thinking') {
          sessionStore.generationState = 'generating'
        }
        sessionStore.appendToLast(data.content)
      },

      onStatus: (data) => {
        if (data.state === 'thinking') {
          sessionStore.generationState = 'thinking'
        } else if (data.state === 'tool_call' || data.state === 'calling') {
          sessionStore.generationState = 'tool_calling'
        } else if (data.state === 'generating') {
          sessionStore.generationState = 'generating'
        }
      },

      onToolCall: (data) => {
        sessionStore.generationState = 'tool_calling'
        // 追加工具调用信息到最后一条消息
        const list = sessionStore.messages
        if (list.length === 0) return
        const last = list[list.length - 1]!
        const toolCalls = [...(last.toolCalls || []), { name: data.name, args: data.arguments }]
        const updated = { ...last, toolCalls }
        sessionStore.messages = [...list.slice(0, -1), updated]
      },

      onToolResult: (data) => {
        // 更新最后一个同名工具调用的结果
        const list = sessionStore.messages
        if (list.length === 0) return
        const last = list[list.length - 1]!
        if (!last.toolCalls) return

        const toolCalls = last.toolCalls.map((tc) =>
          tc.name === data.name && !tc.result
            ? { ...tc, result: data.output, isError: data.isError }
            : tc,
        )
        const updated = { ...last, toolCalls }
        sessionStore.messages = [...list.slice(0, -1), updated]

        // 工具执行完毕，回到 generating
        sessionStore.generationState = 'generating'
      },

      onDone: () => {
        sessionStore.finishStreaming()
        currentAbort = null
      },

      onError: (data) => {
        // 追加错误信息到消息
        sessionStore.appendToLast(`\n\n⚠️ ${data.message}`)
        sessionStore.finishStreaming()
        currentAbort = null
      },
    })
  }

  /** 停止当前生成 */
  async function stopGeneration(): Promise<void> {
    // 客户端中断 SSE 流
    if (currentAbort) {
      currentAbort.abort()
      currentAbort = null
    }

    // 通知后端停止（传 sessionId 精确取消）
    try {
      await chatApi.stop({ sessionId: sessionStore.sessionId || undefined })
    } catch {
      // 忽略停止请求的错误
    }

    sessionStore.finishStreaming()
  }

  /** 重新发送最后一条用户消息 */
  async function retryLast(): Promise<void> {
    const list = sessionStore.messages
    // 找最后一条用户消息
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.role === 'user') {
        const text = list[i]!.content
        // 移除最后的 user + assistant 消息
        sessionStore.messages = list.slice(0, i)
        await sendMessage(text)
        return
      }
    }
  }

  /** 创建消息对象 */
  function createMessage(role: 'user' | 'assistant', content: string, isStreaming = false) {
    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      isStreaming,
      senderId: role === 'assistant' ? agentStore.activeAgentId : undefined,
    }
  }

  return {
    // 状态
    messages,
    isGenerating,
    generationState,

    // 动作
    sendMessage,
    stopGeneration,
    retryLast,
  }
}
