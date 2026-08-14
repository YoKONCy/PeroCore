<script setup lang="ts">
/**
 * ToolCallCard — ReAct 工具轨迹卡片（对话/任务中心通用）
 *
 * 视觉设计（对齐 Cursor / Copilot 类 IDE 的工具调用展示）：
 * - 左侧 3px 主题色条作为分类视觉锚点
 * - 图标置于「软底圆角 chip」中，非裸图标
 * - 状态徽章带语义色 + 圆点指示（执行中/完成/失败）
 * - 展开区按 display.style 选择专属渲染器（edit 显示 +N/-M、search 显示匹配统计等）
 * - 全部走 ui-tokens，浅色/深色主题自适应
 *
 * 显示元数据来源：后端 /api/agents/tools（官方 manifest 声明 / 社区工具声明），
 * 前端 useToolDisplay 拉取并缓存。
 */
import { computed, onMounted, ref, watch } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import {
  resolveToolDisplay,
  toolDisplayColor,
  toolDisplayColorSoft,
  toolDisplayIcon,
  toolDisplayLabel,
} from '../../composables/tools/useToolDisplay'
import type { AgentToolDisplay } from '../../api/modules/agentApi'
import { getToolStyleRenderer } from './toolRenderers'

interface Props {
  tool: {
    name: string
    args: string
    result?: string
    isError?: boolean
    durationMs?: number
  }
  /** 外部控制展开状态（可选；不传则由组件内部管理） */
  expanded?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:expanded': [value: boolean] }>()

/** 显示元数据（异步加载） */
const display = ref<AgentToolDisplay | undefined>(undefined)
const loading = ref(true)

onMounted(async () => {
  try {
    display.value = await resolveToolDisplay(props.tool.name)
  } finally {
    loading.value = false
  }
})

/**
 * 展开状态：使用原生 details/open 作为真实状态源。
 * 原生 disclosure 不依赖 click 事件切换，避免外层消息气泡的拖拽、选择或冒泡处理吞掉点击。
 */
const internalExpanded = ref(false)
const isExpanded = computed(() => props.expanded ?? internalExpanded.value)
const detailsRef = ref<HTMLDetailsElement | null>(null)

/** 原生 toggle 事件是展开状态的唯一入口，同时同步可选的 v-model。 */
function handleNativeToggle(event: Event) {
  const open = (event.currentTarget as HTMLDetailsElement).open
  internalExpanded.value = open
  emit('update:expanded', open)
}

/** 外部受控时，把 expanded 同步回原生 details.open。 */
watch(
  () => props.expanded,
  (value) => {
    if (value !== undefined && detailsRef.value && detailsRef.value.open !== value) {
      detailsRef.value.open = value
    }
  },
)

/** 状态判定：result 未回填=执行中；isError=失败；否则=完成 */
const state = computed<'running' | 'error' | 'ok'>(() => {
  if (props.tool.result === undefined) return 'running'
  return props.tool.isError ? 'error' : 'ok'
})

const badgeText = computed(() => {
  if (state.value === 'running') return '执行中'
  if (state.value === 'error') return '失败'
  return '完成'
})

/** 耗时格式化 */
const durationText = computed(() => {
  const ms = props.tool.durationMs
  if (ms === undefined) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

/** 轨迹渲染器组件（按 style 选择） */
const renderer = computed(() => getToolStyleRenderer(display.value?.style))
const styleName = computed(() => display.value?.style || 'generic')

/** 安全解析调用参数，用于折叠态展示关键目标（路径/命令/查询词/URL），而不是千篇一律只显示名称。 */
const argsObj = computed<Record<string, unknown>>(() => {
  try {
    return JSON.parse(props.tool.args) as Record<string, unknown>
  } catch {
    return {}
  }
})

/** 不同工具风格的折叠态摘要（IDE 活动时间线语义） */
const targetSummary = computed(() => {
  const args = argsObj.value
  if (styleName.value === 'edit' || styleName.value === 'read' || styleName.value === 'file') {
    return String(args.path ?? args.file_path ?? args.dir_path ?? '')
  }
  if (styleName.value === 'search') {
    return String(args.query ?? args.pattern ?? '')
  }
  if (styleName.value === 'terminal') {
    return String(args.command ?? args.title ?? args.terminal_id ?? '')
  }
  if (styleName.value === 'web' || styleName.value === 'browser') {
    return String(args.url ?? args.target ?? '')
  }
  if (styleName.value === 'reminder') {
    return String(args.content ?? args.time ?? '')
  }
  if (styleName.value === 'skill') return String(args.skill_id ?? '')
  if (styleName.value === 'task') return String(args.summary ?? '')
  return ''
})

/** 注入给卡片的主题色（CSS 变量，供子元素与渲染器使用） */
const accentVars = computed(() => ({
  '--tc-accent': toolDisplayColor(display.value),
  '--tc-accent-soft': toolDisplayColorSoft(display.value),
}))
</script>

<template>
  <details
    ref="detailsRef"
    class="tc-card"
    :class="[`tc-state-${state}`, `tc-style-${styleName}`, { 'tc-is-open': isExpanded }]"
    :style="accentVars"
    @toggle="handleNativeToggle"
  >
    <!-- Header：使用原生 summary，鼠标与键盘均可可靠展开，不依赖 Vue click 切换。 -->
    <summary class="tc-header" @click.stop>
      <span class="tc-icon-chip">
        <PixelIcon :name="loading ? 'loader' : toolDisplayIcon(display)" size="xs" />
      </span>

      <div class="tc-meta">
        <span class="tc-name">{{ toolDisplayLabel(tool.name, display) }}</span>
        <span v-if="targetSummary" class="tc-target" :title="targetSummary">
          {{ targetSummary }}
        </span>
      </div>

      <span v-if="durationText" class="tc-duration">{{ durationText }}</span>
      <span class="tc-status" :data-state="state">
        <i />
        {{ badgeText }}
      </span>

      <span class="tc-chevron">
        <PixelIcon :name="isExpanded ? 'chevron-up' : 'chevron-down'" size="xs" />
      </span>
    </summary>

    <!-- Body：按 style 选择渲染器；details 自身控制可见性，避免状态不同步。 -->
    <component
      :is="renderer"
      class="tc-body"
      :args="tool.args"
      :result="tool.result"
      :is-error="tool.isError"
    />
  </details>
</template>

<style scoped>
.tc-card {
  position: relative;
  overflow: visible;
  border: 0;
  background: transparent;
  pointer-events: auto;
}
.tc-header::-webkit-details-marker {
  display: none;
}
.tc-header::marker {
  content: '';
}
/* infOS 工具总线：细轨道连接方形端口，不使用漂浮卡片或胶囊。 */
.tc-card::before {
  content: '';
  position: absolute;
  z-index: 0;
  top: 28px;
  bottom: -5px;
  left: 21px;
  width: 1px;
  background: var(--ui-border-default);
}
.tc-card:last-child::before,
.tc-card.tc-is-open::before {
  display: none;
}
.tc-state-error {
  --tc-accent: var(--ui-danger) !important;
  --tc-accent-soft: var(--ui-danger-soft) !important;
}
.tc-header {
  position: relative;
  display: grid;
  min-height: 34px;
  grid-template-columns: 24px minmax(0, 1fr) auto auto 22px;
  align-items: center;
  gap: 8px;
  padding: 2px 3px 2px 9px;
  outline: 0;
  cursor: pointer;
  user-select: none;
}
.tc-header::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-left: 2px solid transparent;
  background: transparent;
  transition:
    background var(--ui-duration-fast),
    border-color var(--ui-duration-fast);
}
.tc-header:hover::after,
.tc-header:focus-visible::after {
  border-left-color: var(--tc-accent);
  background: var(--ui-bg-hover);
}
.tc-is-open .tc-header::after {
  border-left-color: var(--tc-accent);
  background: color-mix(in srgb, var(--tc-accent-soft) 48%, transparent);
}
.tc-icon-chip {
  position: relative;
  z-index: 1;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--tc-accent) 45%, var(--ui-border-default));
  border-radius: 0;
  background: var(--ui-bg-surface);
  color: var(--tc-accent);
  box-shadow:
    inset 0 0 0 2px var(--ui-bg-surface),
    inset 0 0 0 3px color-mix(in srgb, var(--tc-accent) 14%, transparent);
}
.tc-icon-chip::after {
  content: '';
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 4px;
  height: 4px;
  background: var(--tc-accent);
}
.tc-style-terminal .tc-icon-chip,
.tc-style-search .tc-icon-chip,
.tc-style-web .tc-icon-chip,
.tc-style-browser .tc-icon-chip,
.tc-style-edit .tc-icon-chip {
  border-radius: 0;
  transform: none;
}
.tc-style-terminal .tc-icon-chip :deep(.pixel-icon) {
  transform: none;
}
.tc-meta {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}
.tc-name {
  flex-shrink: 0;
  color: var(--ui-text-primary);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
}
.tc-target {
  overflow: hidden;
  min-width: 0;
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-duration {
  color: var(--ui-text-disabled);
  font: 8px var(--ui-font-mono);
}
.tc-status {
  display: inline-flex;
  height: 20px;
  align-items: center;
  gap: 6px;
  padding: 0 7px;
  border-left: 1px solid var(--ui-border-default);
  color: var(--ui-text-tertiary);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.06em;
}
.tc-status i {
  width: 5px;
  height: 5px;
  background: currentColor;
}
.tc-status[data-state='running'] {
  color: var(--ui-accent-sky);
}
.tc-status[data-state='ok'] {
  color: var(--ui-success);
}
.tc-status[data-state='error'] {
  color: var(--ui-danger);
}
.tc-status[data-state='running'] i {
  animation: tc-blink 1s steps(1, end) infinite;
}
.tc-chevron {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-left: 1px solid transparent;
  color: var(--ui-text-disabled);
}
.tc-header:hover .tc-chevron {
  color: var(--tc-accent);
}
/* 展开区为切角检查舱；结构依靠边线和轨道，不依赖圆角/阴影。 */
.tc-body {
  position: relative;
  margin: 4px 4px 9px 42px;
  overflow: hidden;
  border: 1px solid var(--ui-border-default);
  border-radius: 0;
  background: var(--ui-bg-surface);
  box-shadow: 4px 4px 0 color-mix(in srgb, var(--tc-accent) 8%, transparent);
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
}
.tc-body::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-left: 1px solid var(--ui-border-default);
  background: var(--ui-bg-canvas);
  transform: skew(45deg) translateX(5px);
  pointer-events: none;
}
@keyframes tc-blink {
  0%,
  45% {
    opacity: 1;
  }
  46%,
  100% {
    opacity: 0.2;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tc-status[data-state='running'] i {
    animation: none;
  }
}
</style>
