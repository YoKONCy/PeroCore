<script setup lang="ts">
/**
 * MemoryGraphView — 记忆图谱（自研 SVG 力导向，零外部依赖）
 *
 * - 静态预计算力导向布局（Fruchterman-Reingold 简化版），避免持续动画占用主线程
 * - 滚轮缩放 / 空白拖拽平移 / 节点拖拽 / 点击选中联动右侧详情
 * - 按关系类型过滤、仅看选中一阶邻域、适应画布
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { EventNote, EventNoteRelation, EventNoteRelationView } from '@infos/shared'
import { PixelIcon, PButton } from '../../pixel'

const props = defineProps<{
  nodes: EventNote[]
  edges: EventNoteRelationView[]
  selectedId: string | null
  loading: boolean
  error: string
  truncated: boolean
}>()

const emit = defineEmits<{
  select: [note: EventNote]
}>()

// ── 布局常量 ──
const WORLD_W = 900
const WORLD_H = 640

interface LayoutNode {
  id: string
  note: EventNote
  x: number
  y: number
}

const layout = shallowRef<LayoutNode[]>([])
const nodeById = computed(() => new Map(layout.value.map((node) => [node.id, node])))

// ── 关系类型过滤 ──
const ALL_RELATIONS: Array<{ value: EventNoteRelation; label: string; color: string }> = [
  { value: 'temporal_next', label: '时间后继', color: '#64748b' },
  { value: 'temporal_prev', label: '时间前驱', color: '#94a3b8' },
  { value: 'caused_by', label: '因果', color: '#d97706' },
  { value: 'same_event', label: '同一事件', color: '#8b5cf6' },
  { value: 'same_topic', label: '同主题', color: '#0ea5e9' },
  { value: 'involves_person', label: '涉及人物', color: '#db2777' },
  { value: 'involves_place', label: '涉及地点', color: '#16a34a' },
  { value: 'involves_object', label: '涉及物品', color: '#ea580c' },
]

const enabledRelations = ref<Set<EventNoteRelation>>(
  new Set(ALL_RELATIONS.map((item) => item.value)),
)
const onlyNeighborhood = ref(false)

const relationColor = computed(() => {
  const map = new Map<string, string>()
  for (const item of ALL_RELATIONS) map.set(item.value, item.color)
  return map
})

/** 过滤后的边 */
const visibleEdges = computed(() =>
  props.edges.filter((edge) => enabledRelations.value.has(edge.relation)),
)

/** 选中节点的一阶邻域（含自身） */
const neighborhood = computed(() => {
  const set = new Set<string>()
  if (!props.selectedId) return set
  set.add(props.selectedId)
  for (const edge of visibleEdges.value) {
    if (edge.sourceId === props.selectedId) set.add(edge.targetId)
    else if (edge.targetId === props.selectedId) set.add(edge.sourceId)
  }
  return set
})

function nodeDimmed(id: string): boolean {
  if (!onlyNeighborhood.value || !props.selectedId) return false
  return !neighborhood.value.has(id)
}

function edgeDimmed(edge: EventNoteRelationView): boolean {
  if (!onlyNeighborhood.value || !props.selectedId) return false
  return !(neighborhood.value.has(edge.sourceId) && neighborhood.value.has(edge.targetId))
}

// ── 视图变换（缩放 + 平移） ──
const view = reactive({ x: 0, y: 0, scale: 1 })
const svgEl = ref<SVGSVGElement | null>(null)
const tooltip = ref<{ x: number; y: number; node: LayoutNode } | null>(null)

