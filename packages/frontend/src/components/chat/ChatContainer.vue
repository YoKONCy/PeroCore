<script setup lang="ts">
/**
 * ChatContainer — 聊天主容器
 *
 * 组装消息列表 + 输入框 + 指令遮罩，接管滚动和流式逻辑。
 * 从 useSessionStore 获取消息，通过 chatApi 发送。
 *
 * @props agentId - 目标 Agent ID
 * @props agentName - Agent 名称
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import MessageBubble from './MessageBubble.vue'
import InputBar from './InputBar.vue'
import CommandOverlay from './CommandOverlay.vue'
import ConfirmOverlay from './ConfirmOverlay.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ChatMessage as BubbleMessage } from './MessageBubble.vue'
import type { ActiveCommand } from './CommandOverlay.vue'
import type { PendingConfirmation } from './ConfirmOverlay.vue'
import { useChatScroll, useMessageVisibility } from '../../composables'
import { useSessionStore } from '../../stores'

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
const store = useSessionStore()

// ── 指令遮罩状态 ──

const activeCommand = ref<ActiveCommand | null>(null)
const pendingConfirmation = ref<PendingConfirmation | null>(null)

// ── 消息列表 ──

/** 映射 store → MessageBubble 格式 */
const messages = computed<BubbleMessage[]>(() => {
  return store.messages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content ?? '',
    timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
    senderId: m.senderId,
    images: m.images,
    // TODO: 接入 parseMessage 段落解析
    segments: undefined,
  }))
})

const messageCount = computed(() => messages.value.length)

// ── 滚动管理 (12_FRONTEND_PERFORMANCE §3) ──

const { showScrollDown, scrollToBottom } = useChatScroll(containerRef, messageCount)

// ── IntersectionObserver 不可见消息暂停 (§3.3) ──

const { observe, unobserve } = useMessageVisibility(containerRef)

/** 消息元素挂载时注册观察 */
function onBubbleMounted(el: HTMLElement) {
  observe(el)
}

/** 消息元素卸载时取消观察 */
function onBubbleUnmounted(el: HTMLElement) {
  unobserve(el)
}

// ── 发送消息 ──

async function handleSend(text: string, images: string[]) {
  store.addMessage({
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
    images: images.length > 0 ? images : undefined,
  })

  // 发送后滚动到底部
  await nextTick()
  scrollToBottom()

  // TODO: 接入 chatApi.sendMessage + SSE 流式 (useStreamMarkdown)
  store.generationState = 'generating'

  // 临时模拟
  setTimeout(() => {
    store.addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `[模拟回复] 收到消息: "${text}"`,
      timestamp: new Date().toISOString(),
    })
    store.generationState = 'idle'
  }, 1000)
}

/** 停止生成 */
function handleStop() {
  // TODO: chatApi.stopGeneration
  store.generationState = 'idle'
}

/** 跳过指令等待 */
function handleSkipCommand() {
  activeCommand.value = null
}

/** 响应指令确认 */
function handleConfirmResponse(approved: boolean) {
  // TODO: chatApi.respondConfirmation(approved)
  pendingConfirmation.value = null
  if (approved) {
    // eslint-disable-next-line no-console
    console.log('[ChatContainer] 用户批准指令执行')
  }
}

/** 编辑消息 */
function handleEdit(msg: BubbleMessage) {
  // TODO: 实现消息编辑
  void msg
}

/** 删除消息 */
function handleDelete(id: string) {
  // TODO: 实现消息删除
  void id
}

onMounted(() => {
  // TODO: 接入 useHistoryRenderer 分批加载历史消息
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
          store.isGenerating && msg === messages[messages.length - 1] && msg.role === 'assistant'
        "
        @edit="handleEdit"
        @delete="handleDelete"
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
      <InputBar :is-sending="store.isGenerating" @send="handleSend" @stop="handleStop" />
    </div>
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
  background: var(--color-blue-200);
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
  border-color: var(--color-blue-400);
  color: var(--color-blue-500);
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
</style>
