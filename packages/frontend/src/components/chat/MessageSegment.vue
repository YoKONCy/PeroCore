<script setup lang="ts">
/**
 * MessageSegment — 消息段落渲染器
 *
 * 负责渲染 assistant 消息中解析出的各种段落类型：
 * - text: 普通 Markdown 文本
 * - thinking: 思考过程 (可折叠)
 * - monologue: 内心独白 (可折叠)
 * - tool: 工具调用块 (NIT) (可折叠)
 */
import { ref } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'

export interface Segment {
  type: 'text' | 'thinking' | 'monologue' | 'tool'
  content: string
  /** 工具调用名 */
  name?: string
  /** 工具调用 ID */
  id?: string
}

interface Props {
  segment: Segment
}

defineProps<Props>()

const isCollapsed = ref(true)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
</script>

<template>
  <!-- 思考过程块 -->
  <div v-if="segment.type === 'thinking'" class="msg-segment msg-segment-thinking">
    <div class="msg-segment-header msg-segment-header-thinking" @click="toggleCollapse">
      <div class="msg-segment-title">
        <PixelIcon name="brain" size="xs" />
        <span>思考过程</span>
      </div>
      <span :class="['msg-segment-arrow', { 'msg-segment-arrow-open': !isCollapsed }]">▼</span>
    </div>
    <div v-show="!isCollapsed" class="msg-segment-body msg-segment-body-thinking">
      {{ segment.content }}
    </div>
  </div>

  <!-- 内心独白块 -->
  <div v-else-if="segment.type === 'monologue'" class="msg-segment msg-segment-monologue">
    <div class="msg-segment-header msg-segment-header-monologue" @click="toggleCollapse">
      <div class="msg-segment-title">
        <PixelIcon name="quote" size="xs" />
        <span>内心独白</span>
      </div>
      <span :class="['msg-segment-arrow', { 'msg-segment-arrow-open': !isCollapsed }]">▼</span>
    </div>
    <div v-show="!isCollapsed" class="msg-segment-body msg-segment-body-monologue">
      {{ segment.content }}
    </div>
  </div>

  <!-- 工具调用块 (NIT) -->
  <div v-else-if="segment.type === 'tool'" class="msg-segment msg-segment-tool">
    <div class="msg-segment-header msg-segment-header-tool" @click="toggleCollapse">
      <div class="msg-segment-title">
        <PixelIcon name="terminal" size="xs" />
        <span>NIT: {{ segment.name }}</span>
      </div>
      <div class="msg-segment-tool-meta">
        <span v-if="segment.id" class="msg-segment-tool-id">{{ segment.id }}</span>
        <span :class="['msg-segment-arrow', { 'msg-segment-arrow-open': !isCollapsed }]">▼</span>
      </div>
    </div>
    <div v-show="!isCollapsed" class="msg-segment-body msg-segment-body-tool">
      {{ segment.content }}
    </div>
  </div>

  <!-- 普通文本 (Markdown) -->
  <div v-else class="msg-segment-text">
    <!-- TODO: P4c-1 接入 AsyncMarkdown / useStreamMarkdown -->
    <!-- FIXME: v-html 必须接入 DOMPurify 净化，防止 XSS -->
    <div v-if="segment.content" v-html="segment.content" />
  </div>
</template>

<style scoped>
.msg-segment {
  margin: 4px 0;
  border: 2px solid var(--color-border);
}

.msg-segment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.15s;
}

.msg-segment-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.msg-segment-arrow {
  font-size: 10px;
  transition: transform 0.2s;
}
.msg-segment-arrow-open {
  transform: rotate(180deg);
}

/* 思考 */
.msg-segment-thinking {
  border-color: var(--color-sky-light);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.05));
}
.msg-segment-header-thinking {
  color: var(--color-sky-shadow);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.08));
  border-bottom: 1px solid var(--color-sky-light);
}
.msg-segment-header-thinking:hover {
  background: var(--color-sky-100, rgba(56, 189, 248, 0.12));
}
.msg-segment-body-thinking {
  padding: 12px;
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--color-sky-outline);
}

/* 独白 */
.msg-segment-monologue {
  border-color: var(--color-pink-light, #fbcfe8);
  background: rgba(244, 114, 182, 0.03);
}
.msg-segment-header-monologue {
  color: var(--color-pink-shadow, #db2777);
  background: rgba(244, 114, 182, 0.06);
  border-bottom: 1px solid var(--color-pink-light, #fbcfe8);
}
.msg-segment-header-monologue:hover {
  background: rgba(244, 114, 182, 0.1);
}
.msg-segment-body-monologue {
  padding: 12px;
  font-size: 12px;
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

/* 工具调用 */
.msg-segment-tool {
  border-color: var(--color-sky-hover);
}
.msg-segment-header-tool {
  color: white;
  background: var(--color-sky-500);
}
.msg-segment-header-tool:hover {
  background: var(--color-sky-shadow);
}
.msg-segment-tool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.msg-segment-tool-id {
  font-family: monospace;
  font-size: 10px;
  opacity: 0.7;
}
.msg-segment-body-tool {
  padding: 12px;
  font-size: 12px;
  font-family: monospace;
  white-space: pre;
  overflow-x: auto;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

/* 普通文本 */
.msg-segment-text {
  min-height: 1.5em;
  font-weight: 700;
  color: var(--color-text-primary);
}
</style>