// ── 力导向布局（静态预计算） ──
function runLayout(nodes: EventNote[], edges: EventNoteRelationView[]): LayoutNode[] {
  const count = nodes.length
  if (!count) return []

  // 初始化：时间序环形分布 + 随机扰动，避免完全对称的死锁布局
  const sorted = [...nodes].sort((a, b) => a.eventAt.localeCompare(b.eventAt))
  const positioned: LayoutNode[] = sorted.map((note, index) => {
    const angle = (index / Math.max(1, count)) * Math.PI * 2
    const radius = Math.min(WORLD_W, WORLD_H) * 0.36
    return {
      id: note.id,
      note,
      x: WORLD_W / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: WORLD_H / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
    }
  })
  if (count === 1) {
    positioned[0]!.x = WORLD_W / 2
    positioned[0]!.y = WORLD_H / 2
    return positioned
  }

  const index = new Map(positioned.map((node, i) => [node.id, i]))
  const links = edges
    .map((edge) => ({ source: index.get(edge.sourceId), target: index.get(edge.targetId) }))
    .filter(
      (link): link is { source: number; target: number } =>
        link.source !== undefined && link.target !== undefined,
    )

  const area = WORLD_W * WORLD_H
  const k = Math.sqrt(area / count)
  // 节点越多迭代越少，控制总计算量 ≈ O(iterations * n²)
  const iterations = count > 400 ? 60 : count > 200 ? 120 : 240
  let temperature = Math.max(WORLD_W, WORLD_H) / 8

  for (let step = 0; step < iterations; step++) {
    const fx = new Float64Array(count)
    const fy = new Float64Array(count)

    // 斥力（库仑）
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = positioned[i]!.x - positioned[j]!.x
        let dy = positioned[i]!.y - positioned[j]!.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          distSq = 1
        }
        const dist = Math.sqrt(distSq)
        const force = (k * k) / dist
        const ux = (dx / dist) * force
        const uy = (dy / dist) * force
        fx[i]! += ux
        fy[i]! += uy
        fx[j]! -= ux
        fy[j]! -= uy
      }
    }

    // 弹簧力
    for (const link of links) {
      const a = positioned[link.source]!
      const b = positioned[link.target]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.hypot(dx, dy))
      const force = (dist * dist) / (k * 2.2)
      const ux = (dx / dist) * force
      const uy = (dy / dist) * force
      fx[link.source]! += ux
      fy[link.source]! += uy
      fx[link.target]! -= ux
      fy[link.target]! -= uy
    }

    // 向心力 + 温度衰减位移
    temperature *= 0.92
    for (let i = 0; i < count; i++) {
      const node = positioned[i]!
      fx[i]! += (WORLD_W / 2 - node.x) * 0.004
      fy[i]! += (WORLD_H / 2 - node.y) * 0.004
      const limit = Math.max(1, temperature)
      const magnitude = Math.hypot(fx[i]!, fy[i]!)
      if (magnitude > limit) {
        fx[i] = (fx[i]! / magnitude) * limit
        fy[i] = (fy[i]! / magnitude) * limit
      }
      node.x = Math.min(WORLD_W - 10, Math.max(10, node.x + fx[i]!))
      node.y = Math.min(WORLD_H - 10, Math.max(10, node.y + fy[i]!))
    }
  }
  return positioned
}

watch(
  () => [props.nodes, props.edges],
  () => {
    layout.value = runLayout(props.nodes, props.edges)
    fitView()
  },
  { immediate: true },
)

function fitView(): void {
  if (!layout.value.length) {
    view.x = 0
    view.y = 0
    view.scale = 1
    return
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const node of layout.value) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }
  const padding = 60
  const width = Math.max(1, maxX - minX + padding * 2)
  const height = Math.max(1, maxY - minY + padding * 2)
  view.scale = Math.min(WORLD_W / width, WORLD_H / height, 2)
  view.x = WORLD_W / 2 - ((minX + maxX) / 2) * view.scale
  view.y = WORLD_H / 2 - ((minY + maxY) / 2) * view.scale
}

function focusSelected(): void {
  const node = props.selectedId ? nodeById.value.get(props.selectedId) : null
  if (!node) return
  view.scale = 1.8
  view.x = WORLD_W / 2 - node.x * view.scale
  view.y = WORLD_H / 2 - node.y * view.scale
}

function toggleRelation(relation: EventNoteRelation): void {
  const next = new Set(enabledRelations.value)
  if (next.has(relation)) next.delete(relation)
  else next.add(relation)
  enabledRelations.value = next
}

function toggleOnlyTimeline(): void {
  const timeline: EventNoteRelation[] = ['temporal_next', 'temporal_prev']
  const isTimelineOnly =
    enabledRelations.value.size === timeline.length &&
    timeline.every((item) => enabledRelations.value.has(item))
  enabledRelations.value = isTimelineOnly
    ? new Set(ALL_RELATIONS.map((item) => item.value))
    : new Set(timeline)
}

// ── 鼠标交互 ──
interface DragState {
  mode: 'pan' | 'node'
  node?: LayoutNode
  startX: number
  startY: number
  originX: number
  originY: number
}

let dragActive: DragState | null = null

function onSvgMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  dragActive = {
    mode: 'pan',
    startX: event.clientX,
    startY: event.clientY,
    originX: view.x,
    originY: view.y,
  }
}

function onNodeMouseDown(event: MouseEvent, node: LayoutNode): void {
  if (event.button !== 0) return
  event.stopPropagation()
  dragActive = {
    mode: 'node',
    node,
    startX: event.clientX,
    startY: event.clientY,
    originX: node.x,
    originY: node.y,
  }
}

