<script setup lang="ts">
/**
 * ToolCallCard.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ToolArchetypeSignature from './ToolArchetypeSignature.vue'
import ToolTechnicalDrawer from './ToolTechnicalDrawer.vue'
import {
  resolveToolDisplay,
  toolDisplayColor,
  toolDisplayColorSoft,
  toolDisplayIcon,
  toolDisplayLabel,
} from '../../composables/tools/useToolDisplay'
import type { AgentToolDisplay } from '../../api/modules/agentApi'
import { getToolStyleRenderer } from './toolRenderers'
import { resolveToolSignature } from './toolSignatures'

interface Props {
  tool: {
    name: string
    args: string
    result?: string
    isError?: boolean
    durationMs?: number
    receivedChars?: number
    assembling?: boolean
  }
  expanded?: boolean | null
  chainStart?: boolean
  chainEnd?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  expanded: null,
  chainStart: true,
  chainEnd: true,
})
const emit = defineEmits<{ 'update:expanded': [value: boolean] }>()
const display = ref<AgentToolDisplay>()
const detailsRef = ref<HTMLDetailsElement>()
const internalExpanded = ref(props.tool.result === undefined)
const drawerOpen = ref(false)
const userLocked = ref(false)
let collapseTimer: number | undefined

onMounted(async () => {
  display.value = await resolveToolDisplay(props.tool.name)
  await nextTick()
  syncOpen()
})
onBeforeUnmount(() => window.clearTimeout(collapseTimer))

const state = computed<'running' | 'error' | 'ok'>(() =>
  props.tool.result === undefined ? 'running' : props.tool.isError ? 'error' : 'ok',
)
const signature = computed(() =>
  resolveToolSignature(props.tool.name, display.value?.signature as never),
)
const renderer = computed(() => getToolStyleRenderer(display.value?.style))
const label = computed(() => toolDisplayLabel(props.tool.name, display.value))
const icon = computed(() => toolDisplayIcon(display.value))
const argsObj = computed<Record<string, unknown>>(() => {
  try {
    return JSON.parse(props.tool.args) as Record<string, unknown>
  } catch {
    return {}
  }
})
const draftSummary = computed(() => {
  if (!props.tool.assembling) return ''
  const safeFields = [
    'file_path',
    'dir_path',
    'path',
    'query',
    'url',
    'command',
    'target',
    'selector',
    'room_name',
  ]
  for (const field of safeFields) {
    const match = props.tool.args.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\n]{1,160})`))
    if (match?.[1]) return `${field.replaceAll('_', ' ')} · ${match[1]}`
  }
  const agentIds = props.tool.args.match(/"agent_ids"\s*:\s*\[([^\]]*)/)
  if (agentIds?.[1]) {
    const ids = [...agentIds[1].matchAll(/"([^"\n]+)"/g)].map((match) => match[1])
    if (ids.length) return `成员 · ${ids.join(' → ')}`
  }
  return ''
})
const summary = computed(() => {
  for (const field of signature.value.summaryFields) {
    const value = argsObj.value[field]
    if (Array.isArray(value) && value.length) return value.join(' → ')
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  if (state.value === 'running') {
    if (draftSummary.value) return draftSummary.value
    return props.tool.assembling
      ? `正在组装参数 · ${props.tool.receivedChars ?? 0}字符`
      : '动作正在进行'
  }
  if (state.value === 'error') return '动作未能完成'
  return '动作已完成'
})
const durationText = computed(() => {
  const ms = props.tool.durationMs
  return ms === undefined ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})
const accentVars = computed(() => ({
  '--ta-accent': toolDisplayColor(display.value),
  '--ta-accent-soft': toolDisplayColorSoft(display.value),
}))
const open = computed(() =>
  typeof props.expanded === 'boolean' ? props.expanded : internalExpanded.value,
)

function syncOpen(): void {
  if (detailsRef.value && detailsRef.value.open !== open.value) detailsRef.value.open = open.value
}
function setOpen(value: boolean, user = false): void {
  internalExpanded.value = value
  if (user) userLocked.value = value
  emit('update:expanded', value)
  nextTick(syncOpen)
}
function handleSummaryClick(): void {
  window.clearTimeout(collapseTimer)
  setOpen(!open.value, true)
}
function openDrawer(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  drawerOpen.value = true
  setOpen(true, true)
}

watch(() => props.expanded, syncOpen)
watch(
  () => props.tool.result,
  (result, previous) => {
    window.clearTimeout(collapseTimer)
    if (result === undefined) {
      userLocked.value = false
      setOpen(true)
      return
    }
    if (previous === undefined && !userLocked.value && !drawerOpen.value) {
      collapseTimer = window.setTimeout(() => setOpen(false), signature.value.collapseDelayMs)
    }
  },
)
watch(drawerOpen, (value) => {
  if (!value && props.tool.result !== undefined) {
    userLocked.value = false
    collapseTimer = window.setTimeout(() => setOpen(false), 180)
  }
})
</script>

<template>
  <details
    ref="detailsRef"
    class="ta-node"
    :class="[
      `ta-${signature.archetype}`,
      `ta-${signature.variant}`,
      `ta-state-${state}`,
      { 'is-open': open, 'chain-start': chainStart, 'chain-end': chainEnd },
    ]"
    :open="open"
    :data-chain="signature.chain"
    :style="accentVars"
  >
    <summary class="ta-summary" @click.prevent="handleSummaryClick">
      <ToolArchetypeSignature
        :signature="signature"
        :icon="icon"
        :label="label"
        :summary="summary"
        :state="state"
      />
      <span class="ta-copy">
        <strong>{{ label }}</strong>
        <small :title="summary">{{ summary }}</small>
      </span>
      <span class="ta-progress" aria-hidden="true"><i /></span>
      <span class="ta-meta">
        <span
          class="ta-state-dot"
          :title="state === 'running' ? '进行中' : state === 'error' ? '未完成' : '已完成'"
          :aria-label="state === 'running' ? '进行中' : state === 'error' ? '未完成' : '已完成'"
        >
          <span class="ta-state-text">
            {{ state === 'running' ? '进行中' : state === 'error' ? '未完成' : '已完成' }}
          </span>
        </span>
        <time v-if="durationText">{{ durationText }}</time>
        <button class="ta-data-port" type="button" title="查看技术详情" @click="openDrawer">
          详情
        </button>
      </span>
    </summary>
    <div class="ta-result-stage">
      <component :is="renderer" :args="tool.args" :result="tool.result" :is-error="tool.isError" />
    </div>
    <Teleport to="body">
      <ToolTechnicalDrawer
        v-if="drawerOpen"
        :name="tool.name"
        :args="tool.args"
        :result="tool.result"
        :is-error="tool.isError"
        :duration-ms="tool.durationMs"
        @close="drawerOpen = false"
      />
    </Teleport>
  </details>
</template>

<style scoped>
.ta-node {
  --ta-face: color-mix(in srgb, var(--ui-bg-elevated) 94%, var(--ta-accent-soft));
  --ta-face-raised: color-mix(in srgb, var(--ui-bg-surface) 82%, var(--ta-accent-soft));
  --ta-edge: color-mix(in srgb, var(--ta-accent) 42%, var(--ui-border-default));
  --ta-highlight: color-mix(in srgb, var(--ui-text-inverse) 28%, transparent);
  --ta-shadow: color-mix(in srgb, var(--ta-accent) 18%, transparent);
  position: relative;
  min-width: 0;
  color: var(--ui-text-primary);
}
.ta-node::before {
  position: absolute;
  top: -7px;
  bottom: calc(100% - 4px);
  left: 19px;
  width: 2px;
  background: repeating-linear-gradient(to bottom, var(--ta-accent) 0 3px, transparent 3px 5px);
  content: '';
  opacity: 0.45;
}
.ta-node.chain-start::before {
  display: none;
}
.ta-summary {
  position: relative;
  display: grid;
  min-height: 39px;
  grid-template-columns: 40px minmax(0, 1fr) minmax(24px, 90px) auto;
  align-items: center;
  gap: 7px;
  padding: 3px 5px 3px 1px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.ta-summary::-webkit-details-marker {
  display: none;
}
.ta-summary::after {
  position: absolute;
  right: 2px;
  bottom: 1px;
  left: 42px;
  height: 1px;
  background: linear-gradient(90deg, var(--ta-edge), transparent 72%);
  content: '';
  opacity: 0.42;
}
.ta-summary:hover .ta-data-port,
.ta-summary:focus-visible .ta-data-port {
  opacity: 1;
  transform: translateX(0);
}
.ta-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.ta-copy strong {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.ta-copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font:
    8px var(--font-mono),
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ta-progress {
  position: relative;
  height: 3px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ta-edge) 30%, transparent);
}
.ta-progress i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--ta-accent);
  transform-origin: left;
}
.ta-state-running .ta-progress i {
  animation: ta-progress 1.15s ease-in-out infinite;
}
.ta-state-ok .ta-progress i {
  transform: scaleX(1);
}
.ta-state-error .ta-progress i {
  background: var(--ui-danger);
  clip-path: polygon(0 0, 18% 0, 22% 100%, 42% 100%, 46% 0, 67% 0, 72% 100%, 100% 100%, 100% 0);
}
.ta-meta {
  display: grid;
  grid-template-columns: 7px minmax(30px, auto) 44px;
  align-items: center;
  gap: 7px;
  min-width: 95px;
}
.ta-summary time {
  color: var(--ui-text-muted);
  font:
    8px var(--font-mono),
    monospace;
  text-align: right;
  white-space: nowrap;
}
.ta-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ta-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ta-accent) 18%, transparent);
}
.ta-state-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.ta-state-running .ta-state-dot {
  animation: ta-state-pulse 1.15s ease-in-out infinite;
}
.ta-state-error .ta-state-dot {
  background: var(--ui-danger);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-danger) 18%, transparent);
}
.ta-data-port {
  width: 44px;
  height: 24px;
  border: 1px solid var(--ta-edge);
  border-radius: 4px;
  background: var(--ta-face-raised);
  box-shadow: 2px 2px 0 var(--ta-shadow);
  color: var(--ta-accent);
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
  opacity: 0.72;
  transform: none;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    box-shadow 120ms ease;
}
.ta-data-port:hover,
.ta-data-port:focus-visible {
  opacity: 1;
  background: var(--ta-face);
  box-shadow: 3px 3px 0 var(--ta-shadow);
  outline: none;
}
.ta-result-stage {
  margin: 2px 0 7px 41px;
  overflow: hidden;
  border-left: 1px dashed var(--ta-edge);
  background: var(--ta-face);
  box-shadow: 2px 2px 0 var(--ta-shadow);
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - 6px),
    calc(100% - 6px) calc(100% - 6px),
    calc(100% - 6px) 100%,
    0 100%
  );
}
.ta-node:not([open]) .ta-result-stage {
  display: none;
}
.ta-state-error {
  --ta-edge: color-mix(in srgb, var(--ui-danger) 52%, var(--ui-border-default));
}
.ta-state-error .ta-summary {
  transform: rotate(-0.25deg);
}
.ta-system-module .ta-summary::after {
  background: linear-gradient(90deg, var(--ta-accent), transparent 45%);
}
.ta-stronghold-scene .ta-summary::after {
  background: repeating-linear-gradient(90deg, var(--ta-accent) 0 8px, transparent 8px 12px);
}
.ta-terminal-tape .ta-summary::after {
  height: 2px;
  background: repeating-linear-gradient(90deg, var(--ta-edge) 0 3px, transparent 3px 6px);
}
.ta-search-radar .ta-summary::after {
  background: radial-gradient(circle, var(--ta-accent) 0 1px, transparent 2px) 0 0 / 7px 3px;
}
.ta-time-ticket .ta-summary::after {
  background: repeating-linear-gradient(90deg, var(--ta-edge) 0 5px, transparent 5px 8px);
}
@keyframes ta-progress {
  0% {
    transform: translateX(-100%) scaleX(0.32);
  }
  55% {
    transform: translateX(15%) scaleX(0.55);
  }
  100% {
    transform: translateX(100%) scaleX(0.2);
  }
}
@keyframes ta-state-pulse {
  50% {
    opacity: 0.45;
    transform: scale(0.72);
  }
}
@media (max-width: 700px) {
  .ta-summary {
    grid-template-columns: 40px minmax(0, 1fr) auto;
  }
  .ta-progress {
    display: none;
  }
  .ta-meta {
    grid-template-columns: 7px auto 40px;
    gap: 5px;
    min-width: 86px;
  }
  .ta-data-port {
    width: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ta-node *,
  .ta-node *::before,
  .ta-node *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
