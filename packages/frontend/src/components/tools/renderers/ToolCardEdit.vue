<script setup lang="ts">
import { t as __t } from '../../../i18n/index'

/** ToolCardEdit — infOS 文件变更检查器：统一 Diff 轨道、行号和修改统计。 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FileWritePreviewBaseline } from '@infos/shared'
import {
  useFileMutationPreview,
  type FileMutationPreview,
} from '../../../composables/tools/useFileMutationPreview'

const props = withDefaults(
  defineProps<{
    args: string
    result?: string
    isError?: boolean
    assembling?: boolean
    interrupted?: boolean
    previewTruncated?: boolean
    active?: boolean
    fileBaseline?: FileWritePreviewBaseline
    toolName?: string
    preview?: FileMutationPreview
  }>(),
  {
    active: true,
    result: undefined,
    fileBaseline: undefined,
    toolName: undefined,
    preview: undefined,
  },
)

const localPreview = useFileMutationPreview(
  () => props,
  () => !props.preview && props.active,
)
const preview = computed(() => props.preview ?? localPreview.value)
const grid = ref<HTMLDivElement>()
const scrollTop = ref(0)
const following = ref(true)
let scrollFrame: number | undefined
const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

onBeforeUnmount(() => {
  if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
})

const argsObj = computed(() => preview.value.args)
const resultObj = computed(() => preview.value.result)
const filePath = computed(() => preview.value.path)
const normalizedPath = computed(() => filePath.value.replaceAll('\\', '/'))
const fileName = computed(() => normalizedPath.value.split('/').pop() || normalizedPath.value)
const fileDir = computed(() =>
  normalizedPath.value.slice(0, Math.max(0, normalizedPath.value.lastIndexOf('/'))),
)
const operation = computed(() => preview.value.operation)
const insertions = computed(() => preview.value.insertions)
const deletions = computed(() => preview.value.deletions)
const editRange = computed(
  () => resultObj.value.editRange as { startLine?: number; endLine?: number } | undefined,
)
const errorText = computed(() => {
  if (props.interrupted) return __t('ui.tools', '生成已中断，预览不代表已写入。')
  if (typeof resultObj.value.error === 'string') return resultObj.value.error
  return props.isError ? props.result || __t('ui.tools', '文件修改失败') : ''
})
const diffTruncated = computed(() =>
  Boolean(resultObj.value.diffTruncated || (props.result === undefined && props.previewTruncated)),
)
const pending = computed(() => props.result === undefined && !props.interrupted)
const phaseLabel = computed(() => {
  if (props.interrupted) return __t('ui.tools', '已中断')
  if (props.isError || resultObj.value.error) return __t('ui.tools', '执行失败')
  if (resultObj.value.needsSelection) return __t('ui.tools', '等待选择 · 未写入')
  if (resultObj.value.success === false) return __t('ui.tools', '未写入')
  if (preview.value.committed) return __t('ui.tools', '已写入')
  if (props.result !== undefined) return __t('ui.tools', '变更结果')
  return props.assembling ? __t('ui.tools', '实时预览 · 未写入') : __t('ui.tools', '正在写入')
})
const baselineUnknown = computed(() => preview.value.baselineUnknown)

const opLabel: Record<string, string> = {
  edit: 'EDIT',
  overwrite: 'WRITE',
  create: 'CREATE',
  append: 'APPEND',
}

const diffRows = computed(() => preview.value.rows)

// 固定行高的窗口化渲染，长文件只创建当前可见的几十行 DOM。
const rowHeight = 22
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight) - 6))
const windowRows = computed(() => diffRows.value.slice(firstRow.value, firstRow.value + 30))
const spacerAfter = computed(
  () => Math.max(0, diffRows.value.length - firstRow.value - windowRows.value.length) * rowHeight,
)
function chaseBottom(): void {
  if (scrollFrame !== undefined || !props.active || !following.value) return
  const step = () => {
    scrollFrame = undefined
    const el = grid.value
    if (!el || !following.value || !props.active) return
    const target = Math.max(0, el.scrollHeight - el.clientHeight)
    const delta = target - el.scrollTop
    el.scrollTop = reducedMotion || Math.abs(delta) < 2 ? target : el.scrollTop + delta * 0.3
    scrollTop.value = el.scrollTop
    if (!reducedMotion && Math.abs(delta) >= 2) scrollFrame = requestAnimationFrame(step)
  }
  scrollFrame = requestAnimationFrame(step)
}
watch([diffRows, () => props.active], async () => {
  await nextTick()
  const el = grid.value
  if (el) scrollTop.value = el.scrollTop
  if (pending.value) chaseBottom()
  else if (el && following.value) {
    el.scrollTop = 0
    scrollTop.value = 0
  }
})
function onScroll(): void {
  const el = grid.value
  if (!el) return
  scrollTop.value = el.scrollTop
  if (el.scrollHeight - el.clientHeight - el.scrollTop < 8) following.value = true
}
function stopFollowing(): void {
  following.value = false
}
function resumeFollowing(): void {
  following.value = true
  chaseBottom()
}
</script>

<template>
  <section class="diff-inspector" :class="{ 'is-live': pending, 'is-failed': !!errorText }">
    <header class="diff-inspector__head">
      <span class="diff-inspector__mode">{{ opLabel[operation] ?? operation.toUpperCase() }}</span>
      <div class="diff-inspector__path">
        <strong :title="filePath">{{ fileName || __t('ui.tools', '未知文件') }}</strong>
        <small v-if="fileDir">{{ fileDir }}</small>
      </div>
      <div class="diff-inspector__stats" :aria-label="__t('ui.tools', '变更统计')">
        <span class="is-add">+{{ insertions }}</span>
        <span class="is-remove">−{{ baselineUnknown ? '?' : deletions }}</span>
        <span v-if="editRange?.startLine" class="is-range">
          L{{ editRange.startLine }}–{{ editRange.endLine }}
        </span>
      </div>
    </header>

    <div class="diff-inspector__status" role="status">
      <span class="diff-inspector__signal" />
      <span>{{ phaseLabel }}</span>
      <small v-if="resultObj.needsSelection">
        {{ __t('ui.tools', '存在多个匹配位置，等待 Agent 选择候选') }}
      </small>
      <small v-if="Array.isArray(argsObj.steps)">
        {{ __t('ui.tools', '同文件批量编辑 ·') }} {{ argsObj.steps.length }}
        {{ __t('ui.tools', '处') }}
      </small>
      <small v-if="resultObj.checkpointWarning">{{ resultObj.checkpointWarning }}</small>
      <small v-if="baselineUnknown">{{ __t('ui.tools', '旧文不可用 · 仅预览新内容') }}</small>
      <button
        v-if="pending && !following && diffRows.length"
        type="button"
        @click="resumeFollowing"
      >
        {{ __t('ui.tools', '跟随生成 ↓') }}
      </button>
    </div>

    <div
      v-if="diffRows.length"
      ref="grid"
      class="diff-grid"
      role="table"
      :aria-label="__t('ui.tools', '文件差异')"
      :aria-rowcount="diffRows.length"
      tabindex="0"
      @scroll.passive="onScroll"
      @wheel.passive="stopFollowing"
      @touchstart.passive="stopFollowing"
      @pointerdown="stopFollowing"
      @keydown.up="stopFollowing"
      @keydown.page-up="stopFollowing"
      @keydown.home="stopFollowing"
    >
      <div :style="{ height: `${firstRow * rowHeight}px` }" aria-hidden="true" />
      <div
        v-for="(row, index) in windowRows"
        :key="`${firstRow + index}:${row.kind}`"
        class="diff-row"
        :class="`is-${row.kind}`"
        role="row"
        :aria-rowindex="firstRow + index + 1"
      >
        <span class="diff-line diff-line--old">{{ row.oldLine ?? '' }}</span>
        <span class="diff-line diff-line--new">{{ row.newLine ?? '' }}</span>
        <span class="diff-sign">
          {{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '·' }}
        </span>
        <code>
          {{ row.text || ' ' }}
          <i
            v-if="pending && firstRow + index === diffRows.length - 1"
            class="diff-cursor"
            aria-hidden="true"
          />
        </code>
      </div>
      <div :style="{ height: `${spacerAfter}px` }" aria-hidden="true" />
    </div>

    <div v-if="diffTruncated" class="diff-inspector__truncated">
      <span>{{ __t('ui.tools', '预览已限长') }}</span>
      <span>
        {{
          pending
            ? __t('ui.tools', '完整内容仍会交给工具执行')
            : __t('ui.tools', '变更统计以执行结果为准')
        }}
      </span>
    </div>

    <div v-else-if="!errorText && !diffRows.length" class="diff-inspector__summary">
      <span>
        {{
          pending
            ? assembling
              ? __t('ui.tools', '等待修改内容…')
              : __t('ui.tools', '等待写入结果…')
            : __t('ui.tools', '变更已写入')
        }}
      </span>
      <code>
        {{
          resultObj.bytes ? `${resultObj.bytes} bytes` : `${insertions + deletions} lines touched`
        }}
      </code>
    </div>

    <div v-if="errorText" class="diff-inspector__error">
      <b>ERR</b>
      <pre>{{ errorText }}</pre>
    </div>
  </section>
</template>

<style scoped>
.diff-inspector {
  --diff-gutter: 38px;
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
  animation: diff-reveal 180ms ease-out both;
  --tc-accent: var(--ta-accent, var(--ui-accent-sky));
}
.diff-inspector__head {
  display: grid;
  min-height: 40px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: stretch;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.diff-inspector__mode {
  display: grid;
  min-width: 58px;
  place-items: center;
  border-right: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  font: 800 9px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.diff-inspector__path {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  padding: 0 11px;
  align-self: center;
}
.diff-inspector__path strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font: 700 11px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-inspector__path small {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-inspector__stats {
  display: flex;
  align-items: center;
  border-left: 1px solid var(--ui-border-default);
  font: 800 10px var(--ui-font-mono);
}
.diff-inspector__stats span {
  display: grid;
  min-width: 34px;
  height: 100%;
  padding: 0 7px;
  place-items: center;
  border-right: 1px solid var(--ui-border-subtle);
}
.diff-inspector__stats .is-add {
  color: var(--ui-success);
  background: var(--ui-success-soft);
}
.diff-inspector__stats .is-remove {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.diff-inspector__stats .is-range {
  color: var(--ui-text-tertiary);
  font-weight: 600;
}
.diff-grid {
  max-height: 300px;
  overflow: auto;
  background: var(--ui-bg-surface);
  overflow-anchor: none;
  scrollbar-gutter: stable;
}
.diff-row {
  display: grid;
  height: 22px;
  box-sizing: border-box;
  grid-template-columns: var(--diff-gutter) var(--diff-gutter) 24px minmax(max-content, 1fr);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border-subtle) 58%, transparent);
  font: 10px/22px var(--ui-font-mono);
}
.is-live .diff-row.is-add {
  animation: diff-line-in 180ms ease-out both;
}
.diff-inspector__status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 29px;
  padding: 0 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-secondary);
  font: 10px var(--ui-font-mono);
  background: color-mix(in srgb, var(--tc-accent) 5%, transparent);
}
.diff-inspector__status small {
  margin-left: auto;
  color: var(--ui-text-tertiary);
  font-size: 9px;
}
.diff-inspector__status button {
  margin-left: auto;
  padding: 2px 5px;
  border: 1px solid var(--ui-border-default);
  color: var(--tc-accent);
  background: var(--ui-bg-surface-soft);
  font: inherit;
  cursor: pointer;
}
.diff-inspector__signal {
  width: 4px;
  height: 4px;
  background: var(--ui-success);
}
.is-live .diff-inspector__signal {
  background: var(--tc-accent);
  animation: diff-signal 1.2s ease-in-out infinite;
}
.is-failed .diff-inspector__signal {
  background: var(--ui-danger);
}
.diff-cursor {
  display: inline-block;
  width: 5px;
  height: 11px;
  margin-left: 3px;
  vertical-align: -1px;
  background: var(--tc-accent);
  animation: diff-signal 0.8s ease-in-out infinite;
}
@keyframes diff-reveal {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes diff-line-in {
  from {
    background-color: color-mix(in srgb, var(--ui-success) 22%, transparent);
  }
  to {
    background-color: color-mix(in srgb, var(--ui-success-soft) 72%, transparent);
  }
}
@keyframes diff-signal {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .diff-inspector,
  .diff-inspector * {
    animation: none !important;
  }
}
.diff-row.is-add {
  background: color-mix(in srgb, var(--ui-success-soft) 72%, transparent);
}
.diff-row.is-remove {
  background: color-mix(in srgb, var(--ui-danger-soft) 72%, transparent);
}
.diff-line {
  padding: 0 7px;
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  text-align: right;
  user-select: none;
}
.diff-sign {
  border-right: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-disabled);
  text-align: center;
  user-select: none;
}
.is-add .diff-sign {
  color: var(--ui-success);
}
.is-remove .diff-sign {
  color: var(--ui-danger);
}
.diff-row code {
  min-width: max-content;
  padding: 0 10px;
  color: var(--ui-text-secondary);
  white-space: pre;
}
.is-add code,
.is-remove code {
  color: var(--ui-text-primary);
}
.diff-inspector__truncated {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px;
  border-top: 1px solid var(--ui-border-default);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.06em;
}
.diff-inspector__truncated span:last-child {
  color: var(--ui-text-tertiary);
  font-weight: 500;
  letter-spacing: 0;
}
.diff-inspector__summary {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  color: var(--ui-text-secondary);
  font-size: 10px;
}
.diff-inspector__summary code {
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.diff-inspector__error {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  border-top: 2px solid var(--ui-danger);
  background: var(--ui-danger-soft);
}
.diff-inspector__error b {
  display: grid;
  place-items: start center;
  padding-top: 10px;
  border-right: 1px solid color-mix(in srgb, var(--ui-danger) 30%, transparent);
  color: var(--ui-danger);
  font: 800 9px var(--ui-font-mono);
}
.diff-inspector__error pre {
  margin: 0;
  padding: 9px 11px;
  overflow: auto;
  color: var(--ui-danger);
  font: 10px/1.5 var(--ui-font-mono);
  white-space: pre-wrap;
}
</style>
