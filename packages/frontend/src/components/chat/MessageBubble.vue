<script setup lang="ts">
/**
 * MessageBubble — 单条消息气泡
 *
 * 根据消息角色 (user/assistant) 渲染不同样式的气泡。
 * F3: 支持 v-html Markdown 渲染 + 工具调用展示 + 流式光标。
 */
import { ref } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import MessageSegment from './MessageSegment.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import type { Segment } from './MessageSegment.vue'

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string
  args: string
  result?: string
  isError?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  senderId?: string
  images?: string[]
  segments?: Segment[]
  /** 渲染后的 HTML（由 useStreamMarkdown 提供） */
  renderedHtml?: string
  /** 工具调用信息 */
  toolCalls?: ToolCallInfo[]
}

interface Props {
  message: ChatMessage
  agentName?: string
  isStreaming?: boolean
  /** 当前正在播放 TTS 的消息 ID */
  playingMsgId?: string | null
  /** TTS 音频加载中 */
  isLoadingAudio?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  agentName: 'Pero',
  isStreaming: false,
  playingMsgId: null,
  isLoadingAudio: false,
})

const emit = defineEmits<{
  edit: [msg: ChatMessage]
  deletePair: [id: string]
  copy: [content: string]
  /** TTS 播放/停止切换 */
  ttsPlay: [msg: ChatMessage]
}>()

