import { t as __t } from '../../i18n/index'
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

import { publishWorkspaceChanges } from './workspaceChanges'
import { computed } from 'vue'
import { useCompositorStore, useThreadStore } from '../../stores'
import { useAgentStore } from '../../stores'
import { useTaskToastStore } from '../../stores/taskToastStore'
import { chatApi } from '../../api/modules/chatApi'
import { logger } from '../../lib/logger'
import type { ChatRequest } from '../../api/modules/chatApi'
import type { ThreadChannel } from '../../api/modules/threadsApi'
import type { AttachmentInfo } from '../../api/modules/attachmentsApi'

/** useChat 配置 */
export interface UseChatOptions {
  /** 频道标识（替代旧 source） */
  channel?: ThreadChannel
}

export function useChat(options: UseChatOptions = {}) {
  const { channel = 'desktop' } = options

  const threadStore = useThreadStore()
  const compositor = useCompositorStore()
  const agentStore = useAgentStore()
  // M05-B4: 对话 tab 的 llm_error / 工具失败统一迁移到 TaskToast 体系
  const taskToast = useTaskToastStore()

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
  let recoveryAbort: AbortController | null = null
  let requestEpoch = 0

  /**
   * 发送消息（流式）
   *
   * 流程：
   * 1. 创建用户消息 → 添加到 store
   * 2. 创建空 assistant 消息占位
   * 3. 发起 SSE 请求 → 增量追加
   * 4. 完成/错误 → 更新状态
   */
  async function sendMessage(
    text: string,
    attachmentIds: string[] = [],
    attachments: AttachmentInfo[] = [],
    imageMode: 'auto' | 'native' | 'relay' = 'auto',
    workspaceContext?: import('../../api/modules/chatApi').ChatWorkspaceContext,
    generationType: import('@infos/shared').PromptGenerationType = 'normal',
  ): Promise<boolean> {
    const trimmed = generationType === 'regenerate' ? text : text.trim()
    if (!trimmed.trim() || threadStore.isGenerating || threadStore.isLoadingHistory) return false

    const requestAgentId = agentStore.activeAgentId
    // Thread 与 Agent 必须成对一致；角色切换竞态下先重新加载权威会话。
    if (threadStore.agentId !== requestAgentId || !threadStore.threadId) {
      try {
        const activated = await threadStore.ensureLatestThread(requestAgentId, channel)
        if (!activated || agentStore.activeAgentId !== requestAgentId) return false
      } catch (err) {
        const message = err instanceof Error ? err.message : '恢复会话失败'
        // 会话恢复失败统一走 TaskToast，保留原始接口错误。
        taskToast.push({
          type: 'task_failed',
          agentId: requestAgentId,
          get title() {
            return __t('ui.chat', '聊天会话')
          },
          message,
        })
        return false
      }
    }

    if (!threadStore.threadId || threadStore.agentId !== requestAgentId) {
      taskToast.push({
        type: 'task_failed',
        agentId: requestAgentId,
        get title() {
          return __t('ui.chat', '聊天会话')
        },
        get message() {
          return __t('ui.chat', '无法建立当前角色的有效会话，请重试')
        },
      })
      return false
    }
    const requestThreadId = threadStore.threadId
    const epoch = ++requestEpoch
    recoveryAbort?.abort()
    recoveryAbort = null
    const previousMessageIds = new Set(threadStore.messages.map((message) => message.id))

    // 1. 添加用户消息
    const userMsg = createMessage('user', trimmed)
    userMsg.attachments = attachments.map((attachment) => ({
      id: attachment.id,
      threadId: requestThreadId,
      messageId: null,
      kind: attachment.kind,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      contextPolicy: attachment.contextPolicy,
      status: attachment.status,
    }))
    userMsg.surfaceId = threadStore.installLocalMessageSurface(userMsg.id, trimmed, attachments)
    threadStore.addMessage(userMsg)
    threadStore.inputText = ''

    // 2. 添加 assistant 占位消息
    const assistantMsg = createMessage('assistant', '', true)
    threadStore.addMessage(assistantMsg)
    threadStore.streamingMessageId = assistantMsg.id
    threadStore.generationState = 'thinking'
    threadStore.setRagFailure(null)
    threadStore.setRagProgress('正在编译对话上下文')

    // 3. 构建请求 — Thread 模式：threadId + content + agentId
    const request: ChatRequest = {
      threadId: requestThreadId,
      content: trimmed,
      attachmentIds,
      imageMode,
      workspaceContext,
      generationType,
      agentId: requestAgentId,
    }

    const ownsRequestView = () =>
      epoch === requestEpoch &&
      threadStore.threadId === requestThreadId &&
      threadStore.agentId === requestAgentId

    // 4. 发起唯一 Surface SSE 流；消息正文、工具与状态不再写入 ThreadStore。
    return await new Promise<boolean>((resolve) => {
      currentAbort = chatApi.stream(request, {
        onRagProgress: (progress) => {
          if (!ownsRequestView()) return
          threadStore.setRagProgress(progress.message)
          if (progress.status === 'failed') {
            threadStore.setRagFailure({
              kind: progress.failureKind ?? 'rag',
              message: progress.message,
            })
          }
        },
        onSurface: (frame) => {
          if (!ownsRequestView()) return
          threadStore.applySurfaceFrame(frame)
          if (frame.operation.type === 'surface.open') {
            threadStore.setRagProgress(null)
          }
          if (
            frame.operation.type === 'surface.upsert-node' &&
            frame.operation.node.kind === 'status'
          ) {
            const state = (frame.operation.node.props as { state?: string }).state
            if (state === 'thinking') threadStore.generationState = 'thinking'
            else if (state === 'assembling') threadStore.generationState = 'tool_assembling'
            else if (state === 'calling') threadStore.generationState = 'tool_calling'
            else if (state === 'generating') threadStore.generationState = 'generating'
          }
          if (frame.operation.type === 'surface.commit') {
            publishWorkspaceChanges(frame.operation.message, requestAgentId, requestThreadId)
          }
        },

        onDone: () => {
          if (ownsRequestView()) threadStore.finishStreaming()
          if (epoch === requestEpoch) currentAbort = null
          resolve(true)
          window.dispatchEvent(
            new CustomEvent('infos:conversation-completed', {
              detail: { agentId: requestAgentId, threadId: requestThreadId },
            }),
          )
          // surface.commit已经携带权威Projection和真实消息ID，无需再次回灌覆盖本轮遥测。
        },

        onError: (data) => {
          if (epoch !== requestEpoch) {
            resolve(false)
            return
          }
          // 执行失败回灌持久消息；网络断流保留已有画面，只恢复后台任务的观察。
          const disconnected = ['STREAM_TRUNCATED', 'STREAM_ERROR', 'NETWORK_ERROR'].includes(
            data.code,
          )
          const failedMessageId = threadStore.streamingMessageId
          let failedShell: import('../../stores').ChatMessage | undefined
          if (ownsRequestView()) {
            if (disconnected) {
              threadStore.setRagProgress('连接暂时中断，正在同步后台执行进度……')
            } else {
              threadStore.failStreaming(data.code, data.message || '对话生成失败')
              threadStore.finishStreaming()
            }
            failedShell = threadStore.messages.find((message) => message.id === failedMessageId)
          }
          const failedSurface = compositor.get(failedShell?.surfaceId)
          currentAbort = null
          resolve(false)
          recoveryAbort?.abort()
          const recovery = new AbortController()
          recoveryAbort = recovery
          // 断流只失去观察连接；后端仍在运行时等终态回灌，不能再次发送同一任务。
          void (async () => {
            // 覆盖整轮 6 小时时限，并留出终态消息持久化与网络恢复的时间。
            const recoveryDeadline = Date.now() + 6 * 60 * 60 * 1000 + 5 * 60 * 1000
            while (!recovery.signal.aborted && ownsRequestView()) {
              try {
                const active = disconnected ? ((await chatApi.activeTasks()).data ?? []) : []
                if (recovery.signal.aborted || !ownsRequestView()) return
                if (
                  active.some(
                    (task) =>
                      task.threadId === requestThreadId &&
                      ['running', 'paused'].includes(task.state),
                  )
                ) {
                  // 断流期间从权威快照接续进度，保留已有工具和正文，不反复把整条消息标成失败。
                  if (!threadStore.isLoadingHistory)
                    await threadStore.loadThreadMessages(
                      requestThreadId,
                      requestAgentId,
                      recovery.signal,
                    )
                  if (recovery.signal.aborted || !ownsRequestView()) return
                  if (!threadStore.isGenerating) threadStore.generationState = 'thinking'
                  threadStore.setRagProgress('后台仍在继续，正在自动同步执行进度……')
                } else {
                  threadStore.finishStreaming()
                  const result = await threadStore.loadThreadMessages(
                    requestThreadId,
                    requestAgentId,
                    recovery.signal,
                  )
                  if (recovery.signal.aborted || !ownsRequestView()) return
                  if (result.status !== 'failed') {
                    // 编译上下文等较早失败可能尚未产生持久 Assistant，不能让空历史覆盖错误卡片。
                    if (
                      !disconnected &&
                      result.status === 'loaded' &&
                      failedShell &&
                      !threadStore.messages.some(
                        (message) =>
                          message.role === 'assistant' &&
                          !previousMessageIds.has(message.id) &&
                          compositor.get(message.surfaceId)?.state === 'failed',
                      )
                    ) {
                      if (failedSurface) compositor.install({ ...failedSurface, state: 'failed' })
                      if (
                        !threadStore.messages.some(
                          (message) =>
                            message.role === 'user' && !previousMessageIds.has(message.id),
                        )
                      )
                        threadStore.addMessage(userMsg)
                      threadStore.addMessage({ ...failedShell, isStreaming: false })
                    }
                    window.dispatchEvent(
                      new CustomEvent('infos:conversation-completed', {
                        detail: { agentId: requestAgentId, threadId: requestThreadId },
                      }),
                    )
                    return
                  }
                }
              } catch (error) {
                logger.warn(
                  'useChat',
                  __t('logs.frontend.chat', '流结束后的会话同步暂时失败，稍后重试'),
                  error,
                )
              }
              if (Date.now() >= recoveryDeadline) {
                if (ownsRequestView()) threadStore.finishStreaming()
                return
              }
              await new Promise<void>((done) => {
                const finish = () => {
                  clearTimeout(timer)
                  recovery.signal.removeEventListener('abort', finish)
                  window.removeEventListener('online', finish)
                  window.removeEventListener('pageshow', finish)
                  window.removeEventListener('infos:gateway-ready', finish)
                  done()
                }
                const timer = setTimeout(finish, 3_000)
                recovery.signal.addEventListener('abort', finish, { once: true })
                window.addEventListener('online', finish, { once: true })
                window.addEventListener('pageshow', finish, { once: true })
                window.addEventListener('infos:gateway-ready', finish, { once: true })
              })
            }
          })().finally(() => {
            if (recoveryAbort === recovery) recoveryAbort = null
          })
          // M05-B4: 对话生成失败走 TaskToast（附带出错角色，任务中心可回溯）
          if (!disconnected)
            taskToast.push({
              type: 'task_failed',
              agentId: requestAgentId,
              get title() {
                return __t('ui.chat', '对话生成失败')
              },
              message: data.message || __t('ui.chat', '对话生成失败'),
            })
        },
      })
    })
  }

  function freezeRunningSurfaces(): void {
    compositor.flush()
    const threadId = threadStore.threadId
    const openSurfaces = [...compositor.surfaces.values()].filter(
      (surface) => surface.threadId === threadId && surface.state === 'open',
    )
    for (const surface of openSurfaces) compositor.terminateThinking(surface.surfaceId, true)
  }

  /** 停止当前生成 */
  async function stopGeneration(): Promise<void> {
    const epoch = ++requestEpoch
    const stoppingThread = threadStore.threadId
    recoveryAbort?.abort()
    recoveryAbort = null
    freezeRunningSurfaces()
    // 客户端中断 SSE 流
    if (currentAbort) {
      currentAbort.abort()
      currentAbort = null
    }

    // 通知后端停止（传 threadId 精确取消）
    if (stoppingThread) {
      try {
        await chatApi.stop({ threadId: stoppingThread })
      } catch {
        // 忽略停止请求的错误
      }
    }

    if (epoch === requestEpoch && threadStore.threadId === stoppingThread)
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
        await sendMessage(text, [], [], 'auto', undefined, 'regenerate')
        return
      }
    }
  }

  /** 创建消息对象 */
  function createMessage(
    role: 'user' | 'assistant',
    content: string,
    isStreaming = false,
  ): import('../../stores').ChatMessage {
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
