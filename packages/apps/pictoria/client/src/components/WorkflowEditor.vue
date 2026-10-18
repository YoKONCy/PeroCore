<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CanvasStore } from '../composables/useCanvas'
import { useWorkflow } from '../composables/useWorkflow'
import { useCanvasNavigation } from '../composables/useCanvasNavigation'
import { useNodeClipboard } from '../composables/useNodeClipboard'
import { useWorkflowGraph } from '../composables/useWorkflowGraph'
import { leaves, type Binding, type WorkflowNode } from '../workflowTypes'
import type { Asset, Run, Step } from '../types'
import { pictoria, fileBase64 } from '../services/transport'
import { stepLabel } from '../services/labels'
import Icon from './PictoriaIcon.vue'
import PictoriaSelect from './PictoriaSelect.vue'
import NodeAnnotation from './NodeAnnotation.vue'
import NoteCard from './NoteCard.vue'
import CanvasGuides from './CanvasGuides.vue'
import WorkflowFields from './WorkflowFields.vue'
import WorkflowBinding from './WorkflowBinding.vue'
import WorkflowValue from './WorkflowValue.vue'
import WorkflowStepSettings from './WorkflowStepSettings.vue'
import TaskRecovery from './TaskRecovery.vue'
import ProviderDialog from './ProviderDialog.vue'

const props = defineProps<{
  canvas: CanvasStore
  theme: 'dark' | 'light'
  suspended?: boolean
  exitDisabled?: boolean
}>()
const emit = defineEmits<{
  close: []
  quit: []
  theme: []
  published: []
  dirty: [value: boolean]
}>()
const owner = computed(() => props.canvas.agentId.value),
  flow = useWorkflow(owner)
const {
  doc,
  list,
  steps,
  selected,
  dirty,
  saving,
  busy,
  blocked,
  error,
  notice,
  loaded,
  run,
  issues,
  releases,
} = flow
const stepSettings = ref(false),
  recovery = ref(false),
  providerSettings = ref(false),
  apiMode = ref(false),
  llmApiMode = ref(false)
const videoApiMode = ref(false)
const surface = ref<HTMLElement | null>(null),
  navigation = useCanvasNavigation(
    flow.navigationStore,
    surface,
    computed(
      () => !stepSettings.value && !recovery.value && !providerSettings.value && !props.suspended,
    ),
  )
const { viewport, tool, panActive, dragging, guides, marquee } = navigation
const graph = useWorkflowGraph(flow, navigation.world)
const { edges, connecting, pendingPath, selectedEdge, arranging } = graph
const clipboard = useNodeClipboard({
  context: () => `${owner.value}:${doc.id}`,
  enabled: () =>
    loaded.value &&
    !stepSettings.value &&
    !recovery.value &&
    !providerSettings.value &&
    !busy.value &&
    !props.suspended,
  snapshot: () => {
    graph.finishArrangement()
    return flow.copyNodes()
  },
  paste: (value, offset) => {
    graph.finishArrangement()
    const point = navigation.center()
    flow.pasteNodes(value, { x: point.x + offset, y: point.y + offset })
    error.value = ''
  },
  message: (value) => {
    notice.value = value
    error.value = ''
  },
  error: (value) => {
    error.value = value
  },
})
const palette = ref(true),
  picker = ref(false),
  paletteQuery = ref(''),
  panel = ref<'node' | 'interface' | 'tutorial'>('interface')
const interfaceTab = ref<'input' | 'output' | 'settings'>('input'),
  drawer = ref<'run' | 'issues' | 'history' | null>(null)
const searchOpen = ref(false),
  searchQuery = ref(''),
  searchCurrent = ref(''),
  deletion = ref(false)
const editedStep = ref<Step>(),
  editedNode = ref(''),
  uploading = ref(false)
watch(
  () => doc.testInputs,
  (value) => {
    if (!value) doc.testInputs = {}
  },
  { immediate: true, flush: 'sync' },
)
const testInputs = computed(() => doc.testInputs ?? {})
const assets = ref<Asset[]>([]),
  fileInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const uploadTarget = ref<{ kind: 'test' | 'node' | 'output'; field: string; nodeId?: string }>()
let disposed = false,
  searchTimer: ReturnType<typeof setTimeout> | undefined
const selectedNode = computed(() => doc.nodes.find((node) => selected.value[0] === node.id))
const selectedStep = computed(() =>
  selectedNode.value ? flow.stepFor(selectedNode.value) : undefined,
)
const catalogue = computed(() =>
  steps.value.filter(
    (step) =>
      step.id !== doc.id &&
      `${step.name} ${step.modelName || ''} ${step.providerName || ''}`
        .toLowerCase()
        .includes(paletteQuery.value.toLowerCase()),
  ),
)
const matches = computed(() => {
  const words = searchQuery.value
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return words.length
    ? flow.items.value.filter((item) => {
        const node = doc.nodes.find((node) => node.id === item.id),
          text = [
            item.content.name,
            item.content.comment,
            item.content.text,
            ...Object.values(node?.inputs || {})
              .flatMap(leaves)
              .flatMap((binding) =>
                'literal' in binding && typeof binding.literal === 'string'
                  ? [binding.literal]
                  : [],
              ),
          ]
            .filter(Boolean)
            .join('\n')
            .normalize('NFKC')
            .toLocaleLowerCase()
        return words.every((word) => text.includes(word))
      })
    : []
})
const searchPosition = computed(
  () => matches.value.findIndex((node) => node.id === searchCurrent.value) + 1,
)
const statuses: Record<string, string> = {
  pending: '待执行',
  queued: '排队',
  running: '执行中',
  submitted: '等待回传',
  saving: '保存中',
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
  uncertain: '待核验',
  waiting: '待核验',
  skipped: '已跳过',
  cancelled: '已取消',
}
const stateFor = (id: string) => {
  if (flow.runStale.value) return undefined
  const nodes =
    run.value?.nodes.filter((node) => node.id === id || node.id.startsWith(`${id}/`)) || []
  return (
    nodes.find((node) =>
      ['failed', 'uncertain', 'running', 'submitted', 'saving'].includes(node.state),
    )?.state || nodes[0]?.state
  )
}
const outputIds = (value: unknown): string[] =>
  !value || typeof value !== 'object'
    ? []
    : 'assetId' in value && typeof value.assetId === 'string'
      ? [value.assetId]
      : [...new Set(Object.values(value).flatMap(outputIds))]
const resultAssets = computed(() => outputIds(run.value?.result))
const box = (id: string) => flow.items.value.find((item) => item.id === id)!
const nodeStyle = (id: string) => {
  const item = box(id)
  return {
    width: `${item.content.width}px`,
    height: `${item.content.height}px`,
    transform: `translate(${item.x}px, ${item.y}px)`,
  }
}
const portFields = (node: WorkflowNode, output: boolean) =>
  Object.entries(
    (output ? flow.stepFor(node)?.outputSchema : flow.stepFor(node)?.inputSchema)?.properties || {},
  )
