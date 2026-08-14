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
import { computed, onMounted, ref } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import ChatRichText from './ChatRichText.vue'
import {
  resolveToolDisplay,
  toolDisplayIcon,
  toolDisplayLabel,
} from '../../composables/tools/useToolDisplay'
import type { AgentToolDisplay } from '../../api/modules/agentApi'

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

const props = defineProps<Props>()

const isCollapsed = ref(true)

/** NIT 工具段显示元数据（按工具名解析，图标/名称与对话轨迹保持一致） */
const display = ref<AgentToolDisplay | undefined>(undefined)

onMounted(async () => {
  if (props.segment.type === 'tool' && props.segment.name) {
    display.value = await resolveToolDisplay(props.segment.name)
  }
})

const toolIcon = computed(() => toolDisplayIcon(display.value))
const toolLabel = computed(() => toolDisplayLabel(props.segment.name ?? 'NIT', display.value))

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
</script>

<template>
  <!-- 思考过程块 -->
  <div v-if="segment.type === 'thinking'" class="segment-card segment-thinking pixel-border-moe">
    <div class="segment-header segment-thinking-header" @click="toggleCollapse">
      <div class="segment-title">
        <PixelIcon name="brain" size="xs" />
        <span>思考过程</span>
      </div>
      <span :class="['segment-chevron', { 'rotate-180': !isCollapsed }]">▼</span>
    </div>
    <div v-show="!isCollapsed" class="segment-body segment-thinking-body">
      {{ segment.content }}
    </div>
  </div>

  <!-- 内心独白块 -->
  <div
    v-else-if="segment.type === 'monologue'"
    class="segment-card segment-monologue pixel-border-moe"
  >
    <div class="segment-header segment-monologue-header" @click="toggleCollapse">
      <div class="segment-title">
        <PixelIcon name="quote" size="xs" />
        <span>内心独白</span>
      </div>
      <span :class="['segment-chevron', { 'rotate-180': !isCollapsed }]">▼</span>
    </div>
    <div v-show="!isCollapsed" class="segment-body segment-monologue-body">
      {{ segment.content }}
    </div>
  </div>

  <!-- 工具调用块 (NIT) -->
  <div v-else-if="segment.type === 'tool'" class="segment-card segment-tool pixel-border-moe">
    <div class="segment-header segment-tool-header" @click="toggleCollapse">
      <div class="segment-title">
        <PixelIcon :name="toolIcon" size="xs" />
        <span>{{ toolLabel }}</span>
      </div>
      <div class="segment-title">
        <span v-if="segment.id" class="segment-id">{{ segment.id }}</span>
        <span :class="['segment-chevron', { 'rotate-180': !isCollapsed }]">▼</span>
      </div>
    </div>
    <div v-show="!isCollapsed" class="segment-body segment-tool-body">
      {{ segment.content }}
    </div>
  </div>

  <!-- 普通文本 (Markdown) -->
  <div v-else class="segment-text">
    <ChatRichText :content="segment.content" />
  </div>
</template>

<style scoped>
.segment-card {
  margin: 6px 0;
  overflow: hidden;
  background: rgba(255, 252, 249, 0.72);
}

.segment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: 900;
  transition: background 0.16s ease;
}

.segment-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.segment-thinking-header {
  color: var(--color-moe-sky);
  background: rgba(167, 216, 240, 0.12);
}

.segment-thinking-header:hover {
  background: rgba(167, 216, 240, 0.2);
}

.segment-monologue-header {
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.12);
}

.segment-monologue-header:hover {
  background: rgba(249, 168, 212, 0.2);
}

.segment-tool-header {
  color: white;
  background: linear-gradient(90deg, var(--color-moe-pink), var(--color-moe-purple));
}

.segment-tool-header:hover {
  filter: brightness(1.04);
}

.segment-chevron {
  font-size: 10px;
  transition: transform 0.16s ease;
}

.segment-body {
  padding: 12px;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.65;
  color: var(--color-moe-cocoa);
  border-top: 1px solid rgba(45, 27, 30, 0.08);
}

.segment-thinking-body,
.segment-tool-body {
  font-family: monospace;
}

.segment-tool-body {
  overflow-x: auto;
  white-space: pre;
  background: rgba(45, 27, 30, 0.04);
}

.segment-id {
  font-family: monospace;
  font-size: 10px;
  opacity: 0.72;
}

.segment-text {
  min-height: 1.5em;
  color: var(--color-moe-cocoa);
  font-weight: 700;
}
</style>