function onMouseMove(event: MouseEvent): void {
  if (!dragActive) return
  const dx = (event.clientX - dragActive.startX) / view.scale
  const dy = (event.clientY - dragActive.startY) / view.scale
  if (dragActive.mode === 'pan') {
    view.x = dragActive.originX + dx * view.scale
    view.y = dragActive.originY + dy * view.scale
  } else if (dragActive.node) {
    dragActive.node.x = dragActive.originX + dx
    dragActive.node.y = dragActive.originY + dy
  }
}

function onMouseUp(): void {
  dragActive = null
}

function onClickNode(node: LayoutNode): void {
  emit('select', node.note)
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mx = ((event.clientX - rect.left) / rect.width) * WORLD_W
  const my = ((event.clientY - rect.top) / rect.height) * WORLD_H
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
  const nextScale = Math.min(6, Math.max(0.2, view.scale * factor))
  const ratio = nextScale / view.scale
  view.x = mx - (mx - view.x) * ratio
  view.y = my - (my - view.y) * ratio
  view.scale = nextScale
}

function onNodeEnter(event: MouseEvent, node: LayoutNode): void {
  const host = svgEl.value?.parentElement
  if (!host) return
  const rect = host.getBoundingClientRect()
  tooltip.value = { x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14, node }
}

function onNodeLeave(): void {
  tooltip.value = null
}

