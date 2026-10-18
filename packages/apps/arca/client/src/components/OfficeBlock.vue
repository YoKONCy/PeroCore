<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  officeChildren,
  OFFICE_TEXT_TYPES,
  runsOf,
  type OfficeContent,
  type OfficeNode,
  type OfficeRun,
} from '@infos/document-engine/office'
import {
  captureOfficeSelection,
  officeFragment,
  readOfficeRuns,
  restoreOfficeSelection,
} from '../services/officeDom'
import { textDifference } from '../services/documentDisplay'

const props = defineProps<{
  node: OfficeNode
  content: OfficeContent
  writable: boolean
  assets: Record<string, string>
  selectedId?: string
  textChanges?: Record<string, { before: string; after: string }>
  showChanges?: boolean
}>()
const emit = defineEmits<{
  input: [id: string, runs: OfficeRun[]]
  key: [id: string, event: KeyboardEvent]
  paste: [id: string, event: ClipboardEvent]
  select: [id: string]
  remove: [id: string]
  insert: [id: string]
  compose: [active: boolean, text?: string]
  cut: [id: string, event: ClipboardEvent]
  before: [id: string, event: InputEvent]
}>()
const element = ref<HTMLElement>(),
  composing = ref(false)
let localValue = ''
const children = computed(() => officeChildren(props.content, props.node.nodeId))
const columnWidths = computed(() =>
  Array.isArray(props.node.attributes.columnWidths)
    ? props.node.attributes.columnWidths.map((width) =>
        Math.max(24, Math.min(1600, Number(width) || 120)),
      )
    : [],
)
const columnTotal = computed(() => columnWidths.value.reduce((sum, width) => sum + width, 0))
const textNode = computed(() => OFFICE_TEXT_TYPES.has(props.node.type))
const change = computed(() => props.textChanges?.[props.node.nodeId])
const difference = computed(() =>
  change.value ? textDifference(change.value.before, change.value.after) : undefined,
)
const wrapper = computed(() =>
  props.node.type === 'table-row'
    ? 'tr'
    : props.node.type === 'table-cell'
      ? props.node.attributes.headerCell === true
        ? 'th'
        : 'td'
      : props.node.type === 'list-item'
        ? 'li'
        : 'section',
)
const textTag = computed(() =>
  props.node.type === 'heading'
    ? `h${Math.max(1, Math.min(6, Number(props.node.attributes.level) || 2))}`
    : props.node.type === 'quote'
      ? 'blockquote'
      : props.node.type === 'code-block'
        ? 'pre'
        : 'div',
)
const style = computed(() => {
  const attrs = props.node.attributes
  return {
    borderColor:
      typeof attrs.borderColor === 'string' && /^#[a-f0-9]{6}$/i.test(attrs.borderColor)
        ? attrs.borderColor
        : undefined,
    borderStyle: attrs.borderStyle === 'none' ? 'none' : undefined,
    textAlign: ['left', 'center', 'right', 'justify'].includes(String(attrs.align))
      ? (String(attrs.align) as 'left')
      : undefined,
    lineHeight:
      typeof attrs.lineHeight === 'number'
        ? String(Math.max(1, Math.min(3, attrs.lineHeight)))
        : undefined,
    marginLeft:
      typeof attrs.indent === 'number'
        ? `${Math.max(0, Math.min(12, attrs.indent)) * 1.5}em`
        : undefined,
    width:
      typeof attrs.width === 'number'
        ? `${Math.max(24, Math.min(1600, attrs.width))}px`
        : undefined,
    breakBefore: attrs.pageBreakBefore === true ? ('page' as const) : undefined,
  }
})
function sync(): void {
  if (!element.value || composing.value) return
  const runs = runsOf(props.node),
    encoded = JSON.stringify(runs)
  if (localValue === encoded) return
  const current = window.getSelection()
  const selection =
    current?.anchorNode?.isConnected &&
    current.focusNode?.isConnected &&
    (element.value.contains(current.anchorNode) || element.value.contains(current.focusNode))
      ? captureOfficeSelection()
      : undefined
  element.value.replaceChildren(officeFragment(runs))
  localValue = encoded
  if (selection) void nextTick(() => restoreOfficeSelection(selection))
}
function input(): void {
  if (!element.value || composing.value) return
  const runs = readOfficeRuns(element.value)
  localValue = JSON.stringify(runs)
  emit('input', props.node.nodeId, runs)
}
watch(
  () => [props.node.text, props.node.attributes.runs],
  () => {
    void nextTick(sync)
  },
  { deep: true },
)
watch(
  () => [textTag.value, wrapper.value],
  () => {
    localValue = ''
    void nextTick(sync)
  },
)
onMounted(sync)
onBeforeUnmount(() => {
  if (composing.value) {
    composing.value = false
    input()
    emit('compose', false)
  }
})
function composition(active: boolean, text?: string): void {
  composing.value = active
  emit('compose', active, text)
  if (!active) input()
}
</script>

