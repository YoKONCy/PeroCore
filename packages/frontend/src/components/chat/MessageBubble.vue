<script setup lang="ts">
/**
 * MessageBubble — 单条消息气泡
 *
 * 根据消息角色 (user/assistant) 渲染不同样式的气泡。
 * F3: 支持 v-html Markdown 渲染 + 工具调用展示 + 流式光标。
 */
import { ref, computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import MessageSegment from './MessageSegment.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import ChatRichText from './ChatRichText.vue'
import ToolCallCard from '../tools/ToolCallCard.vue'
import type { Segment } from './MessageSegment.vue'
import type { ThreadAttachmentInfo } from '../../api/modules/threadsApi'
import { attachmentsApi } from '../../api/modules/attachmentsApi'

/** 工具调用信息 */
export interface ToolCallInfo {
  name: string
  args: string
  result?: string
  isError?: boolean
  /** 工具执行耗时（毫秒） */
  durationMs?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 从原始转写中提取的 Thinking 内容。 */
  thinkingContent?: string
  timestamp?: number
  senderId?: string
  images?: string[]
  attachments?: ThreadAttachmentInfo[]
  segments?: Segment[]
  /** 渲染后的 HTML（由 useStreamMarkdown 提供） */
  renderedHtml?: string
  /** 图片理解文字档案。 */
  imageTranscription?: boolean
  /** 工具调用信息 */
  toolCalls?: ToolCallInfo[]
}

interface Props {
  message: ChatMessage
  agentName?: string
  /** Agent 头像 URL。 */
  agentAvatarUrl?: string
  /** 是否显示编辑/删除等仅 desktop 支持的持久化操作。 */
  allowMutations?: boolean
  /** 允许显示的持久化操作按钮（配合 allowMutations）。据点多角色场景通常只需删除。 */
  mutationActions?: Array<'edit' | 'delete'>
  /** 删除按钮的悬浮提示（据点群聊为“删除消息”，桌面为“删除对话对”）。 */
  deleteActionLabel?: string
  isStreaming?: boolean
  /** 当前正在播放 TTS 的消息 ID */
  playingMsgId?: string | null
  /** TTS 音频加载中 */
  isLoadingAudio?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  agentName: '助手',
  agentAvatarUrl: '',
  allowMutations: true,
  mutationActions: () => ['edit' as const, 'delete' as const],
  deleteActionLabel: '删除对话对',
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

const isThinkingExpanded = ref(false)
const EMPTY_REPLY_PATTERN = /^\(?\s*(?:本次回复无可见正文，详情请查看调试视图|仅有内部过程)\s*\)?$/
const isInternalOnly = computed(() => EMPTY_REPLY_PATTERN.test(props.message.content.trim()))
const thinkingSections = computed(() =>
  (props.message.thinkingContent ?? '')
    .split(/\n\s*\n+/)
    .map((section) => section.trim())
    .filter(Boolean),
)

async function copyThinking() {
  if (!props.message.thinkingContent) return
  await navigator.clipboard.writeText(props.message.thinkingContent)
}

function formatTime(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
</script>

<template>
  <!-- 系统/管家消息：共享气泡组件中的中性提示形态 -->
  <div v-if="message.role === 'system'" class="msg-row msg-row-system">
    <div :class="['msg-system-pill', { 'msg-image-transcription': message.imageTranscription }]">
      <PixelIcon :name="message.imageTranscription ? 'image' : 'bot'" size="xs" />
      <strong>{{ message.imageTranscription ? '图片理解记录' : agentName }}</strong>
      <ChatRichText :content="message.content" compact />
    </div>
  </div>

  <!-- 用户消息 -->
  <div v-else-if="message.role === 'user'" class="msg-row msg-row-user">
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

      <!-- 持久化附件 -->
      <div v-if="message.attachments?.length" class="msg-attachments">
        <article
          v-for="attachment in message.attachments"
          :key="attachment.id"
          class="msg-attachment"
        >
          <img
            v-if="attachment.kind === 'image'"
            :src="attachmentsApi.contentUrl(attachment.id)"
            :alt="attachment.originalName"
          />
          <PixelIcon v-else name="file" size="md" />
          <div>
            <strong>{{ attachment.originalName }}</strong>
            <span>{{ attachment.mimeType }} · {{ Math.ceil(attachment.sizeBytes / 1024) }} KB</span>
            <small v-if="attachment.kind === 'text'">仅发送当轮参与上下文</small>
          </div>
        </article>
      </div>

      <!-- 文字气泡：使用中性表面与细品牌色轨，保持正文区域克制易读。 -->
      <div class="msg-bubble msg-bubble-user">
        <ChatRichText :content="message.content" />
        <span v-if="message.timestamp" class="msg-user-time">
          {{ formatTime(message.timestamp) }}
        </span>
      </div>

      <!-- 悬浮操作：hover 时浮在气泡右下，不占布局高度 -->
      <div class="msg-actions msg-user-actions">
        <button class="msg-action-btn" title="复制" @click="emit('copy', message.content)">
          <PixelIcon name="copy" size="xs" />
        </button>
        <button
          v-if="allowMutations && mutationActions.includes('edit')"
          class="msg-action-btn"
          @click="emit('edit', message)"
        >
          <PixelIcon name="edit" size="xs" />
        </button>
        <button
          v-if="allowMutations && mutationActions.includes('delete')"
          class="msg-action-btn msg-action-btn-danger"
          :title="deleteActionLabel"
          @click="emit('deletePair', message.id)"
        >
          <PixelIcon name="trash" size="xs" />
        </button>
      </div>
    </div>
  </div>

  <!-- 助手消息 -->
  <div v-else class="msg-row msg-row-assistant">
    <!-- 头像 -->
    <div class="msg-avatar">
      <img v-if="agentAvatarUrl" :src="agentAvatarUrl" :alt="agentName" class="msg-avatar-image" />
      <span v-else class="msg-avatar-text">{{ agentName?.[0]?.toUpperCase() ?? 'P' }}</span>
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
          <button
            v-if="allowMutations && mutationActions.includes('edit')"
            class="msg-action-btn"
            @click="emit('edit', message)"
          >
            <PixelIcon name="edit" size="xs" />
          </button>
          <button
            v-if="allowMutations && mutationActions.includes('delete')"
            class="msg-action-btn msg-action-btn-danger"
            :title="deleteActionLabel"
            @click="emit('deletePair', message.id)"
          >
            <PixelIcon name="trash" size="xs" />
          </button>
        </div>
      </div>

      <!-- Thinking 折叠入口：放在气泡侧边，不干扰正文阅读。 -->
      <button
        v-if="message.thinkingContent"
        class="msg-thinking-toggle"
        :class="{ 'msg-thinking-toggle--active': isThinkingExpanded }"
        :title="isThinkingExpanded ? '收起思考过程' : '展开思考过程'"
        @click="isThinkingExpanded = !isThinkingExpanded"
      >
        <PixelIcon name="brain" size="xs" />
        <span>&lt;think&gt;</span>
        <PixelIcon :name="isThinkingExpanded ? 'chevron-up' : 'chevron-down'" size="xs" />
      </button>

      <div v-if="message.thinkingContent && isThinkingExpanded" class="msg-thinking-panel">
        <div class="msg-thinking-panel-header">
          <div>
            <span class="msg-thinking-signal" />
            <span>THINK TRACE</span>
            <small>LOCAL ONLY</small>
          </div>
          <button type="button" title="复制思考过程" @click="copyThinking">
            <PixelIcon name="copy" size="xs" />
            复制
          </button>
        </div>
        <div class="msg-thinking-timeline">
          <article
            v-for="(section, index) in thinkingSections"
            :key="index"
            class="msg-thinking-step"
          >
            <span class="msg-thinking-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <ChatRichText :content="section" compact />
          </article>
        </div>
      </div>

      <!-- 消息体 -->
      <div class="msg-bubble msg-bubble-assistant">
        <!-- 思考中（无内容时） -->
        <ThinkingIndicator v-if="isStreaming && !message.content" :name="agentName" />

        <!-- 无可见正文使用独立状态卡，不展示后端技术性兜底文案。 -->
        <div v-if="isInternalOnly" class="msg-internal-only">
          <span class="msg-internal-orb" />
          <div>
            <strong>仅有内部过程</strong>
            <small>
              {{ message.thinkingContent ? '可展开查看思考轨迹' : '本轮没有可显示的正文' }}
            </small>
          </div>
          <button v-if="message.thinkingContent" type="button" @click="isThinkingExpanded = true">
            展开思考
          </button>
        </div>

        <!-- 段落列表 -->
        <template v-else-if="message.segments?.length">
          <MessageSegment v-for="(seg, idx) in message.segments" :key="idx" :segment="seg" />
        </template>

        <!-- Markdown HTML 渲染（优先 renderedHtml） -->
        <ChatRichText
          v-else-if="message.renderedHtml"
          :content="message.content"
          :rendered-html="message.renderedHtml"
        />

        <!-- 纯文本回退 -->
        <div v-else class="msg-plain-text">
          {{ message.content }}
        </div>

        <!-- 流式光标 -->
        <span v-if="isStreaming && message.content" class="msg-streaming-cursor" />

        <!-- 工具调用展示（ToolCallCard 按工具 display 元数据格式化渲染） -->
        <div v-if="message.toolCalls?.length" class="msg-tools">
          <ToolCallCard v-for="(tc, idx) in message.toolCalls" :key="idx" :tool="tc" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-row-system {
  justify-content: center;
  margin: 6px 0 14px;
}
.msg-system-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 88%;
  padding: 7px 12px;
  border: 1px dashed var(--ui-border-default);
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent-purple-soft);
  color: var(--ui-text-secondary);
  font-size: 11px;
}
.msg-system-pill strong {
  flex-shrink: 0;
  color: var(--ui-accent-purple);
  font-size: 10px;
}
.msg-row {
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  margin-bottom: 10px;
  animation: fade-in-up 0.3s ease-out;
}
.msg-row-user {
  align-items: flex-start;
  min-height: 0;
  justify-content: flex-end;
}
.msg-user-container {
  position: relative;
  align-self: flex-start;
  height: fit-content;
}
.msg-row-assistant {
  justify-content: flex-start;
  gap: 12px;
}

.msg-bubble-container {
  min-width: 0;
  max-width: 85%;
  overflow: visible;
}

/* 用户气泡以中性表面为主体，仅保留右侧品牌色轨作为身份提示。 */
.msg-bubble-user {
  position: relative;
  padding: 8px 14px;
  color: var(--user-bubble-text);
  background: var(--user-bubble-bg);
  border: 1px solid var(--user-bubble-border);
  border-right: 3px solid var(--user-bubble-accent);
  border-radius: var(--ui-radius-sm);
  box-shadow: var(--user-bubble-shadow);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  word-break: break-word;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-out),
    box-shadow var(--ui-duration-fast) var(--ui-ease-out);
}

