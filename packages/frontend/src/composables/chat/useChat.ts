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
import { useTaskToastStore } from '../../stores/taskToastStore'
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
    imageMode: 'auto' | 'native' | 'relay' = 'auto',
    workspaceContext?: { filePath?: string; terminalId?: string },
  ): Promise<boolean> {
    const trimmed = text.trim()
    if (!trimmed || threadStore.isGenerating) return false

    const requestAgentId = agentStore.activeAgentId
    // Thread 与 Agent 必须成对一致；角色切换竞态下先重新加载权威会话。
    if (threadStore.agentId !== requestAgentId) {
      await threadStore.ensureLatestThread(requestAgentId, channel)
    }
    if (!threadStore.threadId) {
      try {
        await threadStore.createNewThread(requestAgentId, channel)
      } catch (err) {
        const message = err instanceof Error ? err.message : '创建会话失败'
        // M05-B4: 创建会话失败也统一走 TaskToast
        taskToast.push({
          type: 'task_failed',
          agentId: agentStore.activeAgentId,
          title: '聊天会话',
          message,
        })
        return false
      }
    }

    if (!threadStore.threadId || threadStore.agentId !== requestAgentId) {
      taskToast.push({
        type: 'task_failed',
        agentId: requestAgentId,
        title: '聊天会话',
        message: '无法建立当前角色的有效会话，请重试',
      })
      return false
    }
    const requestThreadId = threadStore.threadId

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
      threadId: requestThreadId,
      content: trimmed,
      attachmentIds,
      imageMode,
      workspaceContext,
      agentId: requestAgentId,
    }

    const ownsRequestView = () =>
      threadStore.threadId === requestThreadId && threadStore.agentId === requestAgentId

    // 4. 发起 SSE 流，并在服务端确认完成后返回发送结果
    return await new Promise<boolean>((resolve) => {
      currentAbort = chatApi.stream(request, {
        onDelta: (data) => {
          if (!ownsRequestView()) return
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
          } else if (data.state === 'tool_failed') {
            threadStore.generationState = 'generating'
            // M05-B4: 工具连续失败同样走 TaskToast（warning 语义近似 task_failed 预警）
            taskToast.push({
              type: 'task_failed',
              agentId: agentStore.activeAgentId,
              title: '工具调用告警',
              message: data.message || '工具连续失败，角色将改为说明原因',
            })
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
            {
              name: data.name,
              args: typeof data.args === 'string' ? data.args : JSON.stringify(data.args),
              callId: data.callId,
            },
          ]
          const updated = { ...last, toolCalls }
          threadStore.messages = [...list.slice(0, -1), updated]
        },

        onToolResult: (data) => {
          if (!ownsRequestView()) return
          // 通过 callId 精确匹配对应的 tool_call，回填 result
          const list = threadStore.messages
          if (list.length === 0) return
          const last = list[list.length - 1]!
          if (!last.toolCalls) return

          const completedCall = last.toolCalls.find((tc) => tc.callId === data.callId)
          const toolCalls = last.toolCalls.map((tc) =>
            tc.callId === data.callId && tc.result === undefined
              ? { ...tc, result: data.result, isError: data.isError, durationMs: data.durationMs }
              : tc,
          )
          const updated = { ...last, toolCalls }
          threadStore.messages = [...list.slice(0, -1), updated]

          // 文件写入/编辑成功后发布工作区变更事件。
          // WorkspaceTab 仅在当前挂载时消费：刷新资源树；新建文件额外自动打开。
          if (
            completedCall &&
            !data.isError &&
            ['write_file', 'edit_file'].includes(completedCall.name)
          ) {
            try {
              const args = JSON.parse(completedCall.args) as Record<string, unknown>
              const result = JSON.parse(data.result) as Record<string, unknown>
              const path = String(result.path ?? args.path ?? args.file_path ?? '')
              if (path && !result.error) {
                window.dispatchEvent(
                  new CustomEvent('infos:workspace-file-changed', {
                    detail: {
                      agentId: requestAgentId,
                      threadId: requestThreadId,
                      path,
                      operation:
                        result.operation ??
                        (completedCall.name === 'write_file' ? 'write' : 'edit'),
                    },
                  }),
                )
              }
            } catch (error) {
              logger.warn('useChat', '无法解析文件工具结果，跳过工作区自动刷新', error)
            }
          }

          // 工具执行完毕，回到 generating
          threadStore.generationState = 'generating'
        },

        onDone: () => {
          if (ownsRequestView()) threadStore.finishStreaming()
          currentAbort = null
          resolve(true)
          window.dispatchEvent(
            new CustomEvent('infos:conversation-completed', {
              detail: { agentId: requestAgentId, threadId: requestThreadId },
            }),
          )
          setTimeout(() => {
            if (!ownsRequestView()) return
            threadStore.loadThreadMessages(requestThreadId, requestAgentId).catch((err) => {
              logger.error('useChat', '对话完成后刷新历史失败', err)
            })
          }, 250)
        },

        onError: (data) => {
          // 先结束本地流，再立即回灌后端已持久化的失败消息和真实数据库 ID。
          // 刷新失败时才保留本地错误文本，确保用户仍能看到失败原因。
          if (ownsRequestView()) threadStore.finishStreaming()
          currentAbort = null
          resolve(false)
          if (ownsRequestView()) {
            void threadStore.loadThreadMessages(requestThreadId, requestAgentId).catch((err) => {
              logger.error('useChat', '失败回复回灌失败', err)
              const tail =
                data.code === 'STREAM_TRUNCATED'
                  ? `\n\n⚠️ [截断] ${data.message}`
                  : `\n\n⚠️ ${data.message}`
              threadStore.appendToLast(tail)
            })
          }
          // M05-B4: 对话生成失败走 TaskToast（附带出错角色，任务中心可回溯）
          taskToast.push({
            type: 'task_failed',
            agentId: requestAgentId,
            title: '对话生成失败',
            message: data.message || '对话生成失败',
          })
        },
      })
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
