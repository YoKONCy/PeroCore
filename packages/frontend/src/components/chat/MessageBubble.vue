<script setup lang="ts">
/**
 * MessageBubble — 单条消息气泡
 *
 * 根据消息角色 (user/assistant) 渲染不同样式的气泡。
 * assistant 消息内部使用 MessageSegment 解析段落。
 */
import PixelIcon from '../pixel/PixelIcon.vue'
import MessageSegment from './MessageSegment.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import type { Segment } from './MessageSegment.vue'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  /** 发送者 ID (多 Agent 场景) */
  senderId?: string
  /** 用户消息附带的图片 */
  images?: string[]
  /** 解析后的段落 (assistant 用) */
  segments?: Segment[]
}

interface Props {
  message: ChatMessage
  /** Agent 名称 (显示头像) */
  agentName?: string
  /** 是否为最新正在生成的消息 */
  isStreaming?: boolean
}

withDefaults(defineProps<Props>(), {
  agentName: 'Pero',
  isStreaming: false,
})

const emit = defineEmits<{
  edit: [msg: ChatMessage]
  delete: [id: string]
}>()

/** 格式化时间 */
function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
</script>

<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="msg-row msg-row-user">
    <div class="msg-bubble-container msg-user-container">
      <!-- 图片 -->
      <div v-if="message.images?.length" class="msg-images">
        <img
          v-for="(img, idx) in message.images"
          :key="idx"
          :src="img"
          class="msg-image"
          alt="用户图片"
        />
      </div>

      <!-- 文字气泡 -->
      <div class="msg-bubble msg-bubble-user">
        {{ message.content }}
      </div>

      <!-- 时间 + 操作 -->
      <div class="msg-meta msg-meta-user">
        <div class="msg-actions">
          <button class="msg-action-btn" @click="emit('edit', message)">
            <PixelIcon name="edit" size="xs" />
          </button>
          <button class="msg-action-btn msg-action-btn-danger" @click="emit('delete', message.id)">
            <PixelIcon name="trash" size="xs" />
          </button>
        </div>
        <span class="msg-time">{{ formatTime(message.timestamp) }}</span>
      </div>
    </div>
  </div>

  <!-- 助手消息 -->
  <div v-else class="msg-row msg-row-assistant">
    <!-- 头像 -->
    <div class="msg-avatar">
      <span class="msg-avatar-text">{{ agentName?.[0]?.toUpperCase() ?? 'P' }}</span>
      <div class="msg-avatar-status" />
    </div>

    <div class="msg-bubble-container msg-assistant-container">
      <!-- 名称与时间 -->
      <div class="msg-assistant-header">
        <span class="msg-assistant-name">{{ agentName }}</span>
        <span class="msg-time">{{ formatTime(message.timestamp) }}</span>
        <div class="msg-actions">
          <button class="msg-action-btn" @click="emit('edit', message)">
            <PixelIcon name="edit" size="xs" />
          </button>
          <button class="msg-action-btn msg-action-btn-danger" @click="emit('delete', message.id)">
            <PixelIcon name="trash" size="xs" />
          </button>
        </div>
      </div>

      <!-- 消息体 -->
      <div class="msg-bubble msg-bubble-assistant">
        <!-- 思考中 -->
        <ThinkingIndicator
          v-if="isStreaming && !message.content"
          :name="agentName"
        />

        <!-- 段落列表 -->
        <template v-else-if="message.segments?.length">
          <MessageSegment
            v-for="(seg, idx) in message.segments"
            :key="idx"
            :segment="seg"
          />
        </template>

        <!-- 纯文本回退 -->
        <div v-else class="msg-plain-text">
          {{ message.content }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  margin-bottom: 16px;
  animation: fade-in-up 0.3s ease-out;
}
.msg-row-user {
  justify-content: flex-end;
}
.msg-row-assistant {
  justify-content: flex-start;
  gap: 12px;
}

.msg-bubble-container {
  max-width: 85%;
}

/* 用户气泡 */
.msg-bubble-user {
  padding: 10px 16px;
  background: var(--color-blue-500);
  color: white;
  border: 2px solid var(--color-blue-600);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 助手气泡 */
.msg-bubble-assistant {
  padding: 12px 16px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 200px;
}

/* 头像 */
.msg-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-blue-400), var(--color-blue-600));
  color: white;
  font-weight: 700;
  font-size: 14px;
  position: relative;
}
.msg-avatar-status {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: var(--color-green-500, #22c55e);
  border: 2px solid white;
}

.msg-avatar-text {
  user-select: none;
}

/* 助手头部 */
.msg-assistant-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  margin-left: 4px;
  opacity: 0;
  transition: opacity 0.3s;
}
.msg-row-assistant:hover .msg-assistant-header {
  opacity: 1;
}

.msg-assistant-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-blue-500);
}

/* 通用 */
.msg-time {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.msg-meta-user {
  justify-content: flex-end;
  margin-right: 4px;
}

.msg-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.msg-row:hover .msg-actions {
  opacity: 1;
}

.msg-action-btn {
  padding: 2px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}
.msg-action-btn:hover {
  color: var(--color-blue-500);
}
.msg-action-btn-danger:hover {
  color: var(--color-red-500, #ef4444);
}

/* 图片 */
.msg-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.msg-image {
  max-height: 128px;
  border: 2px solid var(--color-border);
  object-fit: cover;
  cursor: pointer;
  transition: transform 0.15s;
}
.msg-image:hover {
  transform: scale(1.05);
}

.msg-plain-text {
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: pre-wrap;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
