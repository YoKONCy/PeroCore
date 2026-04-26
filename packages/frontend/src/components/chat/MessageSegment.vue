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
  <div v-if="segment.type === 'thinking'" class="my-1 border-2 border-sky-200 bg-sky-50/50">
    <div
      class="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none text-xs font-bold text-sky-600 bg-sky-50 border-b border-sky-200 transition-colors hover:bg-sky-100"
      @click="toggleCollapse"
    >
      <div class="flex items-center gap-1.5">
        <PixelIcon name="brain" size="xs" />
        <span>思考过程</span>
      </div>
      <span :class="['text-[10px] transition-transform', { 'rotate-180': !isCollapsed }]">▼</span>
    </div>
    <div
      v-show="!isCollapsed"
      class="p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed text-sky-700"
    >
      {{ segment.content }}
    </div>
  </div>

  <!-- 内心独白块 -->
  <div v-else-if="segment.type === 'monologue'" class="my-1 border-2 border-pink-200 bg-pink-50/30">
    <div
      class="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none text-xs font-bold text-pink-600 bg-pink-50/60 border-b border-pink-200 transition-colors hover:bg-pink-100/60"
      @click="toggleCollapse"
    >
      <div class="flex items-center gap-1.5">
        <PixelIcon name="quote" size="xs" />
        <span>内心独白</span>
      </div>
      <span :class="['text-[10px] transition-transform', { 'rotate-180': !isCollapsed }]">▼</span>
    </div>
    <div
      v-show="!isCollapsed"
      class="p-3 text-xs whitespace-pre-wrap leading-relaxed text-slate-500"
    >
      {{ segment.content }}
    </div>
  </div>

  <!-- 工具调用块 (NIT) -->
  <div v-else-if="segment.type === 'tool'" class="my-1 border-2 border-sky-300">
    <div
      class="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none text-xs font-bold text-white bg-sky-500 transition-colors hover:bg-sky-600"
      @click="toggleCollapse"
    >
      <div class="flex items-center gap-1.5">
        <PixelIcon name="terminal" size="xs" />
        <span>NIT: {{ segment.name }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="segment.id" class="font-mono text-[10px] opacity-70">{{ segment.id }}</span>
        <span :class="['text-[10px] transition-transform', { 'rotate-180': !isCollapsed }]">▼</span>
      </div>
    </div>
    <div
      v-show="!isCollapsed"
      class="p-3 text-xs font-mono whitespace-pre overflow-x-auto bg-slate-50 text-slate-800"
    >
      {{ segment.content }}
    </div>
  </div>

  <!-- 普通文本 (Markdown) -->
  <div v-else class="min-h-[1.5em] font-bold text-slate-800">
    <!-- TODO: P4c-1 接入 AsyncMarkdown / useStreamMarkdown -->
    <!-- FIXME: v-html 必须接入 DOMPurify 净化，防止 XSS -->
    <div v-if="segment.content" v-html="segment.content" />
  </div>
</template>