/* 时间悬浮在气泡左下侧，不参与文档流，也不挤占正文空间。 */
.msg-user-time {
  position: absolute;
  right: calc(100% + 6px);
  bottom: 3px;
  color: var(--user-bubble-time);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}

/* 悬浮操作浮在气泡右下方，不参与消息行高度计算。 */
.msg-user-actions {
  position: absolute;
  right: 4px;
  bottom: -13px;
  z-index: 3;
  gap: 4px;
}

.msg-bubble-user:hover {
  border-color: var(--user-bubble-border-hover);
  border-right-color: var(--user-bubble-accent);
  box-shadow: var(--user-bubble-shadow-hover);
}

/* :global 保证主题根节点不会被 scoped 属性限制。 */
:global(:root),
:global([data-theme='light']) {
  --user-bubble-bg: #f8f7fb;
  --user-bubble-text: #302d3a;
  --user-bubble-border: #e3dfe9;
  --user-bubble-border-hover: #d6cfdf;
  --user-bubble-accent: #b888d1;
  --user-bubble-time: #8b8493;
  --user-bubble-shadow: 0 1px 2px rgba(46, 39, 58, 0.06);
  --user-bubble-shadow-hover: 0 3px 10px rgba(46, 39, 58, 0.09);
}

:global([data-theme='dark']) {
  --user-bubble-bg: #26232d;
  --user-bubble-text: #ebe7ef;
  --user-bubble-border: #3c3746;
  --user-bubble-border-hover: #4a4355;
  --user-bubble-accent: #a98bc4;
  --user-bubble-time: #aaa2b2;
  --user-bubble-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  --user-bubble-shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.28);
}