function bindingLabel(binding?: Binding) {
  if (!binding) return '未连接'
  if ('literal' in binding)
    return typeof binding.literal === 'string'
      ? binding.literal || '空文本'
      : Array.isArray(binding.literal)
        ? `${binding.literal.length} 项`
        : '固定值'
  if ('array' in binding) return `${binding.array.length} 项引用`
  if ('select' in binding) return '字段选取'
  if ('input' in binding) return doc.inputSchema.properties?.[binding.input]?.title || binding.input
  return (
    doc.nodes.find((node) => node.id === binding.node)?.label ||
    flow.stepFor(doc.nodes.find((node) => node.id === binding.node)!)?.name ||
    '节点输出'
  )
}
function nodePointer(event: PointerEvent, id: string) {
  graph.finishArrangement()
  selectedEdge.value = ''
  navigation.pointerDown(event, id)
}
function inspect(id: string) {
  selected.value = [id]
  panel.value = id === '__input' || id === '__output' ? 'interface' : 'node'
  if (id === '__input') interfaceTab.value = 'input'
  if (id === '__output') interfaceTab.value = 'output'
}
watch(selected, (value) => {
  const id = value[0]
  if (!id || id.startsWith('__note:')) return
  panel.value = id === '__input' || id === '__output' ? 'interface' : 'node'
  if (id === '__input') interfaceTab.value = 'input'
  if (id === '__output') interfaceTab.value = 'output'
})
function focusNode(id: string) {
  const item = flow.items.value.find((item) => item.id === id)
  if (!item) {
    notice.value = '节点已变化'
    return
  }
  inspect(id)
  navigation.reveal(item)
}
async function exit() {
  graph.finishArrangement()
  await nextTick()
  if (dirty.value && !(await flow.save())) return
  if (dirty.value && !(await flow.save())) return
  if (!dirty.value) emit('close')
}
function elapsed(node: Run['nodes'][number]) {
  return node.startedAt
    ? `${Math.max(0, Math.round(((node.finishedAt ? Date.parse(node.finishedAt) : Date.now()) - Date.parse(node.startedAt)) / 1000))}s`
    : ''
}
function resolvedInputs(node: Run['nodes'][number]) {
  const resolve = (binding: Binding): unknown => {
    if ('literal' in binding) return binding.literal
    if ('array' in binding) {
      const values = binding.array.map(resolve)
      return binding.flatten ? values.flat(1) : values
    }
    let value =
      'select' in binding
        ? resolve(binding.select)
        : 'input' in binding
          ? run.value?.inputs?.[binding.input]
          : run.value?.nodes.find((node) => node.id === binding.node)?.outputs?.[binding.output]
    for (const key of 'path' in binding ? binding.path || [] : [])
      value =
        value &&
        typeof value === 'object' &&
        !['__proto__', 'constructor', 'prototype'].includes(String(key))
          ? (value as Record<string | number, unknown>)[key]
          : undefined
    return value
  }
  return Object.fromEntries(
    Object.entries(node.inputs || {}).map(([field, binding]) => [
      field,
      resolve(binding as Binding),
    ]),
  )
}
async function addResult(id: string) {
  const agent = owner.value
  try {
    const asset =
      assets.value.find((asset) => asset.id === id) ||
      (await pictoria.operation<Asset>(agent, 'asset.get', { id }))
    if (disposed || agent !== owner.value) return
    props.canvas.checkpoint()
    const right =
      Math.max(0, ...props.canvas.project.items.map((item) => item.x + item.content.width)) + 80
    props.canvas.addAsset(asset, right, 0)
    notice.value = '已加入画布'
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '添加失败'
  }
}
function setBinding(field: string, binding?: Binding, output = false) {
  const values = output ? doc.outputs : selectedNode.value?.inputs
  if (!values) return
  if (binding) values[field] = binding
  else delete values[field]
}
function removeInput(name: string) {
  const remove = (binding: Binding): Binding | undefined =>
    'input' in binding && binding.input === name
      ? undefined
      : 'array' in binding
        ? {
            ...binding,
            array: binding.array.flatMap((item) => {
              const next = remove(item)
              return next ? [next] : []
            }),
          }
        : 'select' in binding
          ? (() => {
              const next = remove(binding.select)
              return next ? { ...binding, select: next } : undefined
            })()
          : binding
  for (const values of [...doc.nodes.map((node) => node.inputs), doc.outputs])
    for (const [name, binding] of Object.entries(values)) {
      const next = remove(binding)
      if (next) values[name] = next
      else delete values[name]
    }
}
function jump(direction = 1) {
  if (!matches.value.length) return
  const current = matches.value.findIndex((node) => node.id === searchCurrent.value),
    index =
      current < 0
        ? direction < 0
          ? matches.value.length - 1
          : 0
        : (current + direction + matches.value.length) % matches.value.length
  searchCurrent.value = matches.value[index]!.id
  graph.finishArrangement()
  navigation.reveal(box(searchCurrent.value))
}
watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchCurrent.value = ''
    jump()
  }, 140)
})
watch(searchOpen, (value) => {
  if (value)
    void nextTick(() =>
      surface.value?.querySelector<HTMLInputElement>('.canvas-search-input')?.focus(),
    )
  else {
    searchQuery.value = ''
    searchCurrent.value = ''
  }
})
watch(
  () => matches.value.map((node) => node.id).join('|'),
  () => {
    if (matches.value.length && !matches.value.some((node) => node.id === searchCurrent.value))
      jump()
    else if (!matches.value.length) searchCurrent.value = ''
  },
)
function keyboard(event: KeyboardEvent) {
  if (stepSettings.value || recovery.value || providerSettings.value || props.suspended) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') graph.finishArrangement()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    event.stopImmediatePropagation()
    searchOpen.value = true
    void nextTick(() =>
      surface.value?.querySelector<HTMLInputElement>('.canvas-search-input')?.focus(),
    )
  }
  if (searchOpen.value && event.key === 'F3') {
    event.preventDefault()
    event.stopImmediatePropagation()
    jump(event.shiftKey ? -1 : 1)
  }
}
window.addEventListener('keydown', keyboard, true)
async function open(id: string) {
  graph.finishArrangement()
  if (await flow.open(id)) {
    picker.value = false
    deletion.value = false
    await nextTick()
    if (doc.viewport) Object.assign(viewport, doc.viewport)
    else navigation.fit()
  }
}
async function create(copy = false) {
  graph.finishArrangement()
  if (await flow.create(copy)) {
    picker.value = false
    await nextTick()
    navigation.fit()
  }
}
async function createExample() {
  graph.finishArrangement()
  if (await flow.createExample()) {
    picker.value = false
    palette.value = false
    panel.value = 'tutorial'
    await nextTick()
    navigation.fit()
  }
}
function addNote() {
  graph.finishArrangement()
  const point = navigation.center()
  flow.addNote(point.x, point.y)
}
function chooseStep(id: string) {
  const node = selectedNode.value,
    step = steps.value.find((step) => step.id === id)
  if (!node || !step) return
  flow.checkpoint()
  node.stepId = step.id
  node.stepRevision = step.revision
  // 切换步骤时保留同名输入引用，示例连线无需重新搭建。
  node.inputs = Object.fromEntries(
    Object.entries(node.inputs).filter(([field]) => step.inputSchema.properties?.[field]),
  )
  for (const [name, field] of Object.entries(step.inputSchema.properties || {})) {
    if (node.inputs[name] === undefined && field.default !== undefined)
      node.inputs[name] = { literal: JSON.parse(JSON.stringify(field.default)) }
  }
}
function add(step: Step) {
  graph.finishArrangement()
  const previous =
    flow.activeItems.value.find(
      (item) => !item.id.startsWith('__note:') && item.id !== '__output',
    ) ||
    [...flow.items.value]
      .filter((item) => !item.id.startsWith('__note:') && item.id !== '__output')
      .sort((a, b) => b.y + b.content.height - a.y - a.content.height)[0]
  const point = previous
    ? { x: previous.x, y: previous.y + previous.content.height + 120 }
    : navigation.center()
  flow.add(step, point.x, point.y)
  const added = flow.items.value.find((item) => item.id === selected.value[0])
  if (added) {
    doc.io.output.y = Math.max(doc.io.output.y, added.y + added.content.height + 120)
    navigation.reveal(added)
  }
  panel.value = 'node'
}
async function publish() {
  await flow.action('publish')
  if (notice.value === '已发布') emit('published')
}
async function check() {
  drawer.value = 'issues'
  await flow.action('check')
}
async function history() {
  drawer.value = drawer.value === 'history' ? null : 'history'
  try {
    await flow.historyList()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '读取失败'
  }
}
function settings(step?: Step, nodeId = '', api = false, llmApi = false, videoApi = false) {
  editedStep.value = step
  editedNode.value = nodeId
  apiMode.value = api
  llmApiMode.value = llmApi
  videoApiMode.value = videoApi
  stepSettings.value = true
}
function configureApi(id: string) {
  const node = doc.nodes.find((item) => item.id === id)
  if (!node) return
  inspect(id)
  settings(flow.stepFor(node), id, true)
}
async function stepSaved(step: Step) {
  stepSettings.value = false
  flow.versions[`${step.id}:${step.revision}`] = step
  if (editedNode.value) {
    const node = doc.nodes.find((node) => node.id === editedNode.value)
    if (node) {
      flow.checkpoint()
      node.stepId = step.id
      node.stepRevision = step.revision
      for (const key of Object.keys(node.inputs))
        if (!step.inputSchema.properties?.[key]) delete node.inputs[key]
    }
  } else add(step)
  try {
    await flow.refreshSteps()
  } catch {
    error.value = '步骤列表更新失败'
  }
}
function updateStep() {
  const node = selectedNode.value,
    step = steps.value.find((step) => step.id === node?.stepId)
  if (!node || !step) return
  flow.checkpoint()
  node.stepRevision = step.revision
}
function chooseUpload(kind: 'test' | 'node' | 'output', field: string) {
  uploadTarget.value = { kind, field, nodeId: selectedNode.value?.id }
  fileInput.value?.click()
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    files = Array.from(input.files || []),
    target = uploadTarget.value,
    agent = owner.value,
    id = doc.id
  input.value = ''
  if (!target || !files.length || uploading.value) return
  uploading.value = true
  error.value = ''
  try {
    const imported: Asset[] = []
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw new Error('素材不能超过 20 MB')
      imported.push(await pictoria.upload(agent, file.name, file.type, await fileBase64(file)))
    }
    if (disposed || agent !== owner.value || id !== doc.id) return
    assets.value = [
      ...imported,
      ...assets.value.filter((asset) => !imported.some((item) => item.id === asset.id)),
    ]
    const schema =
      target.kind === 'test'
        ? doc.inputSchema.properties?.[target.field]
        : target.kind === 'output'
          ? doc.outputSchema.properties?.[target.field]
          : flow.stepFor(doc.nodes.find((node) => node.id === target.nodeId)!)?.inputSchema
              .properties?.[target.field]
    const values = imported.map((asset) => ({ assetId: asset.id }))
    if (target.kind === 'test')
      testInputs.value[target.field] =
        schema?.type === 'array'
          ? [
              ...(Array.isArray(testInputs.value[target.field])
                ? (testInputs.value[target.field] as unknown[])
                : []),
              ...values,
            ]
          : values[0]
    else {
      flow.checkpoint()
      const bindings =
        target.kind === 'output'
          ? doc.outputs
          : doc.nodes.find((node) => node.id === target.nodeId)?.inputs
      if (bindings) {
        const previous = bindings[target.field]
        bindings[target.field] =
          schema?.type === 'array'
            ? previous && 'array' in previous
              ? {
                  ...previous,
                  array: [...previous.array, ...values.map((value) => ({ literal: value }))],
                }
              : {
                  literal: [
                    ...(previous && 'literal' in previous && Array.isArray(previous.literal)
                      ? previous.literal
                      : []),
                    ...values,
                  ],
                }
            : { literal: values[0] }
      }
    }
  } catch (failure) {
    if (!disposed && agent === owner.value && id === doc.id)
      error.value = failure instanceof Error ? failure.message : '上传失败'
  } finally {
    uploading.value = false
  }
}
watch(
  owner,
  async (agent) => {
    assets.value = []
    const context = doc.id
    try {
      const result = await pictoria.operation<Asset[]>(agent, 'asset.list', { limit: 100 })
      if (!disposed && owner.value === agent && (doc.id === context || loaded.value))
        assets.value = result
    } catch {
      /* 素材可在上传后继续使用。 */
    }
  },
  { immediate: true },
)
watch(resultAssets, async (ids) => {
  const agent = owner.value,
    flowId = doc.id
  for (const id of ids)
    try {
      await props.canvas.ensureMedia(id)
      if (disposed || owner.value !== agent || flowId !== doc.id) return
      if (!assets.value.some((asset) => asset.id === id)) {
        const asset = await pictoria.operation<Asset>(agent, 'asset.get', { id })
        if (!disposed && owner.value === agent && flowId === doc.id) assets.value.push(asset)
      }
    } catch {
      /* 单个预览失败不影响其他作品。 */
    }
})
async function imported(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('配置不能超过 2 MB')
    graph.finishArrangement()
    await flow.importDraft(JSON.parse(await file.text()))
    await nextTick()
    navigation.fit()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '导入失败'
  }
}
async function restoreRelease(revision: number) {
  graph.finishArrangement()
  await flow.restore(revision)
  await nextTick()
  if (doc.viewport) Object.assign(viewport, doc.viewport)
  else navigation.fit()
}
async function removeFlow() {
  graph.finishArrangement()
  await flow.removeFlow()
  deletion.value = false
}
function focusIssue(issue: { nodeId?: string; field?: string }) {
  if (issue.nodeId) {
    focusNode(issue.nodeId)
    return
  }
  panel.value = 'interface'
  interfaceTab.value = issue.field?.startsWith('inputSchema')
    ? 'input'
    : ['name', 'usageDescription'].includes(issue.field || '')
      ? 'settings'
      : 'output'
}
watch(
  () => `${owner.value}:${doc.id}`,
  () => {
    searchCurrent.value = ''
    searchQuery.value = ''
    drawer.value = null
    recovery.value = false
  },
)
watch(
  () => doc.inputSchema.properties,
  (fields) => {
    for (const [name, field] of Object.entries(fields || {}))
      if (field.default !== undefined && testInputs.value[name] === undefined)
        testInputs.value[name] = JSON.parse(JSON.stringify(field.default))
  },
  { deep: true, immediate: true },
)
watch(loaded, async (value) => {
  if (value) {
    await nextTick()
    if (doc.viewport) Object.assign(viewport, doc.viewport)
    else navigation.fit()
  }
})
watch(
  viewport,
  () => {
    if (loaded.value && !busy.value && !props.suspended) doc.viewport = { ...viewport }
  },
  { deep: true },
)
watch([dirty, saving], () => emit('dirty', dirty.value || saving.value), { immediate: true })
async function prepareExit() {
  if (!loaded.value || busy.value || uploading.value)
    throw new Error('请等待工作流当前操作完成后再退出')
  graph.finishArrangement()
  flow.setPaused(true)
  await nextTick()
  flow.persistDraft()
  if ((dirty.value || saving.value || !doc.revision) && !(await flow.save()))
    throw new Error(error.value || '工作流尚未保存，请处理后再退出')
  await nextTick()
  if (dirty.value) throw new Error('工作流仍有未保存修改，请稍后再试')
}
function resumeAfterExitFailure() {
  flow.setPaused(false)
}
defineExpose({ prepareExit, resumeAfterExitFailure })
function guard(event: BeforeUnloadEvent) {
  graph.finishArrangement()
  flow.persistDraft()
  if (dirty.value || saving.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
window.addEventListener('beforeunload', guard)
onBeforeUnmount(() => {
  graph.finishArrangement()
  flow.persistDraft()
  disposed = true
  emit('dirty', false)
  clearTimeout(searchTimer)
  window.removeEventListener('keydown', keyboard, true)
  window.removeEventListener('beforeunload', guard)
})
</script>

<template>
  <main
    ref="surface"
    :inert="props.suspended"
    class="pictoria-canvas workflow-canvas"
    :class="{
      'is-panning': panActive,
      'is-box-selecting': navigation.boxActive.value,
      'is-dragging': dragging,
      'is-connecting': connecting,
      'is-arranging': arranging,
    }"
    :style="{
      '--grid-size': `${24 * viewport.scale}px`,
      '--grid-x': `${viewport.x}px`,
      '--grid-y': `${viewport.y}px`,
    }"
    @pointerdown.capture="navigation.capturePointerDown"
    @dblclick.capture="navigation.captureDoubleClick"
    @pointerdown="navigation.pointerDown($event)"
    @pointermove="navigation.pointerMove"
    @pointerup="navigation.pointerUp"
    @pointercancel="navigation.pointerUp"
    @wheel="navigation.wheel"
    @contextmenu.prevent
  >
    <div class="canvas-ambience" aria-hidden="true" />
    <header class="canvas-header" data-ui>
      <div class="header-left">
        <button class="quiet-button" :disabled="busy || saving" @click="exit">
          <Icon name="chevron" class="workflow-left" :size="17" />
          画布
        </button>
        <i class="header-divider" />
        <button class="project-switcher" @click="picker = !picker">
          <Icon name="workflow" :size="17" />
          <span>{{ doc.name }}</span>
          <Icon name="down" :size="13" />
        </button>
        <span class="save-status">
          <span class="status-dot" />
          {{ saving ? '保存中' : dirty ? '未保存' : doc.revision ? '已保存' : '草稿' }}
        </span>
        <span v-if="flow.examplePending.value" class="workflow-example-badge">
          教学示例 · 待配置
        </span>
        <span v-if="doc.publishedRevision" class="workflow-version">
          v{{ doc.publishedRevision }}
        </span>
      </div>
      <div class="header-actions">
        <button class="quiet-button" @click="providerSettings = true">
          <Icon name="link" :size="16" />
          供应商
        </button>
        <button class="quiet-button" :disabled="busy" @click="check">
          <Icon name="check" :size="16" />
          校验
        </button>
        <button class="quiet-button" @click="drawer = drawer === 'run' ? null : 'run'">
          <Icon name="play" :size="16" />
          试运行
        </button>
        <button class="quiet-button" :disabled="busy || arranging" @click="graph.organize()">
          <Icon name="arrange" :size="16" />
          整理
        </button>
        <button class="icon-button" aria-label="发布历史" @click="history">
          <Icon name="history" :size="17" />
        </button>
        <button class="icon-button" aria-label="切换主题" @click="emit('theme')">
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
        </button>
        <button
          class="create-button"
          :disabled="busy || uploading || flow.examplePending.value"
          @click="publish"
        >
          发布
        </button>
        <i class="header-divider" />
        <button
          class="icon-button danger-button"
          :disabled="props.exitDisabled || busy || uploading || !loaded"
          title="退出 Pictoria"
          aria-label="退出 Pictoria"
          @click="emit('quit')"
        >
          <Icon name="power" :size="18" />
        </button>
      </div>
    </header>
    <Transition name="float">
      <section
        v-if="error || notice"
        class="canvas-notice"
        :class="{ 'notice-error': error }"
        data-ui
        role="status"
      >
        <span>{{ error || notice }}</span>
        <button v-if="blocked" class="text-button" @click="flow.retrySave">重试</button>
        <button v-if="blocked" class="text-button" @click="create(true)">另存副本</button>
        <button v-if="blocked" class="text-button" @click="flow.exportDraft">导出</button>
        <button
          class="icon-button"
          aria-label="关闭提示"
          @click="
            () => {
              error = ''
              notice = ''
            }
          "
        >
          <Icon name="close" :size="14" />
        </button>
      </section>
    </Transition>

    <div
      class="canvas-world"
      :style="{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }"
    >
      <svg class="canvas-connections" width="1" height="1" aria-label="工作流连线">
        <g v-for="edge in edges" :key="edge.id" :class="{ active: selectedEdge === edge.id }">
          <path
            class="edge-hit"
            :d="edge.path"
            data-ui
            @pointerdown.stop="
              () => {
                selectedEdge = edge.id
                selected = []
              }
            "
          />
          <path class="edge-stroke" :d="edge.path" />
        </g>
        <path v-if="connecting" class="edge-pending" :d="pendingPath" />
      </svg>
      <article
        v-for="kind in ['input', 'output'] as const"
        :key="kind"
        class="canvas-card workflow-node workflow-io"
        :class="{ selected: selected.includes(`__${kind}`) }"
        :data-canvas-item="`__${kind}`"
        :style="nodeStyle(`__${kind}`)"
        @pointerdown.stop="nodePointer($event, `__${kind}`)"
        @dblclick.stop="inspect(`__${kind}`)"
      >
        <header>
          <span class="draft-symbol">
            <Icon :name="kind === 'input' ? 'upload' : 'image'" :size="17" />
          </span>
          <strong>{{ kind === 'input' ? '输入' : '输出' }}</strong>
          <button class="icon-button" aria-label="配置字段" @click="inspect(`__${kind}`)">
            <Icon name="settings" :size="15" />
          </button>
        </header>
        <div
          v-if="!Object.keys(doc[`${kind}Schema`].properties || {}).length"
          class="workflow-empty-port"
        >
          <button class="text-button" @click="inspect(`__${kind}`)">
            <Icon name="plus" :size="13" />
            添加字段
          </button>
        </div>
        <div
          v-for="(field, name) in doc[`${kind}Schema`].properties"
          :key="name"
          class="workflow-port-row"
        >
          <button class="workflow-port-label" @click="inspect(`__${kind}`)">
            {{ field.title || name }}
            <small>{{ field.type }}</small>
          </button>
          <button
            v-if="kind === 'input'"
            class="workflow-port workflow-port-bottom"
            :style="graph.portStyle('__input', String(name), true)"
            :title="String(field.title || name)"
            aria-label="连接输出"
            @pointerdown.stop="graph.begin($event, '__input', String(name))"
          />
          <button
            v-else
            class="workflow-port workflow-port-top"
            :style="graph.portStyle('__output', String(name), false)"
            :class="{ linked: doc.outputs[String(name)] }"
            data-workflow-target="__output"
            :data-workflow-field="name"
            data-workflow-port="top"
            aria-label="连接输入"
            @pointerdown.stop
          />
        </div>
      </article>
      <article
        v-for="node in doc.nodes"
        :key="node.id"
        class="canvas-card workflow-node"
        :class="{
          selected: selected.includes(node.id),
          'search-current': searchCurrent === node.id,
          'search-match': matches.some((match) => match.id === node.id),
          'has-issue': issues.some((issue) => issue.nodeId === node.id),
          [`state-${stateFor(node.id)}`]: stateFor(node.id),
        }"
        :data-canvas-item="node.id"
        :style="nodeStyle(node.id)"
        @pointerdown.stop="nodePointer($event, node.id)"
        @dblclick.stop="inspect(node.id)"
      >
        <NodeAnnotation
          :text="node.comment"
          :selected="selected.includes(node.id)"
          @save="
            ($event) => {
              flow.checkpoint()
              node.comment = $event
            }
          "
        />
        <header>
          <span class="draft-symbol">
            <Icon
              :name="
                flow.stepFor(node)?.implementation?.kind === 'llm'
                  ? 'sparkle'
                  : flow.stepFor(node)?.implementation?.kind === 'workflow'
                    ? 'workflow'
                    : 'image'
              "
              :size="17"
            />
          </span>
          <strong :title="stepLabel(flow.stepFor(node))">
            {{ node.label || (flow.stepFor(node) ? stepLabel(flow.stepFor(node)) : '选择步骤') }}
          </strong>
          <span v-if="node.example && !node.stepId" class="workflow-node-state">示例</span>
          <span v-if="stateFor(node.id)" class="workflow-node-state">
            {{ statuses[stateFor(node.id) || ''] }}
          </span>
          <button
            v-if="flow.stepFor(node)?.implementation?.kind !== 'workflow'"
            class="icon-button"
            title="配置 API"
            aria-label="配置节点 API"
            @click.stop="configureApi(node.id)"
          >
            <Icon name="link" :size="15" />
          </button>
          <button class="icon-button" aria-label="节点设置" @click="inspect(node.id)">
            <Icon name="more" :size="16" />
          </button>
        </header>
        <div class="workflow-ports">
          <div class="workflow-inputs">
            <div
              v-for="[name, field] in portFields(node, false)"
              :key="name"
              class="workflow-port-row"
              :class="{
                'field-issue': issues.some(
                  (issue) => issue.nodeId === node.id && issue.field === name,
                ),
              }"
            >
              <button
                class="workflow-port workflow-port-in"
                :class="{ linked: node.inputs[name] }"
                :data-workflow-target="node.id"
                :data-workflow-field="name"
                data-workflow-port="left"
                :aria-label="`${field.title || name}输入`"
                @pointerdown.stop
              />
              <button
                class="workflow-port-label"
                :title="bindingLabel(node.inputs[name])"
                @click="inspect(node.id)"
              >
                <span>
                  {{ field.title || name }}
                  <i v-if="flow.stepFor(node)?.inputSchema.required?.includes(name)">*</i>
                </span>
                <small>
                  {{ node.inputs[name] ? bindingLabel(node.inputs[name]) : field.type }}
                </small>
              </button>
              <button
                class="workflow-port workflow-port-top"
                :title="String(field.title || name)"
                :style="graph.portStyle(node.id, name, false)"
                :data-workflow-target="node.id"
                :data-workflow-field="name"
                data-workflow-port="top"
                aria-label="从上方连接"
                @pointerdown.stop
              />
            </div>
          </div>
          <div class="workflow-outputs">
            <div
              v-for="[name, field] in portFields(node, true)"
              :key="name"
              class="workflow-port-row"
            >
              <button class="workflow-port-label" @click="inspect(node.id)">
                <span>{{ field.title || name }}</span>
                <small>{{ field.type }}</small>
              </button>
              <button
                class="workflow-port workflow-port-out"
                :aria-label="`${field.title || name}输出`"
                @pointerdown.stop="graph.begin($event, node.id, name, 'right')"
              />
              <button
                class="workflow-port workflow-port-bottom"
                :title="String(field.title || name)"
                :style="graph.portStyle(node.id, name, true)"
                aria-label="从下方连接"
                @pointerdown.stop="graph.begin($event, node.id, name, 'bottom')"
              />
            </div>
          </div>
        </div>
      </article>
      <TransitionGroup name="workflow-note">
        <div
          v-for="note in doc.notes"
          :key="note.id"
          class="workflow-note-item"
          :class="{
            selected: selected.includes('__note:' + note.id),
            'search-current': searchCurrent === '__note:' + note.id,
          }"
          :data-canvas-item="'__note:' + note.id"
          :style="nodeStyle('__note:' + note.id)"
          @pointerdown.stop="nodePointer($event, '__note:' + note.id)"
        >
          <NoteCard
            :title="note.title"
            :text="note.text"
            :selected="selected.includes('__note:' + note.id)"
            @save="
              ($event) => {
                flow.checkpoint()
                note.title = $event.title
                note.text = $event.text
              }
            "
            @remove="
              () => {
                flow.checkpoint()
                doc.notes = doc.notes.filter((item) => item.id !== note.id)
                selected = selected.filter((id) => id !== '__note:' + note.id)
              }
            "
          />
        </div>
      </TransitionGroup>
      <div
        v-if="marquee"
        class="selection-marquee"
        :style="{
          width: `${marquee.width}px`,
          height: `${marquee.height}px`,
          transform: `translate(${marquee.x}px, ${marquee.y}px)`,
        }"
      />
    </div>
    <CanvasGuides :guides="guides" :viewport="viewport" />

    <nav class="canvas-toolrail floating-panel" data-ui aria-label="工作流工具">
      <button
        class="icon-button"
        :class="{ active: tool === 'free' }"
        title="自由操作 · A；拖动时 Alt 暂停吸附，Ctrl 对齐网格"
        aria-label="自由操作"
        @click="tool = 'free'"
      >
        <Icon name="arrow" />
      </button>
      <button
        class="icon-button"
        :class="{ active: tool === 'select' }"
        title="框选 · V / Shift＋左键"
        aria-label="框选"
        @click="tool = 'select'"
      >
        <Icon name="select" />
      </button>
      <button
        class="icon-button"
        :class="{ active: tool === 'hand' }"
        title="拖动画布 · H / 空格 / 中键"
        aria-label="拖动画布"
        @click="tool = 'hand'"
      >
        <Icon name="hand" />
      </button>
      <span class="rail-divider" />
      <button
        class="icon-button"
        :class="{ active: palette }"
        aria-label="节点目录"
        @click="palette = !palette"
      >
        <Icon name="plus" :size="22" />
      </button>
      <button class="icon-button" aria-label="添加备注" title="备注 · N" @click="addNote">
        <Icon name="note" :size="18" />
      </button>
      <button
        class="icon-button"
        :class="{ active: searchOpen }"
        aria-label="搜索节点"
        title="搜索 · Ctrl F"
        @click="searchOpen = !searchOpen"
      >
        <Icon name="search" :size="18" />
      </button>
      <span class="rail-divider" />
      <button
        class="icon-button"
        title="复制 · Ctrl C"
        aria-label="复制节点"
        :disabled="!selected.length"
        @click="clipboard.copy"
      >
        <Icon name="copy" :size="18" />
      </button>
      <button
        class="icon-button"
        title="粘贴 · Ctrl V"
        aria-label="粘贴节点"
        @click="clipboard.paste"
      >
        <Icon name="paste" :size="18" />
      </button>
      <button
        class="icon-button"
        :disabled="!flow.history.value.length"
        aria-label="撤销"
        @click="
          () => {
            graph.finishArrangement()
            flow.undo()
          }
        "
      >
        <Icon name="undo" :size="18" />
      </button>
      <button
        class="icon-button"
        :disabled="!flow.future.value.length"
        aria-label="重做"
        @click="
          () => {
            graph.finishArrangement()
            flow.redo()
          }
        "
      >
        <Icon name="redo" :size="18" />
      </button>
    </nav>
    <Transition name="float">
      <section v-if="palette" class="workflow-palette floating-panel" data-ui>
        <header>
          <strong>节点</strong>
          <button class="icon-button" aria-label="关闭目录" @click="palette = false">
            <Icon name="close" :size="15" />
          </button>
        </header>
        <div class="workflow-filter">
          <Icon name="search" :size="14" />
          <input v-model="paletteQuery" placeholder="搜索步骤" />
        </div>
        <div class="workflow-step-list">
          <button
            v-for="step in catalogue"
            :key="step.id"
            class="workflow-step-option"
            :disabled="!step.available || busy"
            @click="add(step)"
          >
            <span class="workflow-step-icon">
              <Icon
                :name="
                  step.implementation?.kind === 'llm'
                    ? 'sparkle'
                    : step.implementation?.kind === 'workflow'
                      ? 'workflow'
                      : step.outputSchema?.properties?.videos
                        ? 'play'
                        : 'image'
                "
                :size="17"
              />
            </span>
            <span>{{ stepLabel(step) }}</span>
            <Icon name="plus" :size="14" />
          </button>
          <small v-if="!catalogue.length" class="workflow-muted">暂无步骤</small>
        </div>
        <div class="workflow-new-step-actions">
          <button class="quiet-button" @click="settings(undefined, '', true)">
            <Icon name="plus" :size="14" />
            API 步骤
          </button>
          <button class="quiet-button" @click="settings(undefined, '', true, false, true)">
            <Icon name="play" :size="14" />
            视频 API
          </button>
          <button class="quiet-button" @click="settings(undefined, '', true, true)">
            <Icon name="sparkle" :size="14" />
            LLM API
          </button>
        </div>
      </section>
    </Transition>
    <Transition name="float">
      <section
        v-if="searchOpen"
        class="canvas-search-panel floating-panel"
        data-ui
        @keydown.esc.stop="
          () => {
            searchOpen = false
            searchQuery = ''
            searchCurrent = ''
          }
        "
      >
        <div class="canvas-search-field">
          <Icon name="search" :size="14" />
          <input
            v-model="searchQuery"
            class="canvas-search-input"
            maxlength="200"
            placeholder="备注 / 提示词"
            @keydown.enter.prevent.stop="jump($event.shiftKey ? -1 : 1)"
          />
          <button
            class="icon-button"
            aria-label="关闭搜索"
            @click="
              () => {
                searchOpen = false
                searchQuery = ''
                searchCurrent = ''
              }
            "
          >
            <Icon name="close" :size="14" />
          </button>
        </div>
        <footer v-if="searchQuery">
          <small>{{ matches.length ? `${searchPosition} / ${matches.length}` : '无匹配' }}</small>
          <button
            class="icon-button"
            :disabled="!matches.length"
            aria-label="上一个"
            @click="jump(-1)"
          >
            <Icon class="search-previous" name="down" :size="14" />
          </button>
          <button
            class="icon-button"
            :disabled="!matches.length"
            aria-label="下一个"
            @click="jump(1)"
          >
            <Icon name="down" :size="14" />
          </button>
        </footer>
      </section>
    </Transition>
    <Transition name="float">
      <div v-if="selectedEdge" class="connection-actions floating-panel" data-ui>
        <Icon name="link" :size="15" />
        <button class="text-button" @click="graph.disconnect()">断开</button>
        <button class="icon-button" aria-label="取消选择" @click="selectedEdge = ''">
          <Icon name="close" :size="14" />
        </button>
      </div>
    </Transition>

    <aside class="workflow-inspector floating-panel" data-ui>
      <header>
        <div class="workflow-inspector-tabs">
          <button
            :class="{ active: panel === 'node' }"
            :disabled="!selectedNode"
            @click="panel = 'node'"
          >
            节点
          </button>
          <button :class="{ active: panel === 'interface' }" @click="panel = 'interface'">
            接口
          </button>
          <button :class="{ active: panel === 'tutorial' }" @click="panel = 'tutorial'">
            教程
          </button>
        </div>
      </header>
      <div v-if="panel === 'node' && selectedNode" class="workflow-inspector-body">
        <label class="panel-field">
          名称
          <input
            v-model="selectedNode.label"
            :placeholder="selectedStep?.name"
            maxlength="100"
            @focus="flow.checkpoint"
          />
        </label>
        <div class="panel-field">
          <span>步骤</span>
          <PictoriaSelect
            :model-value="selectedNode.stepId"
            :options="
              steps
                .filter((step) => step.id !== doc.id)
                .map((step) => ({
                  value: step.id,
                  label: stepLabel(step),
                  disabled: !step.available,
                }))
            "
            @update:model-value="chooseStep"
          />
        </div>
        <p v-if="selectedNode.example && !selectedNode.stepId" class="workflow-muted">
          示例步骤 · 待配置
        </p>
        <div class="workflow-node-tools">
          <button
            v-if="selectedStep?.implementation?.kind !== 'workflow'"
            class="text-button"
            @click="configureApi(selectedNode.id)"
          >
            配置 API
          </button>
          <button
            v-if="
              selectedStep &&
              selectedStep.implementation?.kind !== 'workflow' &&
              !selectedStep.id.startsWith('builtin.')
            "
            class="text-button"
            @click="settings(selectedStep, selectedNode.id)"
          >
            配置步骤
          </button>
          <button
            v-if="
              steps.some(
                (step) =>
                  step.id === selectedNode?.stepId && step.revision !== selectedNode?.stepRevision,
              )
            "
            class="text-button"
            @click="updateStep"
          >
            更新版本
          </button>
          <button class="text-button danger-button" @click="flow.removeSelection">删除节点</button>
        </div>
        <label class="panel-field">
          备注
          <textarea
            v-model="selectedNode.comment"
            rows="2"
            maxlength="2000"
            @focus="flow.checkpoint"
          />
        </label>
        <section
          v-for="(field, name) in selectedStep?.inputSchema.properties"
          :key="`${selectedNode.id}:${name}`"
          class="workflow-parameter"
          @focusin="flow.checkpoint"
        >
          <header>
            <strong>{{ field.title || name }}</strong>
            <small v-if="selectedStep?.inputSchema.required?.includes(String(name))">*</small>
          </header>
          <WorkflowBinding
            :model-value="selectedNode.inputs[String(name)]"
            :schema="field"
            :store="flow"
            :exclude="selectedNode.id"
            :assets="assets"
            @update:model-value="setBinding(String(name), $event)"
            @upload="chooseUpload('node', String(name))"
          />
          <p
            v-for="issue in issues.filter(
              (issue) => issue.nodeId === selectedNode?.id && issue.field === name,
            )"
            :key="issue.code"
            class="workflow-field-error"
          >
            {{ issue.message }}
          </p>
        </section>
        <div v-if="stateFor(selectedNode.id)" class="workflow-node-runtime">
          <strong>{{ statuses[stateFor(selectedNode.id) || ''] }}</strong>
          <template
            v-for="node in run?.nodes.filter(
              (node) => node.id === selectedNode?.id || node.id.startsWith(`${selectedNode?.id}/`),
            )"
            :key="node.id"
          >
            <small class="workflow-muted">{{ elapsed(node) }}</small>
            <p v-if="node.error" class="workflow-field-error">{{ node.error }}</p>
            <details v-if="node.inputs">
              <summary>输入</summary>
              <pre>{{ JSON.stringify(resolvedInputs(node), null, 2) }}</pre>
            </details>
            <details v-if="node.outputs">
              <summary>输出</summary>
              <pre>{{ JSON.stringify(node.outputs, null, 2) }}</pre>
            </details>
          </template>
        </div>
      </div>
      <div v-else-if="panel === 'interface'" class="workflow-inspector-body">
        <div class="workflow-interface-tabs">
          <button :class="{ active: interfaceTab === 'input' }" @click="interfaceTab = 'input'">
            输入
          </button>
          <button :class="{ active: interfaceTab === 'output' }" @click="interfaceTab = 'output'">
            输出
          </button>
          <button
            :class="{ active: interfaceTab === 'settings' }"
            @click="interfaceTab = 'settings'"
          >
            设置
          </button>
        </div>
        <WorkflowFields
          v-if="interfaceTab === 'input'"
          v-model="doc.inputSchema"
          @checkpoint="flow.checkpoint"
          @remove="removeInput"
        />
        <template v-else-if="interfaceTab === 'output'">
          <WorkflowFields
            v-model="doc.outputSchema"
            @checkpoint="flow.checkpoint"
            @remove="delete doc.outputs[$event]"
          />
          <section
            v-for="(field, name) in doc.outputSchema.properties"
            :key="name"
            class="workflow-parameter"
            @focusin="flow.checkpoint"
          >
            <header>
              <strong>{{ field.title || name }}</strong>
            </header>
            <WorkflowBinding
              :model-value="doc.outputs[String(name)]"
              :schema="field"
              :store="flow"
              :assets="assets"
              @update:model-value="setBinding(String(name), $event, true)"
              @upload="chooseUpload('output', String(name))"
            />
          </section>
        </template>
        <template v-else>
          <label class="panel-field">
            名称
            <input v-model="doc.name" maxlength="100" @focus="flow.checkpoint" />
          </label>
          <label class="panel-field">
            输入说明
            <textarea
              v-model="doc.usageDescription"
              rows="5"
              maxlength="16000"
              @focus="flow.checkpoint"
            />
          </label>
          <button class="quiet-button outlined" :disabled="busy" @click="importInput?.click()">
            <Icon name="upload" :size="15" />
            导入
          </button>
          <button class="quiet-button outlined" @click="flow.exportDraft">
            <Icon name="download" :size="15" />
            导出
          </button>
        </template>
      </div>
      <div v-else class="workflow-inspector-body workflow-tutorial">
        <button
          class="quiet-button outlined workflow-example-button"
          :disabled="busy || saving"
          @click="createExample"
        >
          <Icon name="workflow" :size="16" />
          创建示例工作流
        </button>
        <h3>从输入到输出</h3>
        <p>
          先添加输入字段，再把步骤放进画布。拖动输出圆点，连接下一个节点的输入。点选节点，在右侧填写参数。
        </p>
        <h3>多份参考</h3>
        <p>
          数组字段可以连接多个来源。选择“多项”后可调整顺序；开启“展开数组”，可以把整组图片与单张图片合并。选取路径
          <code>0</code>
          表示第一项，
          <code>0/image</code>
          表示第一项中的 image 字段。
        </p>
        <h3>发布成步骤</h3>
        <p>
          设置输出字段并连接最终结果。输入说明用于告诉 Agent 该怎么填写提示词：自然语言、正反 tags
          或其他要求都由作者声明，系统按原样传递。
        </p>
        <h3>运行与恢复</h3>
        <p>
          试运行会真实调用已配置的服务，可能计费。API 节点直接调用已配置服务，LLM API
          也可独立使用。infOS LLM
          需要挂载宿主并授权。断网后后台保留任务；提交结果不明时，先核验供应商任务 ID，再继续恢复。
        </p>
        <h3>画布操作</h3>
        <p>
          空白处左拖平移；空格、中键和手形模式可在节点上平移视野。Shift＋左键拖动追加框选，V
          框选，Shift 单击多选，Ctrl+C 复制，Ctrl+V 粘贴，Ctrl+D 原地创建副本，Ctrl+Z 撤销，Ctrl+F
          搜索。复制节点时会包含附属备注和内部连线；跨工作流粘贴时，未选中的外部连线会断开。输入、输出接口保持唯一。
        </p>
      </div>
    </aside>

    <Transition name="float">
      <section v-if="picker" class="workflow-picker floating-panel" data-ui>
        <header>
          <strong>工作流</strong>
          <button
            class="icon-button"
            aria-label="关闭"
            @click="
              () => {
                picker = false
                deletion = false
              }
            "
          >
            <Icon name="close" :size="15" />
          </button>
        </header>
        <button
          v-for="item in list"
          :key="item.id"
          class="workflow-list-row"
          :class="{ active: item.id === doc.id }"
          :disabled="busy || saving"
          @click="open(item.id)"
        >
          <Icon name="workflow" :size="16" />
          <span>{{ item.name }}</span>
          <small v-if="item.publishedRevision">v{{ item.publishedRevision }}</small>
        </button>
        <footer>
          <button class="quiet-button" :disabled="busy || saving" @click="create()">
            <Icon name="plus" :size="15" />
            新建
          </button>
          <button class="text-button" :disabled="busy || saving" @click="createExample">
            创建示例
          </button>
          <button class="text-button" :disabled="busy" @click="create(true)">副本</button>
          <button class="text-button danger-button" :disabled="busy" @click="deletion = !deletion">
            删除
          </button>
        </footer>
        <div v-if="deletion" class="workflow-delete-confirm">
          <span>删除此工作流？</span>
          <button class="text-button" @click="deletion = false">取消</button>
          <button class="text-button danger-button" :disabled="busy" @click="removeFlow">
            删除
          </button>
        </div>
      </section>
    </Transition>
    <Transition name="float">
      <section v-if="drawer" class="workflow-drawer floating-panel" data-ui>
        <header>
          <strong>
            {{ drawer === 'run' ? '试运行' : drawer === 'history' ? '发布历史' : '校验' }}
          </strong>
          <span
            v-if="drawer === 'run' && run"
            class="workflow-run-badge"
            :class="`state-${run.state}`"
          >
            {{ statuses[run.state] || run.state }}
          </span>
          <small v-if="drawer === 'run' && flow.runStale.value" class="workflow-muted">
            旧结果
          </small>
          <button class="icon-button" aria-label="收起" @click="drawer = null">
            <Icon name="close" :size="15" />
          </button>
        </header>
        <div class="workflow-drawer-body">
          <template v-if="drawer === 'run'">
            <div class="workflow-test-inputs">
              <label
                v-for="(field, name) in doc.inputSchema.properties"
                :key="name"
                class="panel-field"
              >
                {{ field.title || name }}
                <WorkflowValue
                  :owner="owner"
                  :aspect-ratio="
                    String(
                      testInputs.aspect_ratio ??
                        doc.inputSchema.properties?.aspect_ratio?.default ??
                        '',
                    )
                  "
                  :model-value="testInputs[String(name)]"
                  :schema="field"
                  :assets="assets"
                  @update:model-value="testInputs[String(name)] = $event"
                  @upload="chooseUpload('test', String(name))"
                />
              </label>
              <p v-if="flow.examplePending.value" class="workflow-muted">示例步骤未配置</p>
              <div class="workflow-run-actions">
                <button
                  class="create-button"
                  :disabled="
                    busy ||
                    uploading ||
                    flow.examplePending.value ||
                    !!(run && ['queued', 'running', 'waiting'].includes(run.state))
                  "
                  @click="flow.action('run', testInputs)"
                >
                  <Icon name="play" :size="14" />
                  {{ busy ? '提交中' : '运行' }}
                </button>
                <button
                  v-if="run && ['queued', 'running', 'waiting'].includes(run.state)"
                  class="text-button"
                  @click="
                    pictoria
                      .operation(owner, 'task.cancel', { id: run.id })
                      .catch((failure) => (error = failure.message))
                  "
                >
                  停止
                </button>
                <button
                  v-if="run && ['waiting', 'failed', 'partial'].includes(run.state)"
                  class="text-button"
                  @click="recovery = true"
                >
                  恢复任务
                </button>
              </div>
            </div>
            <div v-if="run" class="workflow-run-results">
              <p v-if="run.error" class="workflow-field-error">{{ run.error }}</p>
              <button
                v-for="node in run.nodes"
                :key="node.id"
                class="workflow-run-row"
                @click="focusNode(node.id.split('/')[0]!)"
              >
                <span>{{ node.step?.name || node.id }}</span>
                <small>{{ elapsed(node) }}</small>
                <small :class="`state-${node.state}`">
                  {{ statuses[node.state] || node.state }}
                </small>
              </button>
              <div v-if="resultAssets.length" class="workflow-result-assets">
                <div v-for="id in resultAssets" :key="id" class="workflow-result-asset">
                  <img
                    v-if="
                      props.canvas.urls[id] &&
                      assets.find((asset) => asset.id === id)?.mimeType.startsWith('image/')
                    "
                    :src="props.canvas.urls[id]"
                    :alt="assets.find((asset) => asset.id === id)?.name || '作品'"
                  />
                  <video
                    v-else-if="
                      props.canvas.urls[id] &&
                      assets.find((asset) => asset.id === id)?.mimeType.startsWith('video/')
                    "
                    :src="props.canvas.urls[id]"
                    controls
                    preload="metadata"
                  />
                  <audio
                    v-else-if="
                      props.canvas.urls[id] &&
                      assets.find((asset) => asset.id === id)?.mimeType.startsWith('audio/')
                    "
                    :src="props.canvas.urls[id]"
                    controls
                    preload="metadata"
                  />
                  <Icon v-else name="image" :size="22" />
                  <span>{{ assets.find((asset) => asset.id === id)?.name || '作品' }}</span>
                  <a
                    v-if="props.canvas.urls[id]"
                    :href="props.canvas.urls[id]"
                    :download="assets.find((asset) => asset.id === id)?.name || '作品'"
                    @click.stop
                  >
                    <Icon name="download" :size="14" />
                  </a>
                  <button
                    class="icon-button"
                    title="加入画布"
                    aria-label="加入画布"
                    @click="addResult(id)"
                  >
                    <Icon name="plus" :size="14" />
                  </button>
                </div>
              </div>
              <details v-if="run.result">
                <summary>结果</summary>
                <pre>{{ JSON.stringify(run.result, null, 2) }}</pre>
              </details>
            </div>
          </template>
          <template v-else-if="drawer === 'issues'">
            <button
              v-for="(issue, index) in issues"
              :key="index"
              class="workflow-issue-row"
              @click="focusIssue(issue)"
            >
              <Icon name="warning" :size="15" />
              <span>
                {{
                  [
                    issue.nodeId
                      ? doc.nodes.find((node) => node.id === issue.nodeId)?.label ||
                        flow.stepFor(doc.nodes.find((node) => node.id === issue.nodeId)!)?.name
                      : '',
                    issue.field,
                    issue.message,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
            </button>
            <span v-if="!issues.length" class="workflow-muted">
              {{ notice === '校验通过' ? '校验通过' : '点击校验' }}
            </span>
          </template>
          <template v-else>
            <button
              v-for="release in releases"
              :key="release.revision"
              class="workflow-release-row"
              :disabled="busy"
              @click="restoreRelease(release.revision)"
            >
              <span>v{{ release.revision }}</span>
              <small>
                {{
                  release.createdAt ? new Date(release.createdAt).toLocaleString() : release.name
                }}
              </small>
              <span>恢复草稿</span>
            </button>
            <span v-if="!releases.length" class="workflow-muted">暂无发布</span>
          </template>
        </div>
      </section>
    </Transition>
    <div class="canvas-bottom-left" data-ui>
      <button class="text-button" @click="panel = 'tutorial'">教程</button>
      <small>{{ doc.nodes.length }} 个节点</small>
    </div>
    <div class="canvas-zoom floating-panel" data-ui>
      <button class="icon-button" aria-label="缩小" @click="navigation.zoom(viewport.scale / 1.2)">
        <Icon name="minus" :size="15" />
      </button>
      <button class="zoom-percent" @click="navigation.zoom(1)">
        {{ Math.round(viewport.scale * 100) }}%
      </button>
      <button class="icon-button" aria-label="放大" @click="navigation.zoom(viewport.scale * 1.2)">
        <Icon name="plus" :size="15" />
      </button>
      <i class="header-divider" />
      <button class="icon-button" aria-label="适应画布" @click="navigation.fit()">
        <Icon name="fit" :size="17" />
      </button>
    </div>
    <Transition name="fade">
      <WorkflowStepSettings
        v-if="stepSettings"
        :owner="owner"
        :step="editedStep"
        :api="apiMode"
        :node="!!editedNode"
        :llm-api="llmApiMode"
        :video-api="videoApiMode"
        @close="stepSettings = false"
        @saved="stepSaved"
      />
    </Transition>
    <Transition name="fade">
      <TaskRecovery
        v-if="recovery && run"
        :store="canvas"
        :run-id="run.id"
        @close="recovery = false"
      />
    </Transition>
    <Transition name="fade">
      <ProviderDialog
        v-if="providerSettings"
        :agent-id="owner"
        :online="loaded"
        @close="providerSettings = false"
        @updated="flow.refreshSteps().catch((failure) => (error = failure.message))"
      />
    </Transition>
    <div v-if="!loaded" class="workflow-loading" data-ui>
      <span>{{ error || '连接中…' }}</span>
      <button v-if="error" class="create-button" :disabled="busy" @click="flow.connect">
        重试
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      class="visually-hidden"
      accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
      multiple
      @change="upload"
    />
    <input
      ref="importInput"
      type="file"
      class="visually-hidden"
      accept="application/json,.json"
      @change="imported"
    />
  </main>
</template>
