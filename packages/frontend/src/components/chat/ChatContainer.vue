<script setup lang="ts">
/**
 * ChatContainer — 聊天主容器
 *
 * 组装消息列表 + 输入框 + 指令遮罩，接管滚动和流式逻辑。
 * F3: 已通过 useChat composable 接入 SSE 流式对话管道。
 *
 * @props agentId - 目标 Agent ID
 * @props agentName - Agent 名称
 */
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import MessageBubble from './MessageBubble.vue'
import InputBar from './InputBar.vue'
import CommandOverlay from './CommandOverlay.vue'
import AgentWorkBadge from './AgentWorkBadge.vue'
import ConversationRewindDialog from './ConversationRewindDialog.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ChatMessage as BubbleMessage } from './MessageBubble.vue'
import type { ActiveCommand } from './CommandOverlay.vue'
import { useChatScroll, useMessageVisibility } from '../../composables'
import { useChat } from '../../composables/chat/useChat'
import { useConversationRewind } from '../../composables/chat/useConversationRewind'
import { useStreamMarkdown } from '../../composables/chat/useStreamMarkdown'
import { renderChatRichText } from '../../lib/chatRichRenderer'
import { useThreadStore, useNotificationStore, useApprovalStore } from '../../stores'
import { ApprovalCard } from '../approval'
import { logger } from '../../lib/logger'
import { chatApi } from '../../api/modules/chatApi'

export interface Props {
  /** 目标 Agent ID */
  agentId: string
  /** Agent 名称 */
  agentName?: string
  /** 当前选中 Thread；变化时加载该会话而非最新会话。 */
  threadId?: string
  /** Agent 头像 URL。 */
  agentAvatarUrl?: string
  /** 工作区窄栏模式：输入台根据容器宽度自动压缩。 */
  compactInput?: boolean
  /** 是否在对话容器内展示审批浮层；工作区使用自己的审批队列。 */
  showApprovals?: boolean
  /** 工作区模式：向发送内容附加当前文件/终端上下文。 */
  workspaceContext?: { filePath?: string; terminalId?: string }
}

const props = withDefaults(defineProps<Props>(), {
  agentName: '助手',
  threadId: '',
  agentAvatarUrl: '',
  compactInput: false,
  showApprovals: true,
  workspaceContext: undefined,
})

const emit = defineEmits<{
  /** 当前对话完成，供外层刷新会话列表。 */
  completed: []
}>()

const containerRef = ref<HTMLElement | null>(null)

// ── 对话管道 (F3: 真实 SSE 流) ──
const {
  messages: chatMessages,
  isGenerating,
  isLoadingHistory,
  historyError,
  sendMessage: chatSend,
  stopGeneration,
} = useChat({ channel: 'desktop' })

const threadStore = useThreadStore()
const notif = useNotificationStore()
const rewind = useConversationRewind()
const approvalStore = useApprovalStore()
const pendingApprovals = computed(() =>
  approvalStore.forThread(props.agentId, threadStore.threadId || props.threadId),
)

// ── 安全语义富文本渲染器 ──
const renderMd = renderChatRichText

/** 提取模型原始转写中的 Thinking 标签块，仅供用户主动展开。 */
function extractThinking(rawContent?: string | null): string | undefined {
  if (!rawContent) return undefined
  const blocks: string[] = []
  const pattern = /<(?:think|thinking)>\s*([\s\S]*?)\s*<\/(?:think|thinking)>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawContent)) !== null) {
    const content = match[1]?.trim()
    if (content) blocks.push(content)
  }
  return blocks.length > 0 ? blocks.join('\n\n') : undefined
}

// ── 流式 Markdown 增量渲染 ──
const streamMd = useStreamMarkdown(renderMd)

// 监听流式消息变化，驱动 useStreamMarkdown
watch(
  () => {
    if (!isGenerating.value) return null
    const list = chatMessages.value
    if (list.length === 0) return null
    const last = list[list.length - 1]!
    return last.isStreaming ? last.content : null
  },
  (content) => {
    if (content !== null) {
      streamMd.onChunk(content)
    }
  },
)

// 生成结束时 finish
watch(isGenerating, (generating, wasGenerating) => {
  if (!generating && wasGenerating) {
    streamMd.finish()
    emit('completed')
  }
})

// 新消息开始时 reset
watch(
  () => {
    const list = chatMessages.value
    return list.length > 0 && list[list.length - 1]?.isStreaming ? list[list.length - 1]!.id : null
  },
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      streamMd.reset()
    }
  },
)