/* 助手气泡: 角色化证据卡，左侧色轨体现当前伙伴 */
.msg-bubble-assistant {
  position: relative;
  padding: 14px 18px 14px 20px;
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-sm);
  box-shadow: var(--ui-shadow-sm);
  font-size: 14px;
  line-height: 1.68;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 200px;
  max-width: 100%;
  overflow: hidden;
}

.msg-bubble-assistant::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  background: linear-gradient(var(--ui-accent-primary), var(--ui-accent-purple));
  border-radius: 2px;
}

[data-theme='dark'] .msg-bubble-assistant {
  background: rgba(30, 27, 45, 0.8);
  border-color: rgba(139, 92, 246, 0.15);
}

.msg-bubble-assistant:hover {
  transform: translateY(-1px);
  box-shadow: var(--ui-shadow-md);
}

/* 头像: 像素边框仅用于 AI 头像(品牌锚点) */
.msg-avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ui-accent-sky), var(--ui-accent-purple));
  color: white;
  font-weight: 900;
  font-size: 14px;
  position: relative;
  border-radius: 4px;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  /* 像素边框 */
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa);
  transition: all var(--ui-duration-fast);
}

[data-theme='dark'] .msg-avatar {
  box-shadow:
    -2px 0 0 0 var(--ui-accent-purple),
    2px 0 0 0 var(--ui-accent-purple),
    0 -2px 0 0 var(--ui-accent-purple),
    0 2px 0 0 var(--ui-accent-purple),
    0 0 10px rgba(167, 139, 250, 0.3);
}

