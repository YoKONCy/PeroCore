<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Asset, FieldSchema } from '../types'
import type { Binding } from '../workflowTypes'
import type { WorkflowStore } from '../composables/useWorkflow'
import PictoriaSelect from './PictoriaSelect.vue'
import WorkflowValue from './WorkflowValue.vue'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{
  modelValue?: Binding
  schema?: FieldSchema
  store: WorkflowStore
  exclude?: string
  assets?: Asset[]
  depth?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Binding | undefined]; upload: [] }>()
const chosenMode = ref('')
const aspectRatio = computed(() => {
  const node = props.store.doc.nodes.find((node) => node.id === props.exclude),
    value = node?.inputs.aspect_ratio
  if (value)
    return 'literal' in value && typeof value.literal === 'string' ? value.literal : undefined
  const fallback = props.store.stepFor(node)?.inputSchema.properties?.aspect_ratio?.default
  return typeof fallback === 'string' ? fallback : undefined
})
const mode = computed(
  () =>
    chosenMode.value ||
    (props.modelValue && 'array' in props.modelValue
      ? 'array'
      : props.modelValue && !('literal' in props.modelValue)
        ? 'reference'
        : 'literal'),
)
watch(
  () => props.modelValue,
  (value) => {
    if (value) chosenMode.value = ''
  },
)
const base = computed(() =>
  props.modelValue && 'select' in props.modelValue ? props.modelValue.select : props.modelValue,
)
const source = computed(() =>
  base.value && ('input' in base.value || 'node' in base.value)
    ? JSON.stringify(
        'input' in base.value
          ? { input: base.value.input }
          : { node: base.value.node, output: base.value.output },
      )
    : '',
)
const path = computed(() =>
  props.modelValue && 'path' in props.modelValue ? props.modelValue.path?.join('/') || '' : '',
)
const options = computed(() => [
  ...Object.entries(props.store.doc.inputSchema.properties || {}).map(([name, schema]) => ({
    value: JSON.stringify({ input: name }),
    label: `输入 · ${schema.title || name}`,
  })),
  ...props.store.doc.nodes
    .filter((node) => node.id !== props.exclude)
    .flatMap((node) =>
      Object.entries(props.store.stepFor(node)?.outputSchema?.properties || {}).map(
        ([name, schema]) => ({
          value: JSON.stringify({ node: node.id, output: name }),
          label: `${node.label || props.store.stepFor(node)?.name || '节点'} · ${schema.title || name}`,
        }),
      ),
    ),
])
function setMode(value: string) {
  chosenMode.value = value
  emit(
    'update:modelValue',
    value === 'array'
      ? { array: [], flatten: true }
      : value === 'reference'
        ? undefined
        : {
            literal:
              props.schema?.type === 'boolean'
                ? false
                : ['number', 'integer'].includes(props.schema?.type || '')
                  ? 0
                  : props.schema?.type === 'array'
                    ? []
                    : props.schema?.type === 'object'
                      ? {}
                      : '',
          },
  )
}
function literal(value: unknown) {
  emit('update:modelValue', value === undefined ? undefined : { literal: value })
}
function pick(value: string) {
  if (value) emit('update:modelValue', JSON.parse(value) as Binding)
}
function setPath(value: string) {
  if (!base.value || 'literal' in base.value) return
  const path = value
    .split('/')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  emit(
    'update:modelValue',
    'array' in base.value || 'select' in base.value
      ? { select: base.value, path }
      : { ...base.value, path },
  )
}
function setRow(index: number, value?: Binding) {
  if (!props.modelValue || !('array' in props.modelValue)) return
  const array = props.modelValue.array.flatMap((row, current) =>
    current === index ? (value ? [value] : []) : [row],
  )
  emit('update:modelValue', { ...props.modelValue, array })
}
function move(index: number, direction: number) {
  if (!props.modelValue || !('array' in props.modelValue)) return
  const array = [...props.modelValue.array],
    next = index + direction
  if (next < 0 || next >= array.length) return
  ;[array[index], array[next]] = [array[next]!, array[index]!]
  emit('update:modelValue', { ...props.modelValue, array })
}
</script>
<template>
  <div class="workflow-binding" data-ui>
    <div class="workflow-binding-mode">
      <PictoriaSelect
        :model-value="mode"
        :options="[
          { value: 'literal', label: '固定值' },
          { value: 'reference', label: '引用' },
          ...((schema?.type === 'array' || mode === 'array') && (depth || 0) < 6
            ? [{ value: 'array', label: '多项' }]
            : []),
        ]"
        @update:model-value="setMode"
      />
      <button
        v-if="modelValue"
        class="icon-button"
        aria-label="清空"
        @click="emit('update:modelValue', undefined)"
      >
        <Icon name="close" :size="13" />
      </button>
    </div>
    <WorkflowValue
      v-if="mode === 'literal'"
      :owner="store.owner.value"
      :model-value="modelValue && 'literal' in modelValue ? modelValue.literal : undefined"
      :schema="schema"
      :assets="assets"
      :aspect-ratio="aspectRatio"
      @update:model-value="literal"
      @upload="emit('upload')"
    />
    <template v-else-if="mode === 'reference'">
      <PictoriaSelect
        :model-value="source"
        :options="options"
        placeholder="选择来源"
        @update:model-value="pick"
      />
      <input
        v-if="modelValue"
        :value="path"
        placeholder="路径（可选）"
        aria-label="选取路径"
        @change="setPath(($event.target as HTMLInputElement).value)"
      />
    </template>
    <template v-else-if="modelValue && 'array' in modelValue">
      <div v-for="(row, index) in modelValue.array" :key="index" class="workflow-binding-row">
        <header>
          <small>{{ index + 1 }}</small>
          <span />
          <button class="icon-button" :disabled="!index" aria-label="向前" @click="move(index, -1)">
            <Icon class="workflow-left" name="chevron" :size="12" />
          </button>
          <button
            class="icon-button"
            :disabled="index === modelValue.array.length - 1"
            aria-label="向后"
            @click="move(index, 1)"
          >
            <Icon name="chevron" :size="12" />
          </button>
          <button class="icon-button" aria-label="移除" @click="setRow(index)">
            <Icon name="close" :size="12" />
          </button>
        </header>
        <WorkflowBinding
          :model-value="row"
          :schema="schema?.items"
          :store="store"
          :exclude="exclude"
          :assets="assets"
          :depth="(depth || 0) + 1"
          @update:model-value="setRow(index, $event)"
          @upload="emit('upload')"
        />
      </div>
      <div class="workflow-array-actions">
        <button
          class="text-button"
          :disabled="modelValue.array.length >= 64"
          @click="
            emit('update:modelValue', {
              ...modelValue,
              array: [...modelValue.array, { literal: null }],
            })
          "
        >
          <Icon name="plus" :size="13" />
          添加
        </button>
        <label class="workflow-checkbox">
          <input
            type="checkbox"
            :checked="modelValue.flatten"
            @change="
              emit('update:modelValue', {
                ...modelValue,
                flatten: ($event.target as HTMLInputElement).checked,
              })
            "
          />
          展开数组
        </label>
      </div>
    </template>
  </div>
</template>