// ── 指令遮罩状态 ──

const activeCommand = ref<ActiveCommand | null>(null)

// ── 消息列表 ──

/** 映射 store → MessageBubble 格式（含 renderedHtml + toolCalls） */
const messages = computed<BubbleMessage[]>(() => {
  return chatMessages.value.map((m, idx) => {
    const isLast = idx === chatMessages.value.length - 1
    const isStreamingMsg = isGenerating.value && isLast && m.role === 'assistant'

    // 流式消息用 useStreamMarkdown 的输出，历史消息用全量渲染
    let renderedHtml: string | undefined
    if (m.content) {
      if (isStreamingMsg) {
        renderedHtml = streamMd.stableHtml.value + streamMd.tailHtml.value
      } else {
        renderedHtml = renderMd(m.content)
      }
    }

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content ?? '',
      thinkingContent: m.role === 'assistant' ? extractThinking(m.rawContent) : undefined,
      timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
      senderId: m.senderId,
      images: m.images,
      attachments: m.attachments,
      segments: undefined,
      renderedHtml,
      toolCalls: m.toolCalls,
      imageTranscription: m.imageTranscription,
    }
  })
})

const messageCount = computed(() => messages.value.length)

// ── 滚动管理 ──

const { showScrollDown, scrollToBottom } = useChatScroll(containerRef, messageCount)

// ── IntersectionObserver 不可见消息暂停 ──

const { observe, unobserve } = useMessageVisibility(containerRef)

function getComponentRootElement(event: unknown): Element | null {
  if (event instanceof Element) return event
  if (event && typeof event === 'object') {
    const instance = event as { el?: unknown; $el?: unknown }
    if (instance.el instanceof Element) return instance.el
    if (instance.$el instanceof Element) return instance.$el
  }
  return null
}

function onBubbleMounted(event: unknown) {
  observe(getComponentRootElement(event))
}

function onBubbleUnmounted(event: unknown) {
  unobserve(getComponentRootElement(event))
}

// ── 发送消息 ──

async function handleSend(
  text: string,
  _mentions: string[],
  attachmentIds: string[],
  imageMode: 'auto' | 'native' | 'relay',
  complete: (success: boolean) => void,
) {
  // 工作区上下文作为隐式请求字段发送，不拼进用户正文，避免 <workspace_context> 泄漏到气泡和历史消息。
  const workspaceContext = props.workspaceContext
    ? {
        filePath: props.workspaceContext.filePath,
        terminalId: props.workspaceContext.terminalId,
      }
    : undefined
  const success = await chatSend(text, attachmentIds, imageMode, workspaceContext)
  complete(success)
  await nextTick()
  scrollToBottom()
}

async function handleNewThread() {
  await threadStore.createNewThread(props.agentId, 'desktop')
}

/** 停止生成 */
async function handleStop() {
  await stopGeneration()
}

/** 跳过指令等待 */
function handleSkipCommand() {
  activeCommand.value = null
}

// ── 消息编辑/删除 ──

/** 编辑状态 */
const editingMessage = ref<BubbleMessage | null>(null)
const editText = ref('')

/** 进入编辑模式 */
function handleEdit(msg: BubbleMessage) {
  editingMessage.value = msg
  editText.value = msg.content
}

/** 保存编辑：后端确认后再更新本地，避免持久化失败造成界面与服务端不一致。 */
async function saveEdit() {
  if (!editingMessage.value || !threadStore.threadId) return
  const target = editingMessage.value
  const nextContent = editText.value.trim()
  if (!nextContent) return
  try {
    await chatApi.editMessage(threadStore.threadId, target.id, nextContent)
    threadStore.messages = threadStore.messages.map((message) =>
      message.id === target.id ? { ...message, content: nextContent } : message,
    )
    editingMessage.value = null
    editText.value = ''
    notif.toast('消息已保存', { type: 'success' })
  } catch (err) {
    logger.error('ChatContainer', '消息编辑保存失败', err)
    notif.toast('消息保存失败，已保留原内容', { type: 'error' })
  }
}

/** 取消编辑 */
function cancelEdit() {
  editingMessage.value = null
  editText.value = ''
}

/**
 * 级联删除对话对，并在后端确认后精确更新本地 UI。
 * 临时 msg_* ID 表示消息尚未完成服务端回灌，删除前先刷新并定位真实数据库 ID。
 */
