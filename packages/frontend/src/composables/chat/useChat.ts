/**
 * Chat 对话管道 Composable
 *
 * 串联 ThreadStore + ChatApi，管理 SSE 流式对话的完整生命周期：
 * 发送 → thinking → streaming → tool_call → done
 *
 * AIOS 第三阶段：基于 Thread 的对话接口，请求体 `{ threadId, content, agentId? }`。
 *
 * @module packages/frontend/src/composables/chat/useChat
 */

import { computed } from 'vue'
import { useThreadStore } from '../../stores'
import { useAgentStore } from '../../stores'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { chatApi } from '../../api/modules/chatApi'
import { logger } from '../../lib/logger'
import type { ChatRequest } from '../../api/modules/chatApi'
import type { ThreadChannel } from '../../api/modules/threadsApi'

/** useChat 配置 */
export interface UseChatOptions {
  /** 频道标识（替代旧 source） */
  channel?: ThreadChannel
}

export function useChat(options: UseChatOptions = {}) {
  const { channel = 'desktop' } = options

  const threadStore = useThreadStore()
  const agentStore = useAgentStore()
  const notify = useNotificationStore()

  /** 当前是否在生成中 */
  const isGenerating = computed(() => threadStore.isGenerating)

  /** 当前生成状态 */
  const generationState = computed(() => threadStore.generationState)

  /** 消息列表 */
  const messages = computed(() => threadStore.messages)

  /** 历史记录加载状态 */
  const isLoadingHistory = computed(() => threadStore.isLoadingHistory)

  /** 历史记录加载错误 */
  const historyError = computed(() => threadStore.historyError)

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
    if (!trimmed || threadStore.isGenerating) return

    // 确保有后端登记过的 thread
    if (!threadStore.threadId) {
      await threadStore.createNewThread(agentStore.activeAgentId, channel)
    }

    // 1. 添加用户消息
    const userMsg = createMessage('user', trimmed)
    threadStore.addMessage(userMsg)
    threadStore.inputText = ''

    // 2. 添加 assistant 占位消息
    const assistantMsg = createMessage('assistant', '', true)
    threadStore.addMessage(assistantMsg)
    threadStore.streamingMessageId = assistantMsg.id
    threadStore.generationState = 'thinking'

    // 3. 构建请求 — Thread 模式：threadId + content + agentId
    const request: ChatRequest = {
      threadId: threadStore.threadId,
      content: trimmed,
      agentId: agentStore.activeAgentId,
    }

    // 4. 发起 SSE 流
    currentAbort = chatApi.stream(request, {
      onDelta: (data) => {
        // 首次 delta 时切换到 generating 状态
        if (threadStore.generationState === 'thinking') {
          threadStore.generationState = 'generating'
        }
        threadStore.appendToLast(data.content)
      },

      onStatus: (data) => {
        if (data.state === 'thinking') {
          threadStore.generationState = 'thinking'
        } else if (data.state === 'calling') {
          threadStore.generationState = 'tool_calling'
        } else if (data.state === 'generating') {
          threadStore.generationState = 'generating'
        }
      },

      onToolCall: (data) => {
        threadStore.generationState = 'tool_calling'
        // 追加工具调用信息到最后一条消息（带 callId，用于与 tool_result 关联）
        const list = threadStore.messages
        if (list.length === 0) return
        const last = list[list.length - 1]!
        const toolCalls = [
          ...(last.toolCalls || []),
          { name: data.name, args: data.args, callId: data.callId },
        ]
        const updated = { ...last, toolCalls }
        threadStore.messages = [...list.slice(0, -1), updated]
      },

      onToolResult: (data) => {
        // 通过 callId 精确匹配对应的 tool_call，回填 result
        const list = threadStore.messages
        if (list.length === 0) return
        const last = list[list.length - 1]!
        if (!last.toolCalls) return

        const toolCalls = last.toolCalls.map((tc) =>
          tc.callId === data.callId && !tc.result
            ? { ...tc, result: data.result, isError: data.isError }
            : tc,
        )
        const updated = { ...last, toolCalls }
        threadStore.messages = [...list.slice(0, -1), updated]

        // 工具执行完毕，回到 generating
        threadStore.generationState = 'generating'
      },

      onDone: () => {
        threadStore.finishStreaming()
        currentAbort = null
        setTimeout(() => {
          threadStore.refreshCurrentThread(agentStore.activeAgentId).catch((err) => {
            logger.error('useChat', '对话完成后刷新历史失败', err)
          })
        }, 250)
      },

      onError: (data) => {
        // 追加错误信息到消息
        const tail = data.code === 'STREAM_TRUNCATED' ? `\n\n⚠️ [截断] ${data.message}` : `\n\n⚠️ ${data.message}`
        threadStore.appendToLast(tail)
        threadStore.finishStreaming()
        currentAbort = null
        // Toast 通知用户
        notify.toast(data.message || '对话生成失败', 'error')
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

    // 通知后端停止（传 threadId 精确取消）
    if (threadStore.threadId) {
      try {
        await chatApi.stop({ threadId: threadStore.threadId })
      } catch {
        // 忽略停止请求的错误
      }
    }

    threadStore.finishStreaming()
  }

  /** 创建并切换到新的空白 Thread */
  async function createNewThread(agentId = agentStore.activeAgentId): Promise<void> {
    if (threadStore.isGenerating) return
    await threadStore.createNewThread(agentId, channel)
  }

  /** 加载当前 Agent 的最新历史 Thread */
  async function loadLatestHistory(agentId = agentStore.activeAgentId): Promise<void> {
    await threadStore.loadLatestThread(agentId, channel)
  }

  /** 重新发送最后一条用户消息 */
  async function retryLast(): Promise<void> {
    const list = threadStore.messages
    // 找最后一条用户消息
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.role === 'user') {
        const text = list[i]!.content
        // 移除最后的 user + assistant 消息
        threadStore.messages = list.slice(0, i)
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
    isLoadingHistory,
    historyError,

    // 动作
    sendMessage,
    stopGeneration,
    retryLast,
    createNewThread,
    loadLatestHistory,
  }
}