function nodeRadius(note: EventNote): number {
  return 4 + (note.importance / 10) * 6
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const usedRelations = computed(() => {
  const used = new Set(props.edges.map((edge) => edge.relation))
  return ALL_RELATIONS.filter((item) => used.has(item.value))
})

function bindWindowListeners(): void {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function unbindWindowListeners(): void {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

onMounted(bindWindowListeners)
onBeforeUnmount(unbindWindowListeners)
</script>

<template>
  <div class="graph-view">
    <!-- 工具栏 -->
    <div class="graph-toolbar">
      <div class="relation-toggles">
        <button
          v-for="item in usedRelations"
          :key="item.value"
          :class="['rel-toggle', { 'rel-toggle-on': enabledRelations.has(item.value) }]"
          :style="{ '--rel-color': item.color }"
          :title="item.label"
          @click="toggleRelation(item.value)"
        >
          <span class="rel-swatch" />
          {{ item.label }}
        </button>
      </div>
      <div class="graph-actions">
        <PButton variant="ghost" size="sm" @click="toggleOnlyTimeline">
          <PixelIcon name="clock" size="xs" />
          仅时间链
        </PButton>
        <PButton
          variant="ghost"
          size="sm"
          :disabled="!selectedId"
          @click="onlyNeighborhood = !onlyNeighborhood"
        >
          <PixelIcon name="eye" size="xs" />
          {{ onlyNeighborhood ? '显示全部' : '一阶邻域' }}
        </PButton>
        <PButton variant="ghost" size="sm" @click="fitView">
          <PixelIcon name="layout" size="xs" />
          适应画布
        </PButton>
        <PButton variant="ghost" size="sm" :disabled="!selectedId" @click="focusSelected">
          <PixelIcon name="map-pin" size="xs" />
          聚焦选中
        </PButton>
      </div>
    </div>

    <!-- 画布 -->
    <div class="graph-canvas">
      <div v-if="loading && !nodes.length" class="graph-status">
        <PixelIcon name="refresh" size="sm" animation="spin" />
        <span class="font-pixel">加载记忆图谱...</span>
      </div>
      <div v-else-if="error" class="graph-status">
        <PixelIcon name="alert" size="sm" />
        {{ error }}
      </div>
      <div v-else-if="!nodes.length" class="graph-status">
        <PixelIcon name="brain" size="lg" style="opacity: 0.25" />
        <span>暂无可视化的记忆</span>
      </div>

      <svg
        v-show="nodes.length"
        ref="svgEl"
        :viewBox="`0 0 ${WORLD_W} ${WORLD_H}`"
        class="graph-svg"
        @mousedown="onSvgMouseDown"
        @wheel="onWheel"
      >
        <g :transform="`translate(${view.x} ${view.y}) scale(${view.scale})`">
          <!-- 边 -->
          <line
            v-for="(edge, index) in visibleEdges"
            :key="`${edge.sourceId}:${edge.relation}:${edge.targetId}`"
            :x1="nodeById.get(edge.sourceId)?.x ?? 0"
            :y1="nodeById.get(edge.sourceId)?.y ?? 0"
            :x2="nodeById.get(edge.targetId)?.x ?? 0"
            :y2="nodeById.get(edge.targetId)?.y ?? 0"
            :stroke="relationColor.get(edge.relation) ?? '#94a3b8'"
            :stroke-width="edge.relation === 'same_event' ? 2.2 : 0.9"
            :stroke-dasharray="edge.relation === 'same_topic' ? '4 3' : undefined"
            :opacity="edgeDimmed(edge) ? 0.06 : 0.45"
            :data-index="index"
          />
          <!-- 节点 -->
          <g
            v-for="node in layout"
            :key="node.id"
            :transform="`translate(${node.x} ${node.y})`"
            :class="['graph-node', { 'graph-node-dim': nodeDimmed(node.id) }]"
            @mousedown="onNodeMouseDown($event, node)"
            @click.stop="onClickNode(node)"
            @mouseenter="onNodeEnter($event, node)"
            @mouseleave="onNodeLeave"
          >
            <circle
              :r="nodeRadius(node.note)"
              :class="['node-circle', { 'node-archived': node.note.status === 'archived' }]"
            />
            <circle
              v-if="node.id === selectedId"
              :r="nodeRadius(node.note) + 4"
              class="node-selected-ring"
            />
          </g>
        </g>
      </svg>

      <!-- Tooltip -->
      <div
        v-if="tooltip"
        class="graph-tooltip"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <span class="tooltip-time font-pixel">{{ formatTime(tooltip.node.note.eventAt) }}</span>
        <span class="tooltip-text">{{ tooltip.node.note.narrative }}</span>
      </div>

      <!-- 图例/统计 -->
      <div v-if="nodes.length" class="graph-meta font-pixel">
        {{ nodes.length }} 节点 · {{ visibleEdges.length }} 关系
        <template v-if="truncated">· 已截断</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
}

.graph-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.relation-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.rel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 10px;
  color: var(--ui-text-tertiary, #94a3b8);
  background: var(--ui-bg-elevated, #fff);
  border: 1px solid var(--ui-border-default, #e2e8f0);
  cursor: pointer;
  opacity: 0.55;
  transition: all 0.15s;
}

.rel-toggle-on {
  opacity: 1;
  color: var(--ui-text-primary, #1e293b);
  border-color: var(--rel-color, #94a3b8);
  box-shadow: 1px 1px 0 color-mix(in srgb, var(--rel-color, #94a3b8) 35%, transparent);
}

.rel-swatch {
  width: 8px;
  height: 3px;
  background: var(--rel-color, #94a3b8);
}

.graph-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.graph-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border-default, #e2e8f0);
  background:
    linear-gradient(rgba(148, 163, 184, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px);
  background-size: 24px 24px;
}

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.graph-svg:active {
  cursor: grabbing;
}

.graph-node {
  cursor: pointer;
}

.node-circle {
  fill: #0ea5e9;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 1.5;
  transition: fill 0.15s;
}

.graph-node:hover .node-circle {
  fill: #38bdf8;
}

.node-archived {
  fill: #cbd5e1;
}

.node-selected-ring {
  fill: none;
  stroke: #8b5cf6;
  stroke-width: 2;
  stroke-dasharray: 3 2;
}

.graph-node-dim {
  opacity: 0.15;
}

.graph-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.graph-tooltip {
  position: absolute;
  max-width: 280px;
  padding: 8px 10px;
  pointer-events: none;
  background: var(--ui-bg-primary, #fff);
  border: 1px solid #8b5cf6;
  box-shadow: 3px 3px 0 rgba(139, 92, 246, 0.15);
  z-index: 10;
}

.tooltip-time {
  display: block;
  margin-bottom: 4px;
  font-size: 9px;
  color: #7c3aed;
}

.tooltip-text {
  display: -webkit-box;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-text-primary, #1e293b);
  text-shadow: none;
  overflow-wrap: anywhere;
}

:global(html[data-theme='dark'] .graph-tooltip) {
  background: #161b2b !important;
  color: #f8fafc !important;
  border-color: #a78bfa !important;
  box-shadow:
    3px 3px 0 rgba(167, 139, 250, 0.25),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

:global(html[data-theme='dark'] .graph-tooltip .tooltip-time) {
  color: #c4b5fd !important;
}

:global(html[data-theme='dark'] .graph-tooltip .tooltip-text) {
  color: #f8fafc !important;
}

.graph-meta {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: 9px;
  color: var(--ui-text-tertiary, #94a3b8);
  pointer-events: none;
}
</style>