async function handleDeletePair(id: string) {
  let target = threadStore.messages.find((message) => message.id === id)
  if (!target || !threadStore.threadId) return

  try {
    if (!/^\d+$/.test(target.id)) {
      const snapshot = target
      await threadStore.refreshCurrentThread(props.agentId)
      const candidates = threadStore.messages.filter((message) => message.role === snapshot.role)
      target =
        candidates.find((message) => message.content === snapshot.content) ?? candidates.at(-1)
      if (!target || !/^\d+$/.test(target.id)) {
        throw new Error('消息尚未完成服务端同步，请稍后重试')
      }
    }

    await rewind.open({
      threadId: threadStore.threadId,
      messageId: Number(target.id),
      onSuccess: async (result) => {
        const deletedIds = new Set(result.deletedMessageIds.map(String))
        threadStore.messages = threadStore.messages.filter((message) => !deletedIds.has(message.id))
        await threadStore.loadThreadMessages(threadStore.threadId, props.agentId)
        window.dispatchEvent(
          new CustomEvent('infos:workspace-rewound', {
            detail: { threadId: threadStore.threadId, files: result.preview.files },
          }),
        )
        notif.toast(`已回滚 ${result.preview.pairCount} 轮对话`, { type: 'success' })
      },
    })
  } catch (err) {
    logger.error('ChatContainer', '删除对话对失败', err)
    notif.toast(err instanceof Error ? err.message : '删除失败，请稍后重试', { type: 'error' })
  }
}

/** 复制消息内容到剪贴板 */
async function handleCopy(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    logger.info('ChatContainer', '消息已复制到剪贴板')
    notif.toast('已复制到剪贴板', { type: 'success' })
  } catch (err) {
    logger.error('ChatContainer', '复制失败', err)
    notif.toast('复制失败', { type: 'error' })
  }
}

watch(
  () => [props.agentId, props.threadId] as const,
  async ([agentId, threadId]) => {
    // props 在角色切换时可能短暂出现“新 Agent + 旧 Thread”；只加载归属已一致的会话。
    if (threadId && threadStore.agentId === agentId) {
      await threadStore.loadThreadMessages(threadId, agentId)
    } else {
      await threadStore.ensureLatestThread(agentId, 'desktop')
    }
    await nextTick()
    scrollToBottom(false)
  },
  { immediate: true },
)

onMounted(() => {
  scrollToBottom(false)
})

onUnmounted(() => {
  // 清理（composable 内部已处理 observer disconnect）
})
</script>

<template>
  <div class="chat-container">
    <!-- M05-B1: 角色工作状态徽章（后台任务进行中提示，点击跳转任务中心） -->
    <div class="chat-work-badge">
      <AgentWorkBadge :agent-id="agentId" />
    </div>

    <!-- 指令执行遮罩 -->
    <CommandOverlay :command="activeCommand" @skip="handleSkipCommand" />

    <!-- 消息列表 -->
    <div ref="containerRef" class="chat-messages">
      <div v-if="isLoadingHistory" class="chat-history-state">
        <PixelIcon name="refresh" size="sm" animation="spin" />
        <span>正在同步历史聊天记录...</span>
      </div>

      <div v-else-if="historyError" class="chat-history-state chat-history-error">
        <PixelIcon name="alert" size="sm" />
        <span>历史记录同步失败：{{ historyError }}</span>
      </div>

      <MessageBubble
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :agent-name="agentName"
        :agent-avatar-url="agentAvatarUrl"
        :is-streaming="
          isGenerating && msg === messages[messages.length - 1] && msg.role === 'assistant'
        "
        @edit="handleEdit"
        @delete-pair="handleDeletePair"
        @copy="handleCopy"
        @vue:mounted="onBubbleMounted"
        @vue:unmounted="onBubbleUnmounted"
      />
    </div>

    <!-- 当前 Thread 待审批工具调用：作为对话中的系统交互卡片。 -->
    <div v-if="showApprovals && pendingApprovals.length" class="chat-approvals">
      <ApprovalCard
        v-for="request in pendingApprovals"
        :key="request.id"
        :request="request"
        :loading="approvalStore.isResolving[request.id]"
        compact
        @resolve="(decision, message) => approvalStore.resolve(request.id, decision, message)"
      />
    </div>

    <!-- 回到底部 -->
    <Transition name="scroll-down">
      <button v-if="showScrollDown" class="chat-scroll-down" @click="scrollToBottom()">
        <PixelIcon name="chevron-down" size="sm" />
      </button>
    </Transition>

    <!-- 输入框 -->
    <div class="chat-input-area">
      <InputBar
        :compact="compactInput"
        :is-sending="isGenerating"
        @send="handleSend"
        @stop="handleStop"
        @new-thread="handleNewThread"
      />
    </div>

    <!-- 编辑对话框 -->
    <Teleport to="body">
      <div v-if="editingMessage" class="chat-edit-overlay" @click.self="cancelEdit">
        <div class="chat-edit-dialog">
          <div class="chat-edit-header">
            <PixelIcon name="edit" size="sm" />
            <span>编辑消息</span>
          </div>
          <textarea v-model="editText" class="chat-edit-textarea" rows="5" />
          <div class="chat-edit-actions">
            <button class="chat-edit-btn chat-edit-cancel" @click="cancelEdit">取消</button>
            <button class="chat-edit-btn chat-edit-save" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
    <ConversationRewindDialog
      v-model="rewind.visible.value"
      :preview="rewind.preview.value"
      :loading="rewind.loading.value"
      @confirm="rewind.confirm"
    />
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: transparent;
}

