/**
 * useThreadStore — Thread 状态管理
 *
 * 基于 AIOS 第三阶段 Thread + ContextCompiler 架构，替代旧 useSessionStore。
 * 管理 Thread 内的消息列表、输入、生成状态等。
 * 消息列表使用 shallowRef 以避免深度响应性能问题。
 */

import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { chatApi } from '../api/modules/chatApi'
import { threadsApi } from '../api/modules/threadsApi'
import type { ThreadMessageInfo, ThreadChannel } from '../api/modules/threadsApi'
import { logger } from '../lib/logger'

/** 聊天消息（保持与旧 ChatMessage 接口兼容，避免组件迁移时改动过大） */
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
    /** 工具调用 ID（与 SSE 的 callId 关联） */
    callId?: string
    result?: string
    isError?: boolean
  }>
}

/** 生成状态 */
export type GenerationState = 'idle' | 'thinking' | 'generating' | 'tool_calling'

export const useThreadStore = defineStore('thread', () => {
  // ── 状态 ──
  /** 当前 Thread ID */
  const threadId = ref<string>('')
  /** 当前频道 */
  const channel = ref<ThreadChannel>('desktop')

  /** 消息列表 (shallowRef 避免深度代理) */
  const messages = shallowRef<ChatMessage[]>([])

  /** 当前生成状态 */
  const generationState = ref<GenerationState>('idle')

  /** 用户输入 */
  const inputText = ref('')

  /** 当前正在生成的消息 ID */
  const streamingMessageId = ref<string | null>(null)

  /** 当前 Thread 所属 Agent */
  const agentId = ref<string>('pero')

  /** 历史记录加载状态 */
  const isLoadingHistory = ref(false)

  /** 历史记录加载错误 */
  const historyError = ref<string | null>(null)

  // ── 动作 ──

  /** 添加消息 (触发 shallowRef 更新) */
  function addMessage(msg: ChatMessage) {
    messages.value = [...messages.value, msg]
  }

  /** 将服务端历史消息映射成本地消息 */
  function fromThreadMessage(msg: ThreadMessageInfo, currentAgentId: string): ChatMessage {
    return {
      id: String(msg.id),
      role: msg.role as ChatMessage['role'],
      content: msg.content,
      // 后端字段名为 timestamp（不是 createdAt），缺失时回退当前时间避免 UI 显示空白
      timestamp: msg.timestamp ?? new Date().toISOString(),
      senderId: msg.role === 'assistant' ? currentAgentId : undefined,
      isStreaming: false,
    }
  }

  /** 直接替换当前 Thread 消息，用于服务端历史回灌 */
  function setMessages(nextMessages: ChatMessage[]) {
    messages.value = [...nextMessages]
  }

  /** 从服务端加载指定 Thread 的消息 */
  async function loadThreadMessages(nextThreadId: string, currentAgentId: string) {
    if (!nextThreadId) return

    isLoadingHistory.value = true
    historyError.value = null
    try {
      const res = await threadsApi.get(nextThreadId)
      const data = res.data
      if (!data) throw new Error('服务端未返回 Thread 详情')
      threadId.value = data.thread.id
      agentId.value = currentAgentId
      channel.value = data.thread.channel
      messages.value = data.messages.map((msg) => fromThreadMessage(msg, currentAgentId))
      generationState.value = 'idle'
      streamingMessageId.value = null
    } catch (err) {
      historyError.value = (err as Error).message
      logger.error('ThreadStore', 'Thread 消息加载失败', err)
    } finally {
      isLoadingHistory.value = false
    }
  }

  /** 加载指定 Agent / Channel 的最新 Thread */
  async function loadLatestThread(currentAgentId: string, nextChannel: ThreadChannel = 'desktop') {
    isLoadingHistory.value = true
    historyError.value = null
    try {
      const res = await threadsApi.getLatest({ agentId: currentAgentId, channel: nextChannel })
      const latest = res.data?.thread
      if (!latest) {
        clearThread()
        agentId.value = currentAgentId
        channel.value = nextChannel
        return
      }

      channel.value = latest.channel || nextChannel
      await loadThreadMessages(latest.id, currentAgentId)
    } catch (err) {
      historyError.value = (err as Error).message
      logger.error('ThreadStore', '最新 Thread 加载失败', err)
    } finally {
      isLoadingHistory.value = false
    }
  }

  /** 刷新当前 Thread 消息，用服务端持久化记录校准本地消息 ID */
  async function refreshCurrentThread(currentAgentId = agentId.value) {
    if (!threadId.value) return
    await loadThreadMessages(threadId.value, currentAgentId)
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

  /** 清空当前 Thread */
  function clearThread() {
    messages.value = []
    threadId.value = ''
    generationState.value = 'idle'
    streamingMessageId.value = null
    inputText.value = ''
    historyError.value = null
  }

  /**
   * 编辑指定消息内容 (本地 + 后端同步)
   * 后端路由：PATCH /threads/:threadId/messages/:msgId
   */
  function editMessage(id: string, newContent: string) {
    messages.value = messages.value.map((m) => (m.id === id ? { ...m, content: newContent } : m))
    // 后端同步 (异步，不阻塞 UI)
    if (threadId.value && id) {
      chatApi.editMessage(threadId.value, id, newContent).catch((err) => {
        logger.error('ThreadStore', '消息编辑同步失败', err)
      })
    }
  }

  /**
   * 删除指定消息 (本地 + 后端同步)
   * 后端路由：DELETE /threads/:threadId/messages/:msgId
   */
  function deleteMessage(id: string) {
    messages.value = messages.value.filter((m) => m.id !== id)
    // 后端同步
    if (threadId.value && id) {
      chatApi.deleteMessage(threadId.value, id).catch((err) => {
        logger.error('ThreadStore', '消息删除同步失败', err)
      })
    }
  }

  /** 设置新 Thread */
  function startThread(newThreadId: string, newChannel: ThreadChannel = 'desktop', newAgentId = agentId.value) {
    clearThread()
    threadId.value = newThreadId
    channel.value = newChannel
    agentId.value = newAgentId
  }

  /** 向后端申请并切换到新 Thread */
  async function createNewThread(currentAgentId = agentId.value, nextChannel: ThreadChannel = 'desktop') {
    const res = await threadsApi.create({ agentId: currentAgentId, channel: nextChannel })
    const nextThread = res.data?.thread
    if (!nextThread) throw new Error('服务端未返回新 Thread')
    startThread(nextThread.id, nextThread.channel || nextChannel, currentAgentId)
    logger.info('ThreadStore', `新 Thread 已创建: ${nextThread.id}`)
    return nextThread.id
  }

  /** 是否正在生成 (便捷 getter) */
  const isGenerating = computed(() => generationState.value !== 'idle')

  return {
    threadId,
    channel,
    agentId,
    messages,
    generationState,
    isGenerating,
    inputText,
    streamingMessageId,
    isLoadingHistory,
    historyError,
    addMessage,
    setMessages,
    appendToLast,
    finishStreaming,
    clearThread,
    editMessage,
    deleteMessage,
    startThread,
    createNewThread,
    loadLatestThread,
    loadThreadMessages,
    refreshCurrentThread,
  }
})