<template>
  <component
    :is="wrapper"
    :id="`node-${node.nodeId}`"
    class="office-block"
    :class="[
      `office-block--${node.type}`,
      {
        'office-block-selected': writable && selectedId === node.nodeId,
        'office-page-break': node.attributes.pageBreakBefore,
      },
    ]"
    :data-node-id="node.nodeId"
    :colspan="
      node.type === 'table-cell'
        ? Math.max(1, Math.min(30, Number(node.attributes.colspan) || 1))
        : undefined
    "
    :rowspan="
      node.type === 'table-cell'
        ? Math.max(1, Math.min(100, Number(node.attributes.rowspan) || 1))
        : undefined
    "
    :style="style"
  >
    <div
      v-if="writable && node.parentId && !['table-row', 'table-cell'].includes(node.type)"
      class="office-block-tools"
      contenteditable="false"
    >
      <button
        type="button"
        title="选择此内容"
        @mousedown.prevent
        @click="emit('select', node.nodeId)"
      >
        ⋮
      </button>
      <button
        type="button"
        title="在后方插入正文"
        @mousedown.prevent
        @click="emit('insert', node.nodeId)"
      >
        ＋
      </button>
      <button
        type="button"
        title="删除此内容"
        @mousedown.prevent
        @click="emit('remove', node.nodeId)"
      >
        ×
      </button>
    </div>
    <component
      :is="textTag"
      v-if="textNode && change && difference"
      class="office-editable office-inline-diff"
    >
      <template v-if="showChanges">
        <span>{{ difference.prefix }}</span>
        <del v-if="difference.removed">{{ difference.removed }}</del>
        <ins v-if="difference.added">{{ difference.added }}</ins>
        <span>{{ difference.suffix }}</span>
      </template>
      <template v-else>{{ change.after }}</template>
    </component>
    <component
      :is="textTag"
      v-else-if="textNode"
      ref="element"
      class="office-editable"
      :data-office-editable="node.nodeId"
      :contenteditable="writable ? 'true' : 'false'"
      spellcheck="true"
      @input="input"
      @compositionstart="composition(true)"
      @compositionend="composition(false, $event.data)"
      @keydown="!composing && emit('key', node.nodeId, $event)"
      @paste="emit('paste', node.nodeId, $event)"
      @cut="emit('cut', node.nodeId, $event)"
      @beforeinput="emit('before', node.nodeId, $event)"
      @focus="emit('select', node.nodeId)"
    />
    <figure
      v-else-if="node.type === 'asset'"
      :tabindex="writable ? 0 : undefined"
      @click="emit('select', node.nodeId)"
      @focus="emit('select', node.nodeId)"
    >
      <img
        v-if="assets[String(node.attributes.blobId)]"
        :src="assets[String(node.attributes.blobId)]"
        :alt="String(node.attributes.alt ?? '')"
        :style="{
          width:
            typeof node.attributes.width === 'number' ? `${node.attributes.width}px` : undefined,
        }"
      />
      <p v-else>图片暂不可用</p>
      <figcaption v-if="node.attributes.caption">{{ node.attributes.caption }}</figcaption>
    </figure>
    <table v-else-if="node.type === 'table'">
      <colgroup v-if="columnWidths.length">
        <col
          v-for="(width, index) in columnWidths"
          :key="index"
          :style="{ width: `${(width / columnTotal) * 100}%` }"
        />
      </colgroup>
      <tbody>
        <OfficeBlock
          v-for="child in children"
          :key="child.nodeId"
          :node="child"
          :content="content"
          :writable="writable"
          :assets="assets"
          :selected-id="selectedId"
          :text-changes="textChanges"
          :show-changes="showChanges"
          @input="(id, runs) => emit('input', id, runs)"
          @key="(id, event) => emit('key', id, event)"
          @paste="(id, event) => emit('paste', id, event)"
          @select="(id) => emit('select', id)"
          @compose="(active, text) => emit('compose', active, text)"
          @cut="(id, event) => emit('cut', id, event)"
          @before="(id, event) => emit('before', id, event)"
        />
      </tbody>
    </table>
    <component :is="node.attributes.ordered ? 'ol' : 'ul'" v-else-if="node.type === 'list'">
      <OfficeBlock
        v-for="child in children"
        :key="child.nodeId"
        :node="child"
        :content="content"
        :writable="writable"
        :assets="assets"
        :selected-id="selectedId"
        :text-changes="textChanges"
        :show-changes="showChanges"
        @input="(id, runs) => emit('input', id, runs)"
        @key="(id, event) => emit('key', id, event)"
        @paste="(id, event) => emit('paste', id, event)"
        @select="(id) => emit('select', id)"
        @remove="(id) => emit('remove', id)"
        @insert="(id) => emit('insert', id)"
        @compose="(active, text) => emit('compose', active, text)"
        @cut="(id, event) => emit('cut', id, event)"
        @before="(id, event) => emit('before', id, event)"
      />
    </component>
    <p v-if="node.type === 'programmable-island'" class="office-unsupported">扩展内容</p>
    <OfficeBlock
      v-for="child in node.type === 'list' || node.type === 'table' ? [] : children"
      :key="child.nodeId"
      :node="child"
      :content="content"
      :writable="writable"
      :assets="assets"
      :selected-id="selectedId"
      :text-changes="textChanges"
      :show-changes="showChanges"
      @input="(id, runs) => emit('input', id, runs)"
      @key="(id, event) => emit('key', id, event)"
      @paste="(id, event) => emit('paste', id, event)"
      @select="(id) => emit('select', id)"
      @remove="(id) => emit('remove', id)"
      @insert="(id) => emit('insert', id)"
      @compose="(active, text) => emit('compose', active, text)"
      @cut="(id, event) => emit('cut', id, event)"
      @before="(id, event) => emit('before', id, event)"
    />
  </component>