.msg-avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: auto;
}

.msg-avatar-status {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  background: var(--ui-success);
  border: 2px solid var(--ui-bg-surface);
  border-radius: 50%;
}

.msg-avatar-text {
  user-select: none;
}

/* Thinking 侧边折叠控件 */
.msg-thinking-toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  margin: 0 0 2px 4px;
  background: var(--ui-bg-surface-soft);
  border: 1px dashed rgba(139, 92, 246, 0.3);
  border-radius: var(--ui-radius-xs);
  color: var(--ui-accent-purple);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--ui-duration-fast);
}

.msg-thinking-toggle:hover,
.msg-thinking-toggle--active {
  background: var(--ui-accent-purple-soft);
  border-style: solid;
  box-shadow: 0 0 14px rgba(139, 92, 246, 0.11);
}

.msg-thinking-panel {
  margin: 0 0 4px 4px;
  overflow: hidden;
  background: var(--ui-bg-surface-soft);
  border: 1px solid rgba(139, 92, 246, 0.16);
  border-left: 3px solid var(--ui-accent-purple);
  border-radius: var(--ui-radius-sm);
  animation: thinking-reveal var(--ui-duration-normal) var(--ui-ease-standard);
}

.msg-thinking-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-tertiary);
  font-family: var(--font-pixel);
  font-size: 9px;
  letter-spacing: 0.1em;
  background: linear-gradient(90deg, var(--ui-accent-purple-soft), var(--ui-accent-sky-soft));
}

.msg-thinking-panel-header > div,
.msg-thinking-panel-header button {
  display: flex;
  align-items: center;
  gap: 6px;
}

.msg-thinking-panel-header small {
  opacity: 0.62;
  font-size: 8px;
}
.msg-thinking-panel-header button {
  padding: 3px 6px;
  color: var(--ui-accent-purple);
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  font: 700 9px var(--font-pixel);
  cursor: pointer;
}
.msg-thinking-signal {
  width: 7px;
  height: 7px;
  background: var(--ui-accent-purple);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent-purple) 50%, transparent);
  animation: think-signal 1.8s ease-in-out infinite;
}

.msg-thinking-timeline {
  position: relative;
  max-height: 360px;
  padding: 12px 13px 12px 42px;
  overflow: auto;
}
.msg-thinking-timeline::before {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 24px;
  width: 1px;
  background: linear-gradient(var(--ui-accent-purple), var(--ui-accent-sky), transparent);
}
.msg-thinking-step {
  position: relative;
  padding: 0 0 13px 5px;
  color: var(--ui-text-secondary);
}
.msg-thinking-step:last-child {
  padding-bottom: 0;
}
.msg-thinking-index {
  position: absolute;
  left: -37px;
  top: 2px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 18px;
  color: var(--ui-accent-purple);
  background: var(--ui-bg-surface);
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 28%, transparent);
  font: 700 9px var(--font-mono);
}