/* M05-B1: 工作徽章悬浮于消息区右上角，不占布局 */
.chat-work-badge {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 10;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 滚动条 */
.chat-messages::-webkit-scrollbar {
  width: 4px;
}
.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
  border-radius: var(--ui-radius-full);
}

.chat-approvals {
  position: absolute;
  right: 28px;
  bottom: 112px;
  z-index: 24;
  display: grid;
  width: min(560px, calc(100% - 56px));
  max-height: min(62vh, 480px);
  overflow-y: auto;
  filter: drop-shadow(5px 6px 0 color-mix(in srgb, var(--ui-text-primary) 16%, transparent));
}

.chat-input-area {
  flex-shrink: 0;
  padding: 0 28px 24px;
}

.chat-history-state {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 16px;
  padding: 8px 16px;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--ui-radius-full);
  border: 1px solid var(--ui-border-subtle);
}

.chat-history-error {
  background: var(--ui-accent-red-soft);
  color: var(--ui-danger);
  border-color: var(--ui-danger);
}

/* 回到底部按钮 */
.chat-scroll-down {
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-bg-surface);
  color: var(--ui-accent-primary);
  cursor: pointer;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-full);
  box-shadow: var(--ui-shadow-md);
  transition: all var(--ui-duration-fast);
  z-index: 10;
}
.chat-scroll-down:hover {
  background: var(--ui-accent-primary);
  color: white;
  box-shadow: var(--ui-glow-pink);
  transform: translateX(-50%) translateY(-2px);
}

.scroll-down-enter-active {
  transition: all 0.2s ease-out;
}
.scroll-down-leave-active {
  transition: all 0.15s ease-in;
}
.scroll-down-enter-from,
.scroll-down-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* 不可见消息只暂停动画和媒体，不启用 content-visibility 高度占位。 */
:deep(.msg-paused) {
  content-visibility: visible;
}

:deep(.msg-paused) video,
:deep(.msg-paused) canvas {
  visibility: hidden;
}

:deep(.msg-paused) * {
  animation-play-state: paused !important;
}

/* ── 流式渲染区域 ── */
:deep(.stream-stable) {
  contain: content;
}

:deep(.stream-tail) {
  contain: none;
}
</style>

<!-- 编辑对话框样式 (Teleport 到 body 需要非 scoped) -->
<style>
.chat-edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--ui-z-modal);
  animation: fadeIn var(--ui-duration-fast);
}

.chat-edit-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  box-shadow: var(--ui-shadow-lg);
}

.chat-edit-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 800;
  color: var(--ui-text-primary);
}

.chat-edit-textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  border-radius: var(--ui-radius-sm);
  transition: border-color var(--ui-duration-fast);
}

.chat-edit-textarea:focus {
  border-color: var(--ui-accent-primary);
  box-shadow: 0 0 0 2px var(--ui-accent-primary-soft);
}

.chat-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chat-edit-btn {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-sm);
  transition: all var(--ui-duration-fast);
}

.chat-edit-cancel {
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
}

.chat-edit-cancel:hover {
  background: var(--ui-bg-hover);
}

.chat-edit-save {
  background: var(--ui-accent-primary);
  color: white;
  border-color: var(--ui-accent-primary);
}

.chat-edit-save:hover {
  background: #db2777;
  box-shadow: var(--ui-glow-pink);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