</template>

<style scoped>
.office-block {
  position: relative;
  min-width: 0;
  scroll-margin-block: 80px;
}
.office-editable {
  min-height: 1.7em;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
  line-height: inherit;
}
.office-editable[contenteditable='true']:empty::before {
  content: '';
  display: inline-block;
  min-height: 1.7em;
}
.office-block--paragraph {
  margin-block: 0.65em;
}
.office-block--heading {
  margin-block: 1.6em 0.7em;
}
.office-block--heading h1 {
  font-family: var(--arca-font-editorial);
  font-size: 26pt;
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: 0.3px;
}
.office-block--heading h2 {
  font-size: 16pt;
  line-height: 1.5;
}
.office-block--heading h3 {
  font-size: 14pt;
  line-height: 1.5;
}
.office-block--heading h4 {
  font-size: 12pt;
}
.office-block--heading h5,
.office-block--heading h6 {
  font-size: 11pt;
}
.office-block-selected.office-block--asset {
  outline: 2px solid var(--arca-mist);
  outline-offset: 5px;
  border-radius: 3px;
}
.office-block-selected.office-block--table-cell {
  background: var(--arca-selection);
}
.office-block-tools {
  position: absolute;
  right: calc(100% + 6px);
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  opacity: 0;
  padding: 3px;
  border: 1px solid var(--arca-line);
  border-radius: 6px;
  background: var(--arca-surface);
  box-shadow: var(--arca-shadow-xs);
}
.office-block:hover > .office-block-tools,
.office-block:focus-within > .office-block-tools {
  opacity: 1;
}
.office-block-tools button {
  width: 22px;
  height: 21px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--arca-text-soft);
  font-size: 13px;
}
.office-block-tools button:last-child:hover {
  color: var(--arca-coral);
}
.office-block table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-block: 20px;
  font-size: 11pt;
}
.office-block td,
.office-block th {
  border: 1px solid var(--arca-line-strong);
  padding: 9px 12px;
  vertical-align: top;
}
.office-block th {
  background: var(--arca-surface-soft);
  text-align: left;
  font-weight: 600;
}
.office-block figure {
  margin: 20px 0;
  outline: none;
}
.office-block img {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
  border-radius: 3px;
}
.office-block figcaption {
  color: var(--arca-text-soft);
  font-size: 0.85em;
  text-align: center;
  margin-top: 10px;
}
.office-block blockquote {
  border-left: 3px solid var(--arca-mist);
  padding: 8px 16px;
  margin: 14px 0;
  background: var(--arca-surface-soft);
  color: var(--arca-text-soft);
  border-radius: 0 5px 5px 0;
}
.office-block pre {
  font-family: var(--arca-font-code);
  padding: 14px 18px;
  background: var(--arca-surface-soft);
  border: 1px solid var(--arca-line);
  border-radius: 6px;
  font-size: 11pt;
}
.office-block ul,
.office-block ol {
  margin-block: 12px;
  padding-left: 1.8em;
}
.office-block--list-item {
  margin-block: 0.3em;
}
.office-page-break {
  border-top: 1px dashed var(--arca-line-strong);
  padding-top: 28px;
  margin-top: 28px;
}
.office-unsupported {
  padding: 20px;
  border: 1px dashed var(--arca-line-strong);
  border-radius: 6px;
  color: var(--arca-text-soft);
  font-size: 12px;
  text-align: center;
}
.office-inline-diff del {
  color: var(--arca-coral);
  background: var(--arca-danger-soft);
  text-decoration-thickness: 1px;
}
.office-inline-diff ins {
  color: var(--arca-verdant);
  background: var(--arca-success-soft);
  text-decoration: none;
}
@media (hover: none) {
  .office-block:focus-within > .office-block-tools {
    opacity: 1;
  }
}
</style>