.msg-internal-only {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 270px;
  padding: 11px 12px;
  overflow: hidden;
  color: var(--ui-text-secondary);
  background: linear-gradient(105deg, var(--ui-accent-purple-soft), var(--ui-accent-sky-soft));
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 26%, transparent);
  border-radius: var(--ui-radius-sm);
}
.msg-internal-only::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 35%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  transform: translateX(-140%);
  animation: internal-scan 2.4s ease-out 1;
  pointer-events: none;
}
.msg-internal-orb {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  transform: rotate(45deg);
  background: linear-gradient(135deg, var(--ui-accent-purple), var(--ui-accent-sky));
  box-shadow: 0 0 11px color-mix(in srgb, var(--ui-accent-purple) 42%, transparent);
}
.msg-internal-only div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.msg-internal-only strong {
  color: var(--ui-text-primary);
  font: 800 11px var(--font-pixel);
}
.msg-internal-only small {
  margin-top: 2px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.msg-internal-only button {
  padding: 5px 8px;
  color: var(--ui-accent-purple);
  background: var(--ui-bg-surface);
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 28%, transparent);
  font: 700 9px var(--font-pixel);
  cursor: pointer;
}

@keyframes think-signal {
  50% {
    opacity: 0.42;
    transform: scale(0.75);
  }
}
@keyframes internal-scan {
  to {
    transform: translateX(420%);
  }
}

@keyframes thinking-reveal {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .msg-thinking-panel,
  .msg-thinking-signal,
  .msg-internal-only::after {
    animation: none;
  }
}

/* 助手头部 */
.msg-assistant-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  margin-left: 4px;
  transition: opacity 0.3s;
}
.msg-row-assistant:hover .msg-assistant-header {
  opacity: 1;
}

.msg-assistant-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--ui-accent-primary);
  font-family: var(--font-pixel);
  letter-spacing: 0.08em;
}

[data-theme='dark'] .msg-assistant-name {
  color: var(--ui-accent-purple);
}

/* 通用 */
.msg-time {
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-text-tertiary);
}

.msg-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--ui-duration-fast);
}
.msg-row:hover .msg-actions {
  opacity: 1;
}

.msg-action-btn {
  padding: 3px;
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-xs);
  color: var(--ui-text-tertiary);
  cursor: pointer;
  transition: all var(--ui-duration-fast);
}
.msg-action-btn:hover {
  color: var(--ui-accent-primary);
  border-color: var(--ui-accent-primary);
  box-shadow: var(--ui-glow-pink);
}
.msg-action-btn-danger:hover {
  color: var(--ui-danger);
  border-color: var(--ui-danger);
}

.msg-attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.msg-attachment {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 7px 9px;
  background: var(--ui-bg-surface-soft);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text-secondary);
}
.msg-attachment img {
  width: 72px;
  height: 56px;
  object-fit: cover;
  border-radius: 2px;
}
.msg-attachment div {
  min-width: 0;
}
.msg-attachment strong,
.msg-attachment span,
.msg-attachment small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-attachment strong {
  color: var(--ui-text-primary);
  font-size: 11px;
}
.msg-attachment span,
.msg-attachment small {
  color: var(--ui-text-tertiary);
  font-size: 9px;
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
  color: var(--ui-text-primary);
  line-height: 1.6;
  word-break: break-word;
}
.msg-markdown :deep(p) {
  margin: 4px 0;
}
.msg-markdown :deep(pre) {
  background: var(--ui-bg-surface-soft);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-sm);
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
  margin: 8px 0;
}
.msg-markdown :deep(code) {
  font-size: 12px;
  background: var(--ui-accent-primary-soft);
  padding: 2px 6px;
  border-radius: var(--ui-radius-xs);
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
  border-left: 3px solid var(--ui-accent-primary);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--ui-text-secondary);
}

/* 流式光标 */
.msg-streaming-cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  background: var(--ui-accent-primary);
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  animation: cursor-blink 0.8s steps(2) infinite;
}

/* 工具调用证据轨迹（内容由 ToolCallCard 渲染） */
.msg-tools {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.msg-tools::before {
  content: '工具轨迹';
  position: absolute;
  top: -9px;
  left: 0;
  background: var(--ui-bg-surface);
  padding: 0 6px;
  font-family: var(--font-pixel);
  font-size: 9px;
  color: var(--ui-text-tertiary);
  letter-spacing: 0.12em;
  /* 纯装饰标签，禁止拦截工具卡片展开点击 */
  pointer-events: none;
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
