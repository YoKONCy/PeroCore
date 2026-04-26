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
import ConfirmOverlay from './ConfirmOverlay.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ChatMessage as BubbleMessage } from './MessageBubble.vue'
import type { ActiveCommand } from './CommandOverlay.vue'
import type { PendingConfirmation } from './ConfirmOverlay.vue'
import { useChatScroll, useMessageVisibility } from '../../composables'
import { useChat } from '../../composables/chat/useChat'
import { useStreamMarkdown } from '../../composables/chat/useStreamMarkdown'
import { useSessionStore } from '../../stores'
import { Marked } from 'marked'
import { logger } from '../../lib/logger'
import { chatApi } from '../../api/modules/chatApi'

export interface Props {
  /** 目标 Agent ID */
  agentId: string
  /** Agent 名称 */
  agentName?: string
}

withDefaults(defineProps<Props>(), {
  agentName: 'Pero',
})

const containerRef = ref<HTMLElement | null>(null)

// ── 对话管道 (F3: 真实 SSE 流) ──
const {
  messages: chatMessages,
  isGenerating,
  sendMessage: chatSend,
  stopGeneration,
} = useChat({ source: 'desktop' })

const sessionStore = useSessionStore()

// ── Markdown 渲染器 ──
const marked = new Marked({ breaks: true, gfm: true })
const renderMd = (md: string): string => marked.parse(md) as string

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
const pendingConfirmation = ref<PendingConfirmation | null>(null)

// ── 消息列表 ──

/** 映射 store → MessageBubble 格式（含 renderedHtml + toolCalls） */
const messages = computed<BubbleMessage[]>(() => {
  return chatMessages.value.map((m, idx) => {
    const isLast = idx === chatMessages.value.length - 1
    const isStreamingMsg = isGenerating.value && isLast && m.role === 'assistant'

    // 流式消息用 useStreamMarkdown 的输出，历史消息用全量渲染
    let renderedHtml: string | undefined
    if (m.role === 'assistant' && m.content) {
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
      timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
      senderId: m.senderId,
      images: m.images,
      segments: undefined,
      renderedHtml,
      toolCalls: m.toolCalls,
    }
  })
})

const messageCount = computed(() => messages.value.length)

// ── 滚动管理 ──

const { showScrollDown, scrollToBottom } = useChatScroll(containerRef, messageCount)

// ── IntersectionObserver 不可见消息暂停 ──

const { observe, unobserve } = useMessageVisibility(containerRef)

function onBubbleMounted(el: HTMLElement) {
  observe(el)
}

function onBubbleUnmounted(el: HTMLElement) {
  unobserve(el)
}

// ── 发送消息 ──

async function handleSend(text: string, _images: string[]) {
  await chatSend(text)
  await nextTick()
  scrollToBottom()
}

/** 停止生成 */
async function handleStop() {
  await stopGeneration()
}

/** 跳过指令等待 */
function handleSkipCommand() {
  activeCommand.value = null
}

/** 响应指令确认 */
function handleConfirmResponse(approved: boolean) {
  pendingConfirmation.value = null
  if (approved) {
    logger.info('ChatContainer', '用户批准指令执行')
  }
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

/** 保存编辑 */
function saveEdit() {
  if (!editingMessage.value) return
  sessionStore.editMessage(editingMessage.value.id, editText.value)
  editingMessage.value = null
  editText.value = ''
}

/** 取消编辑 */
function cancelEdit() {
  editingMessage.value = null
  editText.value = ''
}

/** 级联删除对话对 (用户+助手) */
function handleDeletePair(id: string) {
  // 本地: 找到相邻的对话对并删除 (user 和紧跟其后的 assistant)
  const idx = sessionStore.messages.findIndex((m) => m.id === id)
  if (idx >= 0) {
    const msg = sessionStore.messages[idx]!
    const pairIds = [id]

    if (msg.role === 'user' && idx + 1 < sessionStore.messages.length) {
      // 用户消息: 也删紧跟其后的助手回复
      const next = sessionStore.messages[idx + 1]!
      if (next.role === 'assistant') pairIds.push(next.id)
    } else if (msg.role === 'assistant' && idx - 1 >= 0) {
      // 助手消息: 也删其前的用户消息
      const prev = sessionStore.messages[idx - 1]!
      if (prev.role === 'user') pairIds.push(prev.id)
    }

    sessionStore.messages = sessionStore.messages.filter((m) => !pairIds.includes(m.id))
  }

  // 后端同步 (异步，不阻塞 UI)
  const numId = Number(id)
  if (Number.isInteger(numId) && numId > 0) {
    chatApi.deleteMessagePair(numId).catch((err) => {
      logger.error('ChatContainer', '对话对删除同步失败', err)
    })
  }
}

/** 复制消息内容到剪贴板 */
async function handleCopy(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    logger.info('ChatContainer', '消息已复制到剪贴板')
  } catch (err) {
    logger.error('ChatContainer', '复制失败', err)
  }
}

