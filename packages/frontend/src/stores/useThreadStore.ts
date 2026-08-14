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
import type {
  ThreadMessageInfo,
  ThreadChannel,
  ThreadAttachmentInfo,
} from '../api/modules/threadsApi'
import { logger } from '../lib/logger'

/** 聊天消息（保持与旧 ChatMessage 接口兼容，避免组件迁移时改动过大） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** Assistant 原始转写，用于按需展开 Thinking 标签内容。 */
  rawContent?: string | null
  /** 时间戳 (ISO) */
  timestamp: string
  /** 对话对 ID，用于精确级联删除。 */
  pairId?: string | null
  /** 是否正在流式生成中 */
  isStreaming?: boolean
  /** 发送者 ID (多 Agent 场景) */
  senderId?: string
  /** 用户消息附带的图片 URLs（旧字段兼容） */
  images?: string[]
  /** 持久化附件 */
  attachments?: ThreadAttachmentInfo[]
  /** 是否为持久化的图片理解文字档案。 */
  imageTranscription?: boolean
  /** 工具调用信息 */
  toolCalls?: Array<{
    name: string
    args: string
    callId?: string
    result?: string
    isError?: boolean
    /** 工具执行耗时（毫秒） */
    durationMs?: number
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

  /**
   * 消息加载请求序号（非响应式）。
   * 每次 loadThreadMessages 递增；响应返回时若序号已落后，说明有更新的加载请求，
   * 直接丢弃本次结果，避免快速切换会话时旧响应覆盖新会话（竞态防护，等价于任务系统的串行链锁）。
   */
  let loadGeneration = 0
  /** 最新 Thread 查询序号，与具体消息加载分离，避免嵌套加载互相误判过期。 */
  let latestGeneration = 0
  /** 同一 Agent / Channel 的会话确保操作去重，防止多个视图同时创建空会话。 */
  const ensuringThreads = new Map<string, Promise<string>>()

  // ── 动作 ──

  /** 添加消息 (触发 shallowRef 更新) */
  function addMessage(msg: ChatMessage) {
    messages.value = [...messages.value, msg]
  }

  /** 解析 assistant 消息持久化的工具调用元数据。 */
  function parseToolCalls(metadataJson: string): ChatMessage['toolCalls'] {
    try {
      const parsed = JSON.parse(metadataJson) as {
        toolCalls?: Array<{
          name?: unknown
          args?: unknown
          result?: unknown
          durationMs?: unknown
          isError?: unknown
          callId?: unknown
        }>
      }
      if (!Array.isArray(parsed.toolCalls)) return undefined
      return parsed.toolCalls
        .filter((call) => typeof call.name === 'string')
        .map((call) => ({
          name: call.name as string,
          args: JSON.stringify(call.args ?? {}),
          result: typeof call.result === 'string' ? call.result : String(call.result ?? ''),
          durationMs: typeof call.durationMs === 'number' ? call.durationMs : undefined,
          isError: typeof call.isError === 'boolean' ? call.isError : undefined,
          callId: typeof call.callId === 'string' ? call.callId : undefined,
        }))
    } catch {
      return undefined
    }
  }

  /** 判断消息是否为图片理解文字档案。 */
  function isImageTranscription(metadataJson: string): boolean {
    try {
      return (JSON.parse(metadataJson) as { kind?: string }).kind === 'image_transcription'
    } catch {
      return false
    }
  }

  /**
   * 兼容清洗旧版工作区上下文泄漏。
   * 旧版曾把内部 <workspace_context> 直接拼进用户正文并持久化；这里只在展示层剥离末尾标签块。
   */
  function stripLegacyWorkspaceContext(content: string): string {
    return content.replace(/\s*<workspace_context>[\s\S]*?<\/workspace_context>\s*$/i, '').trimEnd()
  }

  /** 将服务端历史消息映射成本地消息 */
  function fromThreadMessage(msg: ThreadMessageInfo, currentAgentId: string): ChatMessage {
    return {
      id: String(msg.id),
      role: msg.role as ChatMessage['role'],
      content: msg.role === 'user' ? stripLegacyWorkspaceContext(msg.content) : msg.content,
      rawContent: msg.rawContent,
      // 后端字段名为 timestamp（不是 createdAt），缺失时回退当前时间避免 UI 显示空白
      timestamp: msg.timestamp ?? new Date().toISOString(),
      attachments: msg.attachments,
      pairId: msg.pairId,
      senderId: msg.role === 'assistant' ? currentAgentId : undefined,
      toolCalls: msg.role === 'assistant' ? parseToolCalls(msg.metadataJson) : undefined,
      imageTranscription: isImageTranscription(msg.metadataJson),
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

    const generation = ++loadGeneration
    isLoadingHistory.value = true
    historyError.value = null
    try {
      const res = await threadsApi.get(nextThreadId)
      if (generation !== loadGeneration) return // 已被更新的加载请求取代，丢弃过期响应
      const data = res.data
      if (!data) throw new Error('服务端未返回 Thread 详情')
      if (data.thread.agentId !== currentAgentId) {
        throw new Error(
          `会话归属不匹配：${data.thread.id} 属于 ${data.thread.agentId}，不是 ${currentAgentId}`,
        )
      }
      threadId.value = data.thread.id
      agentId.value = data.thread.agentId
      channel.value = data.thread.channel
      // 服务端分页按最新在前返回；聊天画布必须按实际发生顺序从上到下渲染。
      messages.value = [...data.messages]
        .reverse()
        .map((msg) => fromThreadMessage(msg, currentAgentId))
      generationState.value = 'idle'
      streamingMessageId.value = null
    } catch (err) {
      if (generation !== loadGeneration) return // 过期请求的错误也丢弃，避免污染当前状态
      historyError.value = (err as Error).message
      logger.error('ThreadStore', 'Thread 消息加载失败', err)
    } finally {
      if (generation === loadGeneration) isLoadingHistory.value = false
    }
  }

  /** 加载指定 Agent / Channel 的最新 Thread */
  async function loadLatestThread(currentAgentId: string, nextChannel: ThreadChannel = 'desktop') {
    const generation = ++latestGeneration
    // Agent 切换开始即清除旧 Thread，禁止 UI 在异步窗口内形成“新 Agent + 旧 Thread”。
    clearThread()
    agentId.value = currentAgentId
    channel.value = nextChannel
    isLoadingHistory.value = true
    historyError.value = null
    try {
      const res = await threadsApi.getLatest({ agentId: currentAgentId, channel: nextChannel })
      if (generation !== latestGeneration) return
      const latest = res.data?.thread
      if (!latest) throw new Error('服务端未返回最近会话')
      if (latest.agentId !== currentAgentId) throw new Error('服务端返回了其他 Agent 的最新会话')

      channel.value = latest.channel || nextChannel
      await loadThreadMessages(latest.id, currentAgentId)
    } catch (err) {
      if (generation !== latestGeneration) return
      // 加载失败保持安全空状态，绝不恢复旧角色 Thread。
      clearThread()
      agentId.value = currentAgentId
      channel.value = nextChannel
      historyError.value = (err as Error).message
      logger.error('ThreadStore', '最新 Thread 加载失败', err)
    } finally {
      if (generation === latestGeneration) isLoadingHistory.value = false
    }
  }

  /** 激活指定 Agent 的最近 conversation Thread；后端在不存在时原子创建。 */
  async function ensureLatestThread(
    currentAgentId: string,
    nextChannel: ThreadChannel = 'desktop',
  ): Promise<string> {
    const key = `${currentAgentId}:${nextChannel}`
    const pending = ensuringThreads.get(key)
    if (pending) return pending

    const operation = (async () => {
      await loadLatestThread(currentAgentId, nextChannel)
      if (!threadId.value || agentId.value !== currentAgentId) {
        throw new Error('最近会话激活失败')
      }
      return threadId.value
    })()
    ensuringThreads.set(key, operation)
    try {
      return await operation
    } finally {
      if (ensuringThreads.get(key) === operation) ensuringThreads.delete(key)
    }
  }

  /** 刷新当前 Thread 消息，用服务端持久化记录校准本地消息 ID。 */
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
  function startThread(
    newThreadId: string,
    newChannel: ThreadChannel = 'desktop',
    newAgentId = agentId.value,
  ) {
    clearThread()
    threadId.value = newThreadId
    channel.value = newChannel
    agentId.value = newAgentId
  }

  /** 向后端申请并切换到新 Thread */
  async function createNewThread(
    currentAgentId = agentId.value,
    nextChannel: ThreadChannel = 'desktop',
  ) {
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
    ensureLatestThread,
    loadThreadMessages,
    refreshCurrentThread,
  }
})
