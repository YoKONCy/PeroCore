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
import { ref, computed, onMounted, onUnmounted, onActivated, nextTick, watch } from 'vue'
import ConversationSurface from '../compositor/ConversationSurface.vue'
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
import {
  useThreadStore,
  useNotificationStore,
  useApprovalStore,
  useCompositorStore,
} from '../../stores'
import { logger } from '../../lib/logger'
import { chatApi } from '../../api/modules/chatApi'
import { voiceApi } from '../../api/modules/voiceApi'
import type { AttachmentInfo } from '../../api/modules/attachmentsApi'

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
const bubbleMessageCache = new WeakMap<object, BubbleMessage>()
let scrollFrame: number | null = null

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
const compositor = useCompositorStore()
const notif = useNotificationStore()
const rewind = useConversationRewind()
const approvalStore = useApprovalStore()
const playingMsgId = ref<string | null>(null)
const isLoadingAudio = ref(false)
let messageAudioContext: AudioContext | null = null
let messageAudioSource: AudioBufferSourceNode | null = null
let audioRequest = 0
const interactionSurfaces = computed(() =>
  [...compositor.surfaces.values()].filter(
    (surface) =>
      surface.scopeId === `conversation:${threadStore.threadId || props.threadId}` &&
      !surface.messageId,
  ),
)

watch(
  () =>
    [...approvalStore.pending.values()]
      .map((request) => `${request.id}:${request.status}`)
      .join('|'),
  () => {
    if (threadStore.threadId) {
      void threadStore.loadThreadMessages(threadStore.threadId, props.agentId)
    }
  },
)

// ── 消息原始转写 ──
function extractThinking(rawContent?: string | null): string | undefined {
  if (!rawContent) return undefined
  const blocks: string[] = []
  const pattern =
    /<(?:think|thinking|thought)(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/(?:think|thinking|thought)>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawContent)) !== null) {
    const content = match[1]?.trim()
    if (content) blocks.push(content)
  }
  return blocks.length > 0 ? blocks.join('\n\n') : undefined
}

// 生成结束时通知外层刷新会话列表。
watch(isGenerating, (generating, wasGenerating) => {
  if (!generating && wasGenerating) emit('completed')
})

// ── 指令遮罩状态 ──

const activeCommand = ref<ActiveCommand | null>(null)

// ── 消息列表 ──

/** 映射消息 Shell；所有可见富内容统一从 Compositor Surface 读取。 */
const messages = computed<BubbleMessage[]>(() => {
  return chatMessages.value.map((m) => {
    const surface = m.surfaceId ? compositor.get(m.surfaceId) : undefined
    const cached = bubbleMessageCache.get(m)
    if (cached && cached.surface === surface) return cached
    const hasThinkingSurface = surface?.nodes.some((node) => node.kind === 'thinking') ?? false
    const mapped: BubbleMessage = {
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content ?? '',
      thinkingContent:
        m.role === 'assistant' && !hasThinkingSurface ? extractThinking(m.rawContent) : undefined,
      timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
      outputTokens: m.outputTokens,
      senderId: m.senderId,
      ragFailureTrace: m.ragFailureTrace,
      surface,
      imageTranscription: m.imageTranscription,
    }
    bubbleMessageCache.set(m, mapped)
    return mapped
  })
})

const messageCount = computed(() => messages.value.length)

// ── 滚动管理 ──

const { showScrollDown, scrollToBottom } = useChatScroll(containerRef, messageCount)

// ── IntersectionObserver 不可见消息暂停 ──

const { observe, unobserve } = useMessageVisibility(containerRef, (element, visible) => {
  const surfaceId = element.dataset.surfaceId
  if (surfaceId) compositor.setSuspended(surfaceId, !visible)
})

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

async function loadOlderWithAnchor(): Promise<void> {
  const container = containerRef.value
  if (!container || !threadStore.hasMoreHistory || threadStore.isLoadingOlderHistory) return
  const previousHeight = container.scrollHeight
  const previousTop = container.scrollTop
  const added = await threadStore.loadOlderMessages()
  if (!added) return
  await nextTick()
  container.scrollTop = previousTop + container.scrollHeight - previousHeight
}

function handleMessageScroll(): void {
  if (scrollFrame !== null) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null
    const container = containerRef.value
    if (container?.scrollTop !== undefined && container.scrollTop < 240) {
      void loadOlderWithAnchor()
    }
  })
}