onMounted(() => {
  scrollToBottom(false)
})

onUnmounted(() => {
  // 清理（composable 内部已处理 observer disconnect）
})
</script>

<template>
  <div class="chat-container">
    <!-- 指令执行遮罩 -->
    <CommandOverlay :command="activeCommand" @skip="handleSkipCommand" />

    <!-- 指令确认遮罩 -->
    <ConfirmOverlay
      :confirmation="pendingConfirmation"
      :agent-name="agentName"
      @respond="handleConfirmResponse"
    />

    <!-- 消息列表 -->
    <div ref="containerRef" class="chat-messages">
      <MessageBubble
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :agent-name="agentName"
        :is-streaming="
          isGenerating && msg === messages[messages.length - 1] && msg.role === 'assistant'
        "
        @edit="handleEdit"
        @delete-pair="handleDeletePair"
        @copy="handleCopy"
        @vue:mounted="($event: any) => onBubbleMounted($event.el)"
        @vue:unmounted="($event: any) => onBubbleUnmounted($event.el)"
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
      <InputBar :is-sending="isGenerating" @send="handleSend" @stop="handleStop" />
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
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
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
  background: var(--color-sky-light);
}

.chat-input-area {
  flex-shrink: 0;
  padding: 0 24px 24px;
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
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  z-index: 10;
}
.chat-scroll-down:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
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

/* ── 不可见消息暂停 CSS ── */
:deep(.msg-paused) {
  content-visibility: auto;
  /* contain-intrinsic-size 由 JS 动态设置 */
}

:deep(.msg-paused) video,
:deep(.msg-paused) canvas {
  visibility: hidden;
}

/* 暂停 CSS 动画 */
:deep(.msg-paused) * {
  animation-play-state: paused !important;
}

/* ── 流式渲染区域 ── */
:deep(.stream-stable) {
  /* 已闭合区域不再变化，允许浏览器优化渲染 */
  contain: content;
}

:deep(.stream-tail) {
  /* 尾部每帧更新，不启用 contain — 保持正常渲染流 */
  contain: none;
}
</style>

<!-- 编辑对话框样式 (Teleport 到 body 需要非 scoped) -->
<style>
.chat-edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.15s;
}

.chat-edit-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--color-bg-primary, #fff);
  border: 2px solid var(--color-border, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.chat-edit-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary, #1e293b);
}

.chat-edit-textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px;
  border: 2px solid var(--color-border, #e2e8f0);
  background: var(--color-bg-secondary, #f8fafc);
  color: var(--color-text-primary, #1e293b);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.chat-edit-textarea:focus {
  border-color: var(--color-sky-hover, #38bdf8);
}

.chat-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chat-edit-btn {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s;
}

.chat-edit-cancel {
  background: var(--color-bg-secondary, #f1f5f9);
  color: var(--color-text-secondary, #64748b);
  border-color: var(--color-border, #e2e8f0);
}

.chat-edit-cancel:hover {
  background: var(--color-bg-primary, #fff);
}

.chat-edit-save {
  background: var(--color-sky-500, #0ea5e9);
  color: white;
  border-color: var(--color-sky-shadow, #0284c7);
}

.chat-edit-save:hover {
  background: var(--color-sky-hover, #38bdf8);
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
