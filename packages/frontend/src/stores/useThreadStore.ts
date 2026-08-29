/**
 * useThreadStore — Thread 状态管理
 *
 * 基于 AIOS 第三阶段 Thread + ContextCompiler 架构，替代旧 useSessionStore。
 * 管理 Thread 内的消息列表、输入、生成状态等。
 * 消息列表使用 shallowRef 以避免深度响应性能问题。
 */

import type { ConversationMessageProjection, SurfaceFrame } from '@infos/shared'
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { chatApi } from '../api/modules/chatApi'
import { threadsApi } from '../api/modules/threadsApi'
import type { ThreadChannel, ThreadAttachmentInfo } from '../api/modules/threadsApi'
import { logger } from '../lib/logger'
import { useCompositorStore } from './useCompositorStore'

export interface RagFailureTrace {
  kind: 'embedding' | 'rag'
  message: string
}

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
  revision?: number
  /** 当前流式消息对应的 Internal Surface。 */
  surfaceId?: string
  /** 当前回复携带的 RAG 降级轨迹。 */
  ragFailureTrace?: RagFailureTrace
  /** Assistant 可见输出的总 Token。 */
  outputTokens?: number
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
  const compositor = useCompositorStore()
  // ── 状态 ──
  /** 当前 Thread ID */
  const threadId = ref<string>('')
  /** 当前频道 */
  const channel = ref<ThreadChannel>('desktop')

  /** 消息列表 (shallowRef 避免深度代理) */
  const messages = shallowRef<ChatMessage[]>([])

  /** 当前生成状态 */
  const generationState = ref<GenerationState>('idle')

  /** 模型调用前自动 RAG 的实时阶段文案。 */
  const ragProgressMessage = ref<string | null>(null)
  const ragFailureTrace = ref<RagFailureTrace | null>(null)

  /** 用户输入 */
  const inputText = ref('')

  /** 当前正在生成的消息 ID */
  const streamingMessageId = ref<string | null>(null)

  /** 当前 Thread 所属 Agent */
  const agentId = ref<string>('pero')

  /** 历史记录加载状态 */
  const isLoadingHistory = ref(false)
  const isLoadingOlderHistory = ref(false)
  const hasMoreHistory = ref(false)
  const historyCursor = ref<string | undefined>(undefined)
  const HISTORY_PAGE_SIZE = 60

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

  function installLocalMessageSurface(
    localId: string,
    content: string,
    attachments: import('../api/modules/attachmentsApi').AttachmentInfo[] = [],
  ): string {
    return compositor.installLocalMessage({
      localId,
      threadId: threadId.value,
      principalId: agentId.value,
      content,
      attachments,
    })
  }

  /** 添加消息 (触发 shallowRef 更新) */
  function addMessage(msg: ChatMessage) {
    messages.value = [...messages.value, msg]
  }

  /** 直接替换当前 Thread 消息，用于服务端历史回灌 */
  function setMessages(nextMessages: ChatMessage[]) {
    messages.value = [...nextMessages]
  }

  /** 将 Projection 消息映射为仅承担布局与业务操作的本地 Shell。 */
  function fromProjection(message: ConversationMessageProjection): ChatMessage {
    return {
      id: message.messageId,
      role: message.role,
      content: message.content,
      rawContent: message.rawContent,
      timestamp: message.timestamp,
      pairId: message.pairId,
      revision: message.revision,
      surfaceId: `conversation-message:${message.messageId}`,
      senderId: message.senderId ?? message.agentId ?? undefined,
      attachments: message.attachments.map((item) => ({
        id: item.id,
        threadId: message.threadId,
        messageId: Number(message.messageId),
        kind: item.kind as ThreadAttachmentInfo['kind'],
        originalName: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        contextPolicy: 'once',
        status: 'bound',
      })),
      imageTranscription: message.imageTranscription,
      outputTokens: message.outputTokens,
      isStreaming: false,
    }
  }

  function openSurfaceForThread(targetThreadId: string) {
    return [...compositor.surfaces.values()]
      .filter((surface) => surface.threadId === targetThreadId && surface.state === 'open')
      .sort((left, right) => right.sequence - left.sequence)[0]
  }

  function generationStateFromSurface(
    surface: ReturnType<typeof openSurfaceForThread>,
  ): GenerationState {
    const status = surface?.nodes.find((node) => node.kind === 'status')
    const state = (status?.props as { state?: string } | undefined)?.state
    if (state === 'calling') return 'tool_calling'
    if (state === 'generating') return 'generating'
    return 'thinking'
  }

  function restoreStreamingShell(
    persisted: ChatMessage[],
    targetThreadId: string,
    targetAgentId: string,
  ): ChatMessage[] {
    const surface = openSurfaceForThread(targetThreadId)
    const existing = messages.value.find(
      (message) => message.isStreaming && (!surface || message.surfaceId === surface.surfaceId),
    )
    if (!surface && existing && generationState.value !== 'idle') {
      streamingMessageId.value = existing.id
      return [...persisted.filter((message) => message.id !== existing.id), existing]
    }
    if (!surface) {
      generationState.value = 'idle'
      streamingMessageId.value = null
      return persisted
    }
    const shell: ChatMessage = existing ?? {
      id: `streaming:${surface.executionId ?? surface.surfaceId}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      senderId: targetAgentId,
      surfaceId: surface.surfaceId,
      isStreaming: true,
    }
    streamingMessageId.value = shell.id
    generationState.value = generationStateFromSurface(surface)
    return [...persisted.filter((message) => message.id !== shell.id), shell]
  }

  /** 从权威 Projection 加载指定 Thread 的消息，并保留当前运行中的 Surface Shell。 */
  async function loadThreadMessages(nextThreadId: string, currentAgentId: string) {
    if (!nextThreadId) return

    const generation = ++loadGeneration
    isLoadingHistory.value = true
    historyError.value = null
    try {
      const [threadResponse, projectionResponse] = await Promise.all([
        threadsApi.get(nextThreadId, { page: 1, pageSize: 1 }),
        threadsApi.getProjection(nextThreadId, { pageSize: HISTORY_PAGE_SIZE }),
      ])
      if (generation !== loadGeneration) return
      const thread = threadResponse.data?.thread
      const projection = projectionResponse.data
      if (!thread || !projection) throw new Error('服务端未返回 Conversation Projection')
      if (thread.agentId !== currentAgentId || projection.principalId !== currentAgentId) {
        throw new Error(
          `会话归属不匹配：${thread.id} 属于 ${thread.agentId}，不是 ${currentAgentId}`,
        )
      }
      threadId.value = thread.id
      agentId.value = thread.agentId
      channel.value = thread.channel
      compositor.replaceSnapshot(projection)
      historyCursor.value = projection.beforeCursor
      hasMoreHistory.value = projection.hasMoreBefore ?? false
      const existing = new Map<string, ChatMessage>(
        messages.value.map((message) => [message.id, message]),
      )
      const persisted = projection.messages.map(fromProjection).map((message) => {
        const current = existing.get(message.id)
        return current && current.revision === message.revision ? current : message
      })
      messages.value = restoreStreamingShell(persisted, thread.id, thread.agentId)
    } catch (err) {
      if (generation !== loadGeneration) return // 过期请求的错误也丢弃，避免污染当前状态
      historyError.value = (err as Error).message
      logger.error('ThreadStore', 'Thread 消息加载失败', err)
    } finally {
      if (generation === loadGeneration) isLoadingHistory.value = false
    }
  }

  async function loadOlderMessages(): Promise<number> {
    if (!threadId.value || !hasMoreHistory.value || isLoadingOlderHistory.value) return 0
    isLoadingOlderHistory.value = true
    try {
      const response = await threadsApi.getProjection(threadId.value, {
        beforeCursor: historyCursor.value,
        pageSize: HISTORY_PAGE_SIZE,
      })
      const projection = response.data
      if (!projection || projection.threadId !== threadId.value) return 0
      compositor.mergeSnapshot(projection)
      const existing = new Map(messages.value.map((message) => [message.id, message]))
      const older = projection.messages.map(fromProjection).map((message) => {
        const current = existing.get(message.id)
        return current && current.revision === message.revision ? current : message
      })
      const additions = older.filter((message) => !existing.has(message.id))
      messages.value = [...additions, ...messages.value]
      historyCursor.value = projection.beforeCursor
      hasMoreHistory.value = projection.hasMoreBefore ?? false
      return additions.length
    } catch (error) {
      logger.error('ThreadStore', '更早历史加载失败', error)
      return 0
    } finally {
      isLoadingOlderHistory.value = false
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

  function mergeProjectionMessages(
    snapshot: import('@infos/shared').ConversationProjectionSnapshot,
  ): ChatMessage[] {
    const existing = new Map<string, ChatMessage>(
      messages.value.map((message) => [message.id, message]),
    )
    const projected = snapshot.messages.map(fromProjection).map((message) => {
      const current = existing.get(message.id)
      return current && current.revision === message.revision ? current : message
    })
    const firstProjectedId = Number(projected[0]?.id)
    const retainedHistory = Number.isSafeInteger(firstProjectedId)
      ? messages.value.filter(
          (message) =>
            Number.isSafeInteger(Number(message.id)) && Number(message.id) < firstProjectedId,
        )
      : []
    return [...retainedHistory, ...projected]
  }

  function applyProjection(snapshot: import('@infos/shared').ConversationProjectionSnapshot): void {
    compositor.mergeSnapshot(snapshot)
    messages.value = mergeProjectionMessages(snapshot)
    historyCursor.value = messages.value[0]?.id
    hasMoreHistory.value = messages.value.length < (snapshot.totalMessages ?? messages.value.length)
  }

  /** 应用实时 Surface 帧，并在 commit 时把临时消息原子归一为持久消息 Shell。 */
  function applySurfaceFrame(frame: SurfaceFrame): void {
    compositor.enqueue(frame)
    if (frame.operation.type === 'surface.open') {
      if (!streamingMessageId.value) return
      messages.value = messages.value.map((message) =>
        message.id === streamingMessageId.value
          ? { ...message, surfaceId: frame.surfaceId }
          : message,
      )
      return
    }
    if (frame.operation.type !== 'surface.commit') return
    compositor.mergeSnapshot(frame.operation.snapshot)
    messages.value = mergeProjectionMessages(frame.operation.snapshot)
    const committedMessageId = frame.operation.message.messageId
    if (ragFailureTrace.value) {
      const failure = { ...ragFailureTrace.value }
      messages.value = messages.value.map((message) =>
        message.id === committedMessageId ? { ...message, ragFailureTrace: failure } : message,
      )
    }
    streamingMessageId.value = committedMessageId
  }

  function setRagProgress(message: string | null): void {
    ragProgressMessage.value = message
  }

  function setRagFailure(trace: RagFailureTrace | null): void {
    ragFailureTrace.value = trace
  }

  /** 完成流式生成 */
  function finishStreaming() {
    const list = messages.value
    if (list.length === 0) return

    const last = list[list.length - 1]!
    const updated = { ...last, isStreaming: false }
    messages.value = [...list.slice(0, -1), updated]

    generationState.value = 'idle'
    ragProgressMessage.value = null
    ragFailureTrace.value = null
    streamingMessageId.value = null
  }

  /** 清空当前 Thread */
  function clearThread() {
    messages.value = []
    threadId.value = ''
    generationState.value = 'idle'
    ragProgressMessage.value = null
    ragFailureTrace.value = null
    streamingMessageId.value = null
    inputText.value = ''
    historyError.value = null
    historyCursor.value = undefined
    hasMoreHistory.value = false
    isLoadingOlderHistory.value = false
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
    ragProgressMessage,
    ragFailureTrace,
    isGenerating,
    inputText,
    streamingMessageId,
    isLoadingHistory,
    isLoadingOlderHistory,
    hasMoreHistory,
    historyError,
    installLocalMessageSurface,
    addMessage,
    setMessages,
    applyProjection,
    applySurfaceFrame,
    setRagProgress,
    setRagFailure,
    finishStreaming,
    clearThread,
    editMessage,
    deleteMessage,
    startThread,
    createNewThread,
    loadLatestThread,
    ensureLatestThread,
    loadThreadMessages,
    loadOlderMessages,
    refreshCurrentThread,
  }
})