async function restoreMessageViewport(): Promise<void> {
  await nextTick()
}

// ── 发送消息 ──

async function handleSend(
  text: string,
  _mentions: string[],
  attachmentIds: string[],
  attachments: AttachmentInfo[],
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
  const success = await chatSend(text, attachmentIds, attachments, imageMode, workspaceContext)
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
    const response = await chatApi.editMessage(threadStore.threadId, target.id, nextContent)
    if (!response.data) throw new Error('服务端未返回更新后的 Conversation Projection')
    threadStore.applyProjection(response.data)
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
      const snapshotIndex = threadStore.messages.findIndex((message) => message.id === snapshot.id)
      const precedingUser =
        snapshotIndex > 0
          ? threadStore.messages
              .slice(0, snapshotIndex)
              .reverse()
              .find((message) => message.role === 'user')
          : undefined
      await threadStore.refreshCurrentThread(props.agentId)
      const candidates = threadStore.messages.filter((message) => message.role === snapshot.role)
      target =
        candidates.find((message) => message.content === snapshot.content) ??
        (snapshot.role === 'assistant' && precedingUser
          ? threadStore.messages.find(
              (message) => message.role === 'user' && message.content === precedingUser.content,
            )
          : undefined)
      if (!target || !/^\d+$/.test(target.id)) {
        throw new Error('消息尚未完成服务端同步，请稍后重试')
      }
    }

    await rewind.open({
      threadId: threadStore.threadId,
      messageId: Number(target.id),
      onSuccess: async (result) => {
        if (!result.projection) throw new Error('服务端未返回回滚后的Conversation Projection')
        threadStore.applyProjection(result.projection)
        window.dispatchEvent(
          new CustomEvent('infos:conversation-rewound', {
            detail: {
              threadId: threadStore.threadId,
              deletedMessageIds: result.deletedMessageIds.map(String),
              projection: result.projection,
            },
          }),
        )
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

function messageTextForTts(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s]*#{1,6}\s+/gm, '')
    .replace(/[*_~`>|]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4096)
}

function stopMessageAudio(): void {
  audioRequest++
  messageAudioSource?.stop()
  messageAudioSource = null
  void messageAudioContext?.close()
  messageAudioContext = null
  playingMsgId.value = null
  isLoadingAudio.value = false
}

async function handleTtsPlay(message: BubbleMessage): Promise<void> {
  if (playingMsgId.value === message.id) {
    stopMessageAudio()
    return
  }

  stopMessageAudio()
  const text = messageTextForTts(message.content)
  if (!text) {
    notif.toast('这条消息没有可朗读的文本', { type: 'warning' })
    return
  }
  const request = audioRequest
  playingMsgId.value = message.id
  isLoadingAudio.value = true
  try {
    const audio = await voiceApi.synthesize({ text })
    if (request !== audioRequest || playingMsgId.value !== message.id) return
    const context = new AudioContext()
    messageAudioContext = context
    const buffer = await context.decodeAudioData(audio.slice(0))
    if (request !== audioRequest || playingMsgId.value !== message.id) {
      await context.close()
      return
    }
    const source = context.createBufferSource()
    messageAudioSource = source
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (messageAudioSource !== source) return
      messageAudioSource = null
      messageAudioContext = null
      playingMsgId.value = null
      isLoadingAudio.value = false
      void context.close()
    }
    isLoadingAudio.value = false
    source.start()
  } catch (error) {
    if (request !== audioRequest) return
    stopMessageAudio()
    logger.error('ChatContainer', '朗读消息失败', error)
    notif.toast(`朗读消息失败：${(error as Error).message}`, { type: 'error' })
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
  async ([agentId, threadId], previous) => {
    const previousThreadId = previous?.[1]
    if (previousThreadId && previousThreadId !== threadId) {
      compositor.disposeScope(`conversation:${previousThreadId}`)
    }
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

function restoreProjection(): void {
  if (threadStore.threadId) void threadStore.loadThreadMessages(threadStore.threadId, props.agentId)
}

function handleConversationRewound(event: Event): void {
  const detail = (
    event as CustomEvent<{
      threadId?: string
      projection?: import('@infos/shared').ConversationProjectionSnapshot
    }>
  ).detail
  if (!detail?.threadId || detail.threadId !== threadStore.threadId) return
  if (detail.projection) threadStore.applyProjection(detail.projection)
  else restoreProjection()
}

onMounted(() => {
  window.addEventListener('online', restoreProjection)
  window.addEventListener('infos:conversation-rewound', handleConversationRewound)
  scrollToBottom(false)
})

onActivated(() => {
  void restoreMessageViewport()
})

onUnmounted(() => {
  stopMessageAudio()
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
  scrollFrame = null
  window.removeEventListener('online', restoreProjection)
  window.removeEventListener('infos:conversation-rewound', handleConversationRewound)
  if (threadStore.threadId) compositor.disposeScope(`conversation:${threadStore.threadId}`)
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
    <div class="chat-messages-region">
      <div class="chat-conversation-background" aria-hidden="true">
        <div class="chat-conversation-background__image" />
        <div class="chat-conversation-background__overlay" />
      </div>
      <div ref="containerRef" class="chat-messages" @scroll.passive="handleMessageScroll">
        <div v-if="isLoadingHistory" class="chat-history-state">
          <PixelIcon name="refresh" size="sm" animation="spin" />
          <span>正在同步历史聊天记录...</span>
        </div>

        <div v-else-if="historyError" class="chat-history-state chat-history-error">
          <PixelIcon name="alert" size="sm" />
          <span>历史记录同步失败：{{ historyError }}</span>
        </div>

        <div v-if="threadStore.isLoadingOlderHistory" class="chat-history-state">
          <PixelIcon name="refresh" size="sm" animation="spin" />
          <span>正在加载更早消息...</span>
        </div>

        <MessageBubble
          v-for="msg in messages"
          :key="msg.id"
          v-memo="[
            msg,
            msg.surface?.revision,
            playingMsgId === msg.id,
            isLoadingAudio,
            isGenerating,
            threadStore.ragProgressMessage,
            threadStore.ragFailureTrace,
          ]"
          :message="msg"
          :agent-name="agentName"
          :agent-avatar-url="agentAvatarUrl"
          :progress-label="threadStore.ragProgressMessage ?? ''"
          :rag-failure="
            msg.ragFailureTrace ??
            (isGenerating && msg === messages[messages.length - 1]
              ? threadStore.ragFailureTrace
              : null)
          "
          :is-streaming="
            isGenerating && msg === messages[messages.length - 1] && msg.role === 'assistant'
          "
          @edit="handleEdit"
          @delete-pair="handleDeletePair"
          @copy="handleCopy"
          @tts-play="handleTtsPlay"
          @vue:mounted="onBubbleMounted"
          @vue:unmounted="onBubbleUnmounted"
        />
      </div>
    </div>

    <div v-if="showApprovals && interactionSurfaces.length" class="chat-approvals">
      <ConversationSurface
        v-for="surface in interactionSurfaces"
        :key="surface.surfaceId"
        :surface="surface"
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

.chat-messages-region {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-conversation-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.chat-conversation-background__image {
  position: absolute;
  inset: calc(var(--chat-background-blur, 0px) * -2);
  background-image: var(--chat-background-image, none);
  background-size: cover;
  background-position: var(--chat-background-position, 50% 50%);
  background-repeat: no-repeat;
  opacity: var(--chat-background-opacity, 0);
  filter: blur(var(--chat-background-blur, 0px)) brightness(var(--chat-background-brightness, 1))
    saturate(var(--chat-background-saturation, 1)) contrast(var(--chat-background-contrast, 1));
}

.chat-conversation-background__overlay {
  position: absolute;
  inset: 0;
  background: rgba(
    248,
    250,
    252,
    calc(var(--chat-background-enabled, 0) * (0.06 + var(--chat-background-overlay, 0) * 0.94))
  );
}

:global([data-theme='dark']) .chat-conversation-background__overlay {
  background: rgba(
    5,
    7,
    12,
    calc(var(--chat-background-enabled, 0) * (0.32 + var(--chat-background-overlay, 0) * 0.68))
  );
}

.chat-messages {
  position: relative;
  z-index: 1;
  height: 100%;
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

.chat-container :deep(.deck--compact) {
  max-width: 100%;
  min-width: 0;
}
.chat-container :deep(.deck--compact .deck-status) {
  width: 100%;
}

.chat-input-area {
  min-width: 0;
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