/** 工具调用展开/折叠 */
const expandedTools = ref<Set<number>>(new Set())
function toggleTool(idx: number) {
  if (expandedTools.value.has(idx)) {
    expandedTools.value.delete(idx)
  } else {
    expandedTools.value.add(idx)
  }
  // 触发响应性
  expandedTools.value = new Set(expandedTools.value)
}

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
          <button class="msg-action-btn" title="复制" @click="emit('copy', message.content)">
            <PixelIcon name="copy" size="xs" />
          </button>
          <button class="msg-action-btn" @click="emit('edit', message)">
            <PixelIcon name="edit" size="xs" />
          </button>
          <button
            class="msg-action-btn msg-action-btn-danger"
            title="删除对话对"
            @click="emit('deletePair', message.id)"
          >
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
          <!-- TTS 播放按钮（ playMessage） -->
          <button
            v-if="message.role === 'assistant' && message.content && !isStreaming"
            class="msg-action-btn"
            :class="{ 'msg-action-btn-active': props.playingMsgId === message.id }"
            :title="props.playingMsgId === message.id ? '停止播放' : '朗读此消息'"
            @click="emit('ttsPlay', message)"
          >
            <PixelIcon
              :name="
                props.playingMsgId === message.id
                  ? 'square'
                  : props.isLoadingAudio && props.playingMsgId === message.id
                    ? 'loader'
                    : 'volume-2'
              "
              size="xs"
            />
          </button>
          <button class="msg-action-btn" title="复制" @click="emit('copy', message.content)">
            <PixelIcon name="copy" size="xs" />
          </button>
          <button class="msg-action-btn" @click="emit('edit', message)">
            <PixelIcon name="edit" size="xs" />
          </button>
          <button
            class="msg-action-btn msg-action-btn-danger"
            title="删除对话对"
            @click="emit('deletePair', message.id)"
          >
            <PixelIcon name="trash" size="xs" />
          </button>
        </div>
      </div>

      <!-- 消息体 -->
      <div class="msg-bubble msg-bubble-assistant">
        <!-- 思考中（无内容时） -->
        <ThinkingIndicator v-if="isStreaming && !message.content" :name="agentName" />

        <!-- 段落列表 -->
        <template v-else-if="message.segments?.length">
          <MessageSegment v-for="(seg, idx) in message.segments" :key="idx" :segment="seg" />
        </template>

        <!-- Markdown HTML 渲染（优先 renderedHtml） -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else-if="message.renderedHtml" class="msg-markdown" v-html="message.renderedHtml" />

        <!-- 纯文本回退 -->
        <div v-else class="msg-plain-text">
          {{ message.content }}
        </div>

        <!-- 流式光标 -->
        <span v-if="isStreaming && message.content" class="msg-streaming-cursor" />

        <!-- 工具调用展示 -->
        <div v-if="message.toolCalls?.length" class="msg-tools">
          <div
            v-for="(tc, idx) in message.toolCalls"
            :key="idx"
            class="msg-tool-item"
            @click="toggleTool(idx)"
          >
            <div class="msg-tool-header">
              <PixelIcon name="settings" size="xs" />
              <span class="msg-tool-name">{{ tc.name }}</span>
              <span
                v-if="tc.result"
                :class="['msg-tool-badge', tc.isError ? 'msg-tool-error' : 'msg-tool-ok']"
              >
                {{ tc.isError ? '失败' : '完成' }}
              </span>
              <span v-else class="msg-tool-badge msg-tool-running">执行中...</span>
              <PixelIcon
                :name="expandedTools.has(idx) ? 'chevron-up' : 'chevron-down'"
                size="xs"
                class="msg-tool-chevron"
              />
            </div>
            <div v-if="expandedTools.has(idx)" class="msg-tool-detail">
              <div v-if="tc.args" class="msg-tool-section">
                <span class="msg-tool-label">参数</span>
                <pre class="msg-tool-pre">{{ tc.args }}</pre>
              </div>
              <div v-if="tc.result" class="msg-tool-section">
                <span class="msg-tool-label">结果</span>
                <pre :class="['msg-tool-pre', tc.isError ? 'msg-tool-pre-error' : '']">{{
                  tc.result
                }}</pre>
              </div>
            </div>
          </div>
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
  background: var(--color-sky-500);
  color: white;
  border: 2px solid var(--color-sky-shadow);
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
  background: linear-gradient(135deg, var(--color-sky-hover), var(--color-sky-shadow));
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
  background: var(--color-emerald-face, #22c55e);
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
  color: var(--color-sky-500);
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
  color: var(--color-sky-500);
}
.msg-action-btn-danger:hover {
  color: var(--color-red-face, #ef4444);
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

/* Markdown 渲染容器 */
.msg-markdown {
  color: var(--color-text-primary);
  line-height: 1.6;
  word-break: break-word;
}
.msg-markdown :deep(p) {
  margin: 4px 0;
}
.msg-markdown :deep(pre) {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
  margin: 8px 0;
}
.msg-markdown :deep(code) {
  font-size: 12px;
  background: var(--color-bg-secondary);
  padding: 1px 4px;
}
.msg-markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.msg-markdown :deep(ul),
.msg-markdown :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.msg-markdown :deep(blockquote) {
  border-left: 3px solid var(--color-sky-hover);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--color-text-secondary);
}

/* 流式光标 */
.msg-streaming-cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  background: var(--color-sky-hover);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: cursor-blink 0.8s steps(2) infinite;
}

/* 工具调用区 */
.msg-tools {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg-tool-item {
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  cursor: pointer;
  transition: border-color 0.15s;
}
.msg-tool-item:hover {
  border-color: var(--color-sky-light);
}
.msg-tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
}
.msg-tool-name {
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: monospace;
}
.msg-tool-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
}
.msg-tool-ok {
  color: var(--color-emerald-shadow, #16a34a);
  background: rgba(34, 197, 94, 0.1);
}
.msg-tool-error {
  color: var(--color-red-face, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}
.msg-tool-running {
  color: var(--color-sky-500);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
}
.msg-tool-chevron {
  margin-left: auto;
  color: var(--color-text-muted);
}
.msg-tool-detail {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg-tool-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.msg-tool-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}
.msg-tool-pre {
  font-size: 11px;
  font-family: monospace;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  padding: 6px 8px;
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
.msg-tool-pre-error {
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-red-face, #ef4444);
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

@keyframes cursor-blink {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
</style>
