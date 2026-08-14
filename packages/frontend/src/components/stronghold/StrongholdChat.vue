<script setup lang="ts">
/**
 * StrongholdChat — 据点群聊数据适配器
 *
 * 本组件不实现独立的气泡或输入框，只负责把据点 group 消息映射到
 * 普通对话共用的 MessageBubble，并复用 InputBar（CHAR OPS）。
 * 数据源仍是 group_chat_messages，不接触 desktop ThreadStore。
 */
import { computed, nextTick, ref, watch } from 'vue'
import MessageBubble from '../chat/MessageBubble.vue'
import InputBar, { type MentionCandidate } from '../chat/InputBar.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ChatMessage } from '../chat/MessageBubble.vue'
import type { GroupMessage } from '../../api/modules/strongholdApi'
import type { AgentProfileMap } from '../../composables/useStronghold'
import { renderChatRichText } from '../../lib/chatRichRenderer'
import { useNotificationStore } from '../../stores/useNotificationStore'

interface Props {
  messages: GroupMessage[]
  profiles?: AgentProfileMap
  /** @ 弹窗的候选成员（当前房间在场的 Agent，用于 @ 选人）。 */
  mentionCandidates?: MentionCandidate[]
  isLoading?: boolean
  isSending?: boolean
  isAwaitingReply?: boolean
  replyStatus?: string
  roomName?: string
  participantCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  profiles: () => new Map(),
  mentionCandidates: () => [],
  isLoading: false,
  isSending: false,
  isAwaitingReply: false,
  replyStatus: '',
  roomName: '',
  participantCount: 0,
})

const emit = defineEmits<{
  send: [content: string, mentions: string[], complete: (success: boolean) => void]
  /** 删除单条群聊消息（messageId 为 group_chat_messages 主键） */
  delete: [messageId: number]
}>()

const messageList = ref<HTMLElement | null>(null)
const notify = useNotificationStore()

/** 将 SQLite localtime 时间转换为毫秒时间戳。 */
function parseTimestamp(raw?: string): number | undefined {
  if (!raw) return undefined
  const value = new Date(raw.replace(' ', 'T')).getTime()
  return Number.isNaN(value) ? undefined : value
}

function isSystemMessage(message: GroupMessage): boolean {
  return message.role === 'system' || ['butler', 'system'].includes(message.senderId.toLowerCase())
}

function profileName(senderId: string): string {
  return props.profiles.get(senderId)?.name ?? senderId
}

/** 据点消息映射到普通对话共用的气泡数据结构。 */
const bubbleMessages = computed<Array<ChatMessage & { agentName: string; agentAvatarUrl: string }>>(
  () =>
    props.messages.map((message) => {
      const system = isSystemMessage(message)
      const name = system
        ? message.senderId.toLowerCase() === 'butler'
          ? '管家'
          : '系统'
        : profileName(message.senderId)
      return {
        id: String(message.id),
        role: system ? 'system' : message.role,
        content: message.content,
        timestamp: parseTimestamp(message.timestamp),
        senderId: message.senderId,
        renderedHtml: renderChatRichText(message.content),
        agentName: name,
        agentAvatarUrl: props.profiles.get(message.senderId)?.avatarUrl ?? '',
      }
    }),
)

/** CHAR OPS 的发送适配：据点当前只接受文本，上传 desktop Thread 附件。
 * @param mentions 被 @ 的 Agent ID 列表（含 '@all'）。
 */
function handleSend(
  text: string,
  mentions: string[],
  attachmentIds: string[],
  _imageMode: 'auto' | 'native' | 'relay',
  complete: (success: boolean) => void,
): void {
  if (attachmentIds.length > 0) {
    notify.toast('据点群聊暂不支持附件，请使用文本消息', { type: 'warning' })
    complete(false)
    return
  }
  emit('send', text, mentions, complete)
}

async function copyMessage(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    notify.toast('已复制到剪贴板', { type: 'success' })
  } catch {
    notify.toast('复制失败', { type: 'error' })
  }
}

/**
 * 复用 MessageBubble 的 deletePair 事件作为据点单条删除：
 * 群聊里删除“整对”没有意义，气泡 ID 直接映射为群聊消息主键。
 */
function handleDeletePair(id: string): void {
  const messageId = Number(id)
  if (Number.isInteger(messageId) && messageId > 0) {
    emit('delete', messageId)
  }
}

watch(
  () => [props.messages.length, props.isAwaitingReply] as const,
  async () => {
    await nextTick()
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  },
)
</script>

<template>
  <section class="stronghold-chat-adapter">
    <div ref="messageList" class="stronghold-message-list">
      <div v-if="isLoading && messages.length === 0" class="stronghold-chat-state">
        <PixelIcon name="refresh" size="sm" animation="spin" />
        <span>正在同步「{{ roomName }}」的群聊记录...</span>
      </div>
      <div v-else-if="messages.length === 0" class="stronghold-chat-state">
        <PixelIcon name="message" size="lg" />
        <strong>这个房间还很安静</strong>
        <span>发送消息后，房间里的角色会根据群聊上下文接话。</span>
      </div>

      <MessageBubble
        v-for="message in bubbleMessages"
        :key="message.id"
        :message="message"
        :agent-name="message.agentName"
        :agent-avatar-url="message.agentAvatarUrl"
        :allow-mutations="true"
        :mutation-actions="['delete']"
        delete-action-label="删除消息"
        @copy="copyMessage"
        @delete-pair="handleDeletePair"
      />

      <!-- 调度/生成等待态：使用与普通对话一致的助手气泡骨架。 -->
      <div v-if="isAwaitingReply" class="stronghold-reply-state">
        <span class="stronghold-reply-avatar">
          <PixelIcon name="paw" size="sm" />
        </span>
        <div>
          <strong>房间里的角色正在接话</strong>
          <span>{{ replyStatus || '正在理解群聊上下文并准备回复...' }}</span>
        </div>
        <PixelIcon name="refresh" size="xs" animation="spin" />
      </div>
    </div>

    <div class="stronghold-input-area">
      <InputBar
        channel="group"
        :context-label="roomName || '据点房间'"
        :participant-label="`${participantCount} 位角色在场`"
        :placeholder="roomName ? `在「${roomName}」的群聊中发言...` : '向据点群聊发送消息...'"
        :mention-candidates="mentionCandidates"
        :is-sending="isSending || isAwaitingReply"
        :disabled="!roomName"
        @send="handleSend"
      />
    </div>
  </section>
</template>

<style scoped>
.stronghold-chat-adapter {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: transparent;
}

.stronghold-message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px 8px;
}

.stronghold-message-list::-webkit-scrollbar {
  width: 5px;
}

.stronghold-message-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--ui-scrollbar-thumb, rgba(15, 23, 42, 0.14));
}

.stronghold-chat-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}

.stronghold-chat-state strong {
  color: var(--ui-text-secondary);
  font-family: var(--ui-font-pixel), 'Zpix', monospace;
  font-size: 14px;
}

.stronghold-reply-state {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 75%;
  margin: 4px 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-accent-purple);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-tertiary);
}

.stronghold-reply-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
}

.stronghold-reply-state > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stronghold-reply-state strong {
  color: var(--ui-text-primary);
  font-size: 11px;
}

.stronghold-reply-state span {
  font-size: 10px;
}

.stronghold-reply-state > .pixel-icon {
  margin-left: auto;
  color: var(--ui-accent-purple);
}

.stronghold-input-area {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
}
</style>
