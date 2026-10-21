<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { DocumentNodeId, DocumentSnapshot, JsonValue } from '@infos/document-engine'
import {
  formatRuns,
  officeChildren,
  OFFICE_TEXT_TYPES,
  reorderChildren,
  runsOf,
  setNodeRuns,
  sliceRuns,
  normalizeRuns,
  type OfficeContent,
  type OfficeEditResult,
  type OfficeMarks,
  type OfficeNode,
  type OfficeRun,
  type OfficeSelection,
} from '@infos/document-engine/office'
import {
  editOfficeTable,
  officeTableGrid,
  type OfficeTableAction,
} from '@infos/document-engine/officeTable'
import { OfficeSession } from '../services/officeSession'
import { focusOfficeNode, pointOffset, restoreOfficeSelection } from '../services/officeDom'
import { useWorkbenchStore } from '../stores/workbench'
import OfficeBlock from './OfficeBlock.vue'
import ArcaIcon from './ArcaIcon.vue'
import ArcaDialog from './ArcaDialog.vue'
import ArcaSelect from './ArcaSelect.vue'
import { DocumentDraftStore } from '../services/draftStore'

const props = defineProps<{
  snapshot: DocumentSnapshot
  writable: boolean
  mode: 'create' | 'read' | 'review'
  toolbarTarget?: HTMLElement
}>()
const emit = defineEmits<{
  selection: [selection: OfficeSelection | undefined]
  collaborate: [id?: string]
  comment: [id: string]
  copy: [id: string]
  exportProject: []
  importProject: []
  inspect: [panel: 'activity' | 'review' | 'comments' | 'revisions' | 'properties' | 'outline']
  rename: []
}>()
const store = useWorkbenchStore(),
  session = shallowRef<OfficeSession>(),
  version = ref(0),
  activeId = ref(''),
  selection = ref<OfficeSelection>()
const ribbon = ref<'home' | 'insert' | 'layout' | 'review'>('home')
const ribbonTabs = [
  {
    id: 'home',
    get label() {
      return __t('apps.arca.ui', '开始')
    },
  },
  {
    id: 'insert',
    get label() {
      return __t('apps.arca.ui', '插入')
    },
  },
  {
    id: 'layout',
    get label() {
      return __t('apps.arca.ui', '页面')
    },
  },
  {
    id: 'review',
    get label() {
      return __t('apps.arca.ui', '审阅')
    },
  },
] as const
const paragraphOptions: Array<{ value: number | 'paragraph' | 'quote'; label: string }> = [
  {
    value: 'paragraph',
    get label() {
      return __t('apps.arca.ui', '正文')
    },
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    value: index + 1,
    label: __t('apps.arca.ui', '标题 ') + (index + 1),
  })),
  {
    value: 'quote',
    get label() {
      return __t('apps.arca.ui', '引用')
    },
  },
]
const fontOptions = [
  {
    value: 'system-ui',
    get label() {
      return __t('apps.arca.ui', '系统字体')
    },
  },
  {
    value: 'Microsoft YaHei',
    get label() {
      return __t('apps.arca.ui', '微软雅黑')
    },
  },
  {
    value: 'SimSun',
    get label() {
      return __t('apps.arca.ui', '宋体')
    },
  },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
].map((option) => ({ ...option, fontFamily: option.value }))
function changeParagraph(value: string | number | null) {
  if (value === 'quote') paragraph('quote')
  else paragraph(value === 'paragraph' ? 'paragraph' : 'heading', { level: Number(value) || 1 })
}
const viewMode = ref<'page' | 'continuous'>(
  localStorage.getItem('arca-document-view') === 'continuous' ? 'continuous' : 'page',
)
const zoom = ref(100),
  findOpen = ref(false),
  findInput = ref<HTMLInputElement>()
const linkOpen = ref(false),
  linkValue = ref(''),
  linkError = ref(''),
  reloadOpen = ref(false)
const selectionPosition = ref<{ left: string; top: string }>()
const editorElement = ref<HTMLElement>()
const paperElement = ref<HTMLElement>()
const paperWidth = ref(794)
let paperObserver: ResizeObserver | undefined
const composing = ref(false),
  message = ref(''),
  assets = ref<Record<string, string>>({}),
  fileInput = ref<HTMLInputElement>()
const fontSize = ref(12),
  color = ref('#171923'),
  pageSize = ref('A4'),
  margin = ref(20)
const fontFamily = ref('system-ui'),
  highlight = ref('#fff3a3'),
  header = ref(''),
  footer = ref('')
const orientation = ref('portrait'),
  pageNumbers = ref(true),
  previewFrame = ref<HTMLIFrameElement>(),
  previewReady = ref(false)
const referenceOpen = ref(false),
  referenceTitle = ref(''),
  referenceUrl = ref(''),
  referenceNote = ref('')
const previewHtml = ref(''),
  legacyStore = new DocumentDraftStore()
const findText = ref(''),
  replacementText = ref(''),
  searchIndex = ref(0)
let copyRequest: { key: string; content: string } | undefined
const renderEpoch = ref(0)
const uploads = ref(0),
  compositionWaiters: Array<() => void> = []
const typing = ref<{ nodeId: string; offset: number; marks: OfficeMarks }>()
let compositionSelection: OfficeSelection | undefined,
  rebuildingComposition = false
const assetLoads = new Set<string>(),
  objectUrls = new Set<string>()
let disposed = false
const content = computed(() => {
  void version.value
  return session.value!.content
})
const root = computed(() => content.value.nodes.find((node) => node.type === 'document-root')!)
const editable = computed(
  () =>
    props.writable &&
    !store.applicationStopping &&
    !store.applicationStopped &&
    props.mode === 'create' &&
    (root.value.attributes.officeSchemaVersion === undefined ||
      root.value.attributes.officeSchemaVersion === 1),
)
const selected = computed(() => content.value.nodes.find((node) => node.nodeId === activeId.value))
const currentMarks = computed(() => {
  void version.value
  if (typing.value) return typing.value.marks
  const point = selection.value?.focus,
    node = session.value?.content.nodes.find((item) => item.nodeId === point?.nodeId)
  return node && point
    ? (sliceRuns(runsOf(node), Math.max(0, point.offset - 1), Math.max(1, point.offset))[0]
        ?.marks ?? {})
    : {}
})
watch(
  [currentMarks, () => store.resolvedTheme],
  ([marks]) => {
    fontSize.value = marks.fontSize ?? 12
    fontFamily.value = marks.fontFamily ?? 'system-ui'
    color.value =
      marks.color ??
      (getComputedStyle(document.documentElement).getPropertyValue('--arca-text').trim() ||
        '#322f2b')
    highlight.value = marks.highlight ?? '#fff3a3'
  },
  { immediate: true },
)
const cell = computed(() => (selected.value?.type === 'table-cell' ? selected.value : undefined))
const selectedColumnWidth = computed(() => {
  const row = content.value.nodes.find((node) => node.nodeId === cell.value?.parentId),
    table = content.value.nodes.find((node) => node.nodeId === row?.parentId)
  if (!table || table.type !== 'table') return 120
  try {
    const position = officeTableGrid(content.value, table.nodeId).positions.find(
      (position) => position.node.nodeId === cell.value?.nodeId,
    )
    return position && Array.isArray(table.attributes.columnWidths)
      ? Number(table.attributes.columnWidths[position.column]) || 120
      : 120
  } catch {
    return 120
  }
})
const pageStyle = computed(() => ({
  maxWidth:
    viewMode.value === 'continuous'
      ? `${localStorage.getItem('arca-editor-width') ?? '840'}px`
      : root.value.attributes.paperOrientation === 'landscape'
        ? '1123px'
        : root.value.attributes.paperSize === 'Letter'
          ? '816px'
          : '794px',
  padding:
    viewMode.value === 'continuous'
      ? '40px 48px'
      : `${Math.max(5, Math.min(50, Number(root.value.attributes.pageMargin) || 20))}mm`,
  fontSize: '12pt',
}))
const pageInset = computed(() =>
  viewMode.value === 'continuous'
    ? 48
    : (Math.max(5, Math.min(50, Number(root.value.attributes.pageMargin) || 20)) * 96) / 25.4,
)
const rulerNumbers = computed(() =>
  Array.from(
    { length: Math.max(1, Math.floor((paperWidth.value - pageInset.value * 2) / (96 / 2.54)) + 1) },
    (_, index) => index,
  ),
)
const firstBlock = computed(() => officeChildren(content.value, root.value.nodeId)[0])
const hasDocumentTitle = computed(
  () =>
    firstBlock.value?.type === 'heading' &&
    firstBlock.value.text?.trim() === content.value.title.trim(),
)
const references = computed(() => {
  const references = root.value.attributes.references
  if (!Array.isArray(references)) return []
  return references.flatMap((reference) => {
    if (
      !reference ||
      typeof reference !== 'object' ||
      Array.isArray(reference) ||
      typeof reference.id !== 'string' ||
      typeof reference.title !== 'string'
    )
      return []
    return [
      {
        id: reference.id,
        title: reference.title,
        ...(typeof reference.url === 'string' ? { url: reference.url } : {}),
        ...(typeof reference.note === 'string' ? { note: reference.note } : {}),
        ...(typeof reference.number === 'number' &&
        Number.isInteger(reference.number) &&
        reference.number > 0
          ? { number: reference.number }
          : {}),
      },
    ]
  })
})
const headings = computed(() =>
  orderedText(content.value).filter((node) => node.type === 'heading'),
)

function bind(snapshot: DocumentSnapshot): void {
  typing.value = undefined
  session.value?.detach()
  const documentId = snapshot.documentId
  const current = new OfficeSession(
    snapshot,
    store.endpoint ?? '',
    async (request) => {
      if (!store.transport || !store.session) throw new Error('Arca 未连接，草稿已保留')
      return (await store.transport.invoke(
        'document.apply_edit',
        { ...request, surfaceSessionToken: store.session.token },
        { idempotencyKey: request.transactionId },
      )) as OfficeEditResult
    },
    () => {
      if (disposed || store.activeDocumentId !== documentId) return
      version.value++
      store.officeDirty = current.hasChanges || uploads.value > 0 || composing.value
      store.officeCharacterCount = current.content.nodes.reduce(
        (count, node) => count + [...(node.text ?? String(node.attributes.text ?? ''))].length,
        0,
      )
      store.editState = current.state
    },
    (snapshot) => {
      if (disposed || store.activeDocumentId !== documentId || !store.activeDocument) return
      store.activeDocument.snapshot = snapshot
      const ordered: typeof snapshot.nodes = []
      const visit = (id: string) => {
        for (const node of officeChildren(
          { title: snapshot.document.title, nodes: snapshot.nodes },
          id,
        )) {
          ordered.push(node as (typeof snapshot.nodes)[number])
          visit(node.nodeId)
        }
      }
      visit(snapshot.document.rootNodeId)
      const outline = ordered
        .filter((node) => node.type === 'heading')
        .map((node) => ({
          nodeId: node.nodeId,
          type: 'heading' as const,
          text: node.text ?? '',
          level: Number(node.attributes.level ?? 1),
          children: [],
        }))
      store.activeDocument.outline.content = outline
      const index = store.documents.findIndex((item) => item.documentId === snapshot.documentId)
      if (index >= 0) store.documents[index] = snapshot.document
      void store.loadRevisions().catch(() => {})
    },
  )
  session.value = current
  version.value++
  store.officeDirty = current.hasChanges
  store.officeCharacterCount = current.content.nodes.reduce(
    (count, node) => count + [...(node.text ?? String(node.attributes.text ?? ''))].length,
    0,
  )
  const settings =
    current.content.nodes.find((node) => node.type === 'document-root')?.attributes ?? {}
  pageSize.value = settings.paperSize === 'Letter' ? 'Letter' : 'A4'
  margin.value = Number(settings.pageMargin) || 20
  header.value = String(settings.header ?? '')
  footer.value = String(settings.footer ?? '')
  orientation.value = settings.paperOrientation === 'landscape' ? 'landscape' : 'portrait'
  pageNumbers.value = settings.pageNumbers === true
  const legacy = legacyStore.list(snapshot.documentId)
  if (
    legacy.length &&
    !current.hasChanges &&
    legacy.every(
      (draft) =>
        draft.baseRevisionId === snapshot.revisionId &&
        snapshot.nodes.some(
          (node) => node.nodeId === draft.nodeId && node.generation === draft.expectedGeneration,
        ),
    )
  ) {
    current.mutate('恢复旧版编辑草稿', (content) => {
      for (const draft of legacy)
        setNodeRuns(content.nodes.find((node) => node.nodeId === draft.nodeId)!, [
          { text: draft.value },
        ])
    })
    // 新草稿写入持久缓存后再移除旧缓存，写入失败时仍保留旧缓存。
    if (current.state !== 'failed') {
      for (const draft of legacy) legacyStore.remove(snapshot.documentId, draft.nodeId)
      store.drafts = []
    }
  } else if (legacy.length)
    message.value = '检测到旧版草稿，基础版本不同，已保留原缓存；请先下载草稿备份后核对'
  store.editState = current.state
  if (current.hasChanges)
    void current.flush().catch((error) => {
      message.value = String(error)
    })
}
bind(props.snapshot)
watch(
  () =>
    [
      root.value.attributes.paperSize,
      root.value.attributes.pageMargin,
      root.value.attributes.header,
      root.value.attributes.footer,
      root.value.attributes.paperOrientation,
      root.value.attributes.pageNumbers,
    ] as const,
  (values, previous) => {
    if (previous && values.every((value, index) => value === previous[index])) return
    pageSize.value = values[0] === 'Letter' ? 'Letter' : 'A4'
    margin.value = Number(values[1]) || 20
    header.value = String(values[2] ?? '')
    footer.value = String(values[3] ?? '')
    orientation.value = values[4] === 'landscape' ? 'landscape' : 'portrait'
    pageNumbers.value = values[5] === true
  },
)
watch(
  () => props.snapshot,
  (snapshot) => {
    if (session.value?.baseline.documentId !== snapshot.documentId) {
      activeId.value = ''
      selection.value = undefined
      bind(snapshot)
    } else session.value.adopt(snapshot)
  },
)

function edit(intent: string, action: (content: OfficeContent) => void, key = ''): void {
  if (!editable.value || composing.value) return
  try {
    session.value?.mutate(intent, action, key)
    message.value = ''
  } catch (error) {
    message.value = error instanceof Error ? error.message : '编辑失败'
  }
}
function focus(id: string, offset = 0): void {
  activeId.value = id
  void nextTick(() => focusOfficeNode(id, offset))
}
function textInput(id: string, runs: OfficeRun[]): void {
  if (rebuildingComposition) return
  edit(
    '编辑正文',
    (content) => {
      const node = content.nodes.find((item) => item.nodeId === id)
      if (node) setNodeRuns(node, runs)
    },
    `text:${id}`,
  )
}
function orderedText(content: OfficeContent): OfficeNode[] {
  const result: OfficeNode[] = []
  const visit = (id: string) => {
    for (const node of officeChildren(content, id)) {
      if (OFFICE_TEXT_TYPES.has(node.type)) result.push(node)
      visit(node.nodeId)
    }
  }
  visit(root.value.nodeId)
  return result
}
function readSelection(): void {
  selectionPosition.value = undefined
  if (composing.value || rebuildingComposition) return
  const current = window.getSelection()
  if (!current?.anchorNode || !current.focusNode) return
  const anchorRoot = (
    current.anchorNode instanceof Element ? current.anchorNode : current.anchorNode.parentElement
  )?.closest<HTMLElement>('[data-office-editable]')
  const focusRoot = (
    current.focusNode instanceof Element ? current.focusNode : current.focusNode.parentElement
  )?.closest<HTMLElement>('[data-office-editable]')
  if (!anchorRoot || !focusRoot) return
  if (!editorElement.value?.contains(anchorRoot) || !editorElement.value.contains(focusRoot)) return
  if (
    !content.value.nodes.some((node) => node.nodeId === anchorRoot.dataset.officeEditable) ||
    !content.value.nodes.some((node) => node.nodeId === focusRoot.dataset.officeEditable)
  )
    return
  selection.value = {
    revisionId: session.value!.baseline.revisionId,
    anchor: {
      nodeId: anchorRoot.dataset.officeEditable!,
      offset: pointOffset(anchorRoot, current.anchorNode, current.anchorOffset),
    },
    focus: {
      nodeId: focusRoot.dataset.officeEditable!,
      offset: pointOffset(focusRoot, current.focusNode, current.focusOffset),
    },
  }
  activeId.value = focusRoot.dataset.officeEditable!
  if (!current.isCollapsed && current.rangeCount && props.mode === 'create') {
    const bounds = current.getRangeAt(0).getBoundingClientRect()
    selectionPosition.value = {
      left: `${Math.max(8, Math.min(bounds.left + bounds.width / 2 - 128, window.innerWidth - 272))}px`,
      top: `${Math.max(64, bounds.top - 44)}px`,
    }
  }
  if (
    typing.value &&
    (selection.value.anchor.nodeId !== selection.value.focus.nodeId ||
      selection.value.anchor.offset !== selection.value.focus.offset ||
      typing.value.nodeId !== selection.value.focus.nodeId ||
      typing.value.offset !== selection.value.focus.offset)
  )
    typing.value = undefined
  emit('selection', selection.value)
}
function range(content: OfficeContent) {
  const value = selection.value,
    nodes = orderedText(content)
  if (!value) return undefined
  let start = value.anchor,
    end = value.focus
  if (
    nodes.findIndex((node) => node.nodeId === start.nodeId) >
      nodes.findIndex((node) => node.nodeId === end.nodeId) ||
    (start.nodeId === end.nodeId && start.offset > end.offset)
  )
    [start, end] = [end, start]
  const first = nodes.findIndex((node) => node.nodeId === start.nodeId),
    last = nodes.findIndex((node) => node.nodeId === end.nodeId)
  if (first < 0 || last < first) return undefined
  return { start, end, nodes: nodes.slice(first, last + 1) }
}
function format(patch: Partial<OfficeMarks>): void {
  if (!editable.value || composing.value) return
  const selectedRange = range(content.value)
  if (
    selectedRange &&
    selectedRange.start.nodeId === selectedRange.end.nodeId &&
    selectedRange.start.offset === selectedRange.end.offset
  ) {
    const point = selectedRange.start,
      node = selectedRange.nodes[0]!,
      marks =
        typing.value?.marks ??
        sliceRuns(runsOf(node), Math.max(0, point.offset - 1), Math.max(1, point.offset))[0]
          ?.marks ??
        {}
    typing.value = {
      nodeId: point.nodeId,
      offset: point.offset,
      marks:
        normalizeRuns([
          {
            get text() {
              return __t('apps.arca.ui', '占位')
            },
            marks: { ...marks, ...patch },
          },
        ])[0]?.marks ?? {},
    }
    message.value = ''
    return
  }
  edit('设置选区格式', (content) => {
    const selected = range(content)
    if (
      !selected ||
      (selected.start.nodeId === selected.end.nodeId &&
        selected.start.offset === selected.end.offset)
    )
      throw new Error('请先选中需要设置格式的文字')
    for (const node of selected.nodes)
      setNodeRuns(
        node,
        formatRuns(
          runsOf(node),
          node.nodeId === selected.start.nodeId ? selected.start.offset : 0,
          node.nodeId === selected.end.nodeId ? selected.end.offset : Infinity,
          patch,
        ),
      )
  })
}
function toggleMark(key: 'bold' | 'italic' | 'underline' | 'strike'): void {
  const current = range(content.value),
    first = current?.nodes[0]
  const active = typing.value
    ? typing.value.marks[key]
    : first &&
      sliceRuns(runsOf(first), current!.start.offset, current!.start.offset + 1)[0]?.marks?.[key]
  format({ [key]: !active })
}
function paragraph(
  type: 'paragraph' | 'heading' | 'quote' | 'code-block',
  attrs: Record<string, JsonValue> = {},
): void {
  edit('设置段落样式', (content) => {
    const nodes =
      range(content)?.nodes ??
      (selected.value ? [content.nodes.find((item) => item.nodeId === activeId.value)!] : [])
    for (const node of nodes)
      if (['paragraph', 'heading', 'quote', 'code-block'].includes(node.type)) {
        node.type = type
        Object.assign(node.attributes, attrs)
      }
  })
}
function attributes(patch: Record<string, JsonValue>): void {
  edit('设置段落属性', (content) => {
    for (const node of selected.value?.type === 'asset'
      ? content.nodes.filter((item) => item.nodeId === activeId.value)
      : (range(content)?.nodes ?? content.nodes.filter((item) => item.nodeId === activeId.value)))
      Object.assign(node.attributes, patch)
  })
}
function selectNode(id: string): void {
  activeId.value = id
  if (selection.value?.focus.nodeId !== id) selection.value = undefined
}
function newNode(
  parentId: DocumentNodeId,
  type: OfficeNode['type'] = 'paragraph',
  text = '',
): OfficeNode {
  return {
    nodeId: crypto.randomUUID() as DocumentNodeId,
    parentId,
    type,
    text,
    orderKey: crypto.randomUUID(),
    attributes: {},
  }
}
function insertAfter(
  content: OfficeContent,
  reference: OfficeNode | undefined,
  node: OfficeNode,
): void {
  const siblings = officeChildren(content, node.parentId!),
    ids = siblings.map((item) => item.nodeId as string)
  const index = reference ? ids.indexOf(reference.nodeId) + 1 : ids.length
  ids.splice(Math.max(0, index), 0, node.nodeId)
  content.nodes.push(node)
  reorderChildren(content, node.parentId!, ids)
}
function insert(id = activeId.value): void {
  let inserted = ''
  edit('插入正文', (content) => {
    const reference = content.nodes.find((node) => node.nodeId === id),
      node = newNode(reference?.parentId ?? root.value.nodeId)
    insertAfter(content, reference, node)
    inserted = node.nodeId
  })
  if (inserted) focus(inserted)
}
function remove(id: string): void {
  edit('删除内容', (content) => {
    const ids = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const node of content.nodes)
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.nodeId)) {
          ids.add(node.nodeId)
          changed = true
        }
    }
    content.nodes = content.nodes.filter((node) => !ids.has(node.nodeId))
  })
}
function replaceSelection(text: string, splitLines = false): void {
  let point: { id: string; offset: number } | undefined
  edit('替换选区', (content) => {
    const selected = range(content)
    if (!selected) throw new Error('请先把光标放到正文中')
    const first = selected.nodes[0]!,
      last = selected.nodes.at(-1)!
    if (
      selected.nodes.some(
        (node) => node.parentId !== first.parentId || officeChildren(content, node.nodeId).length,
      )
    )
      throw new Error('跨表格或嵌套结构请分别编辑，当前选区已保留')
    const prefix = sliceRuns(runsOf(first), 0, selected.start.offset),
      suffix = sliceRuns(runsOf(last), selected.end.offset, Infinity)
    const lines =
      splitLines && !['table-cell', 'code-block'].includes(first.type) ? text.split('\n') : [text]
    const marks =
      typing.value?.nodeId === first.nodeId && typing.value.offset === selected.start.offset
        ? typing.value.marks
        : prefix.at(-1)?.marks
    setNodeRuns(first, [
      ...prefix,
      { text: lines[0]!, marks },
      ...(lines.length === 1 ? suffix : []),
    ])
    const removed = new Set(selected.nodes.slice(1).map((node) => node.nodeId))
    content.nodes = content.nodes.filter((node) => !removed.has(node.nodeId))
    let after = first
    for (let index = 1; index < lines.length; index++) {
      const node = newNode(first.parentId!, first.type === 'list-item' ? 'list-item' : 'paragraph')
      setNodeRuns(node, [
        { text: lines[index]!, marks },
        ...(index === lines.length - 1 ? suffix : []),
      ])
      insertAfter(content, after, node)
      after = node
    }
    point = {
      id: after.nodeId,
      offset: lines.length === 1 ? selected.start.offset + text.length : lines.at(-1)!.length,
    }
  })
  if (point) {
    if (typing.value) {
      typing.value.nodeId = point.id
      typing.value.offset = point.offset
    }
    selection.value = {
      revisionId: session.value!.baseline.revisionId,
      anchor: { nodeId: point.id, offset: point.offset },
      focus: { nodeId: point.id, offset: point.offset },
    }
    focus(point.id, point.offset)
  }
}
function key(id: string, event: KeyboardEvent): void {
  if (!editable.value || event.isComposing || composing.value) return
  readSelection()
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    const nodes = orderedText(content.value),
      first = nodes[0],
      last = nodes.at(-1)
    if (first && last) {
      const selected = {
        revisionId: session.value!.baseline.revisionId,
        anchor: { nodeId: first.nodeId, offset: 0 },
        focus: {
          nodeId: last.nodeId,
          offset: runsOf(last)
            .map((run) => run.text)
            .join('').length,
        },
      }
      restoreOfficeSelection(selected)
      selection.value = selected
    }
    return
  }
  if (modifier && ['z', 'y', 's', 'b', 'i', 'u'].includes(event.key.toLowerCase())) {
    event.preventDefault()
    if (event.key.toLowerCase() === 's') void flush().catch(() => {})
    else if (event.key.toLowerCase() === 'z' && !event.shiftKey) session.value?.undo()
    else if (['z', 'y'].includes(event.key.toLowerCase())) session.value?.redo()
    else
      toggleMark(
        ({ b: 'bold', i: 'italic', u: 'underline' } as const)[event.key.toLowerCase() as 'b'],
      )
    return
  }
  const selectedRange = range(content.value)
  if (!selectedRange) return
  const collapsed =
    selectedRange.start.nodeId === selectedRange.end.nodeId &&
    selectedRange.start.offset === selectedRange.end.offset
  if (!collapsed && ['Backspace', 'Delete'].includes(event.key)) {
    event.preventDefault()
    replaceSelection('')
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const current = content.value.nodes.find((node) => node.nodeId === selectedRange.start.nodeId)
    if (
      collapsed &&
      current?.type === 'list-item' &&
      !current.text &&
      !officeChildren(content.value, current.nodeId).length
    ) {
      nestList(true)
      focus(current.nodeId)
      return
    }
    replaceSelection('\n', !event.shiftKey)
  } else if (event.key === 'Backspace' && collapsed && selectedRange.start.offset === 0) {
    const node = content.value.nodes.find((item) => item.nodeId === id)!,
      siblings = officeChildren(content.value, node.parentId!)
    const previous = siblings[siblings.findIndex((item) => item.nodeId === id) - 1]
    event.preventDefault()
    if (
      node.type === 'table-cell' ||
      !previous ||
      previous.type === 'table-cell' ||
      !OFFICE_TEXT_TYPES.has(previous.type) ||
      officeChildren(content.value, node.nodeId).length
    )
      return
    const offset = runsOf(previous)
      .map((run) => run.text)
      .join('').length
    edit('合并段落', (content) => {
      const a = content.nodes.find((item) => item.nodeId === previous.nodeId)!,
        b = content.nodes.find((item) => item.nodeId === id)!
      setNodeRuns(a, [...runsOf(a), ...runsOf(b)])
      content.nodes = content.nodes.filter((item) => item.nodeId !== id)
    })
    focus(previous.nodeId, offset)
  } else if (
    event.key === 'Delete' &&
    collapsed &&
    selectedRange.start.offset ===
      (content.value.nodes.find((node) => node.nodeId === id)?.text?.length ?? 0)
  ) {
    event.preventDefault()
    const node = content.value.nodes.find((node) => node.nodeId === id)!,
      siblings = officeChildren(content.value, node.parentId!),
      next = siblings[siblings.findIndex((node) => node.nodeId === id) + 1]
    if (
      node.type === 'table-cell' ||
      !next ||
      next.type === 'table-cell' ||
      !OFFICE_TEXT_TYPES.has(next.type) ||
      officeChildren(content.value, next.nodeId).length
    )
      return
    const offset = selectedRange.start.offset
    edit('合并段落', (content) => {
      const a = content.nodes.find((item) => item.nodeId === id)!,
        b = content.nodes.find((item) => item.nodeId === next.nodeId)!
      setNodeRuns(a, [...runsOf(a), ...runsOf(b)])
      content.nodes = content.nodes.filter((item) => item.nodeId !== next.nodeId)
    })
    focus(id, offset)
  } else if (event.key === 'Tab' && selected.value?.type === 'table-cell') {
    event.preventDefault()
    const cells = orderedText(content.value).filter((node) => node.type === 'table-cell'),
      at = cells.findIndex((node) => node.nodeId === id),
      next = cells[at + (event.shiftKey ? -1 : 1)]
    if (next) focus(next.nodeId)
  } else if (event.key === 'Tab' && selected.value?.type === 'list-item') {
    event.preventDefault()
    nestList(event.shiftKey)
  } else if (
    !collapsed &&
    selectedRange.nodes.length > 1 &&
    event.key.length === 1 &&
    !modifier &&
    !event.altKey
  ) {
    event.preventDefault()
    replaceSelection(event.key)
  }
}
function paste(_id: string, event: ClipboardEvent): void {
  if (!editable.value) return
  event.preventDefault()
  readSelection()
  const image = [...(event.clipboardData?.files ?? [])].find((file) =>
    file.type.startsWith('image/'),
  )
  if (image) {
    void insertImage(image)
    return
  }
  replaceSelection(event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n') ?? '', true)
}
function composition(active: boolean, text = ''): void {
  store.officeDirty = !!session.value?.hasChanges || uploads.value > 0 || active
  if (active) {
    readSelection()
    compositionSelection = selection.value
      ? (JSON.parse(JSON.stringify(selection.value)) as OfficeSelection)
      : undefined
    composing.value = true
    return
  }
  composing.value = false
  void nextTick(() => {
    for (const resolve of compositionWaiters.splice(0)) resolve()
  })
  if (
    compositionSelection &&
    (compositionSelection.anchor.nodeId !== compositionSelection.focus.nodeId || !!typing.value)
  ) {
    selection.value = compositionSelection
    rebuildingComposition = true
    if (text) replaceSelection(text)
    renderEpoch.value++
    void nextTick(() => {
      rebuildingComposition = false
      if (!text && compositionSelection) restoreOfficeSelection(compositionSelection)
      compositionSelection = undefined
    })
  } else compositionSelection = undefined
}
function cut(_id: string, event: ClipboardEvent): void {
  if (!editable.value || composing.value) return
  readSelection()
  const current = range(content.value)
  if (
    !current ||
    (current.start.nodeId === current.end.nodeId && current.start.offset === current.end.offset)
  )
    return
  event.preventDefault()
  event.clipboardData?.setData(
    'text/plain',
    current.nodes
      .map((node) =>
        sliceRuns(
          runsOf(node),
          node.nodeId === current.start.nodeId ? current.start.offset : 0,
          node.nodeId === current.end.nodeId ? current.end.offset : Infinity,
        )
          .map((run) => run.text)
          .join(''),
      )
      .join('\n'),
  )
  replaceSelection('')
}
function copySelection(event: ClipboardEvent): void {
  const selected = window.getSelection(),
    node = selected?.anchorNode
  const focus = selected?.focusNode
  if (
    !node ||
    !focus ||
    !(node instanceof Element ? node : node.parentElement)?.closest('[data-office-editable]') ||
    !(focus instanceof Element ? focus : focus.parentElement)?.closest('[data-office-editable]')
  )
    return
  readSelection()
  const current = range(content.value)
  if (!current) return
  event.preventDefault()
  event.clipboardData?.setData(
    'text/plain',
    current.nodes
      .map((node) =>
        sliceRuns(
          runsOf(node),
          node.nodeId === current.start.nodeId ? current.start.offset : 0,
          node.nodeId === current.end.nodeId ? current.end.offset : Infinity,
        )
          .map((run) => run.text)
          .join(''),
      )
      .join('\n'),
  )
}
function beforeInput(_id: string, event: InputEvent): void {
  if (!editable.value || composing.value || event.isComposing) return
  readSelection()
  if (typing.value && event.inputType === 'insertText') {
    event.preventDefault()
    replaceSelection(event.data ?? '')
    return
  }
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault()
    if (event.inputType === 'historyUndo') session.value?.undo()
    else session.value?.redo()
    return
  }
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    event.preventDefault()
    replaceSelection('\n', event.inputType === 'insertParagraph')
    return
  }
  const current = range(content.value)
  if (current && current.nodes.length > 1) {
    if (event.inputType.startsWith('delete')) {
      event.preventDefault()
      replaceSelection('')
    } else if (event.inputType === 'insertText') {
      event.preventDefault()
      replaceSelection(event.data ?? '')
    }
  }
  if (event.inputType === 'insertFromDrop') {
    event.preventDefault()
    message.value = '移动正文请使用剪切粘贴，或内容旁的排序按钮'
  }
}
function nestList(outdent: boolean): void {
  edit(outdent ? '减少列表层级' : '增加列表层级', (content) => {
    const node = content.nodes.find((node) => node.nodeId === activeId.value),
      list = content.nodes.find((item) => item.nodeId === node?.parentId)
    if (node?.type !== 'list-item' || list?.type !== 'list') throw new Error('请先选择列表条目')
    if (outdent) {
      const parent = content.nodes.find((item) => item.nodeId === list.parentId)!,
        outer = content.nodes.find((item) => item.nodeId === parent.parentId)
      const targetParent =
        parent.type === 'list-item' && outer?.type === 'list' ? outer.nodeId : list.parentId!
      const reference = targetParent === outer?.nodeId ? parent : list
      node.parentId = targetParent
      const lifted = reference === list ? officeChildren(content, node.nodeId) : []
      if (reference === list) {
        node.type = 'paragraph'
        for (const child of lifted) child.parentId = targetParent
      }
      const siblings = officeChildren(content, targetParent)
        .filter(
          (item) =>
            item.nodeId !== node.nodeId && !lifted.some((child) => child.nodeId === item.nodeId),
        )
        .map((node) => node.nodeId as string)
      siblings.splice(
        siblings.indexOf(reference.nodeId) + 1,
        0,
        node.nodeId,
        ...lifted.map((child) => child.nodeId),
      )
      reorderChildren(content, targetParent, siblings)
      if (!officeChildren(content, list.nodeId).length)
        content.nodes = content.nodes.filter((node) => node.nodeId !== list.nodeId)
    } else {
      const siblings = officeChildren(content, list.nodeId),
        previous = siblings[siblings.findIndex((item) => item.nodeId === node.nodeId) - 1]
      if (!previous) throw new Error('首个条目不能增加层级')
      let nested = officeChildren(content, previous.nodeId).find(
        (node) => node.type === 'list' && node.attributes.ordered === list.attributes.ordered,
      )
      if (!nested) {
        nested = newNode(previous.nodeId, 'list')
        delete nested.text
        nested.attributes.ordered = list.attributes.ordered ?? false
        content.nodes.push(nested)
      }
      node.parentId = nested.nodeId
      reorderChildren(content, nested.nodeId, [
        ...officeChildren(content, nested.nodeId)
          .filter((item) => item.nodeId !== node.nodeId)
          .map((node) => node.nodeId),
        node.nodeId,
      ])
    }
  })
}
function navigate(id: string): void {
  focusOfficeNode(id, 0)
  document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
}
function move(id: string, offset: number): void {
  edit('调整内容顺序', (content) => {
    const node = content.nodes.find((node) => node.nodeId === id)
    if (!node?.parentId) return
    const siblings = officeChildren(content, node.parentId).map((node) => node.nodeId as string),
      index = siblings.indexOf(id),
      next = index + offset
    if (next < 0 || next >= siblings.length) return
    if (node.type === 'heading') {
      const nodes = officeChildren(content, node.parentId),
        level = Number(node.attributes.level) || 1
      const endOf = (start: number) => {
        let end = start + 1
        while (
          end < nodes.length &&
          !(nodes[end]!.type === 'heading' && Number(nodes[end]!.attributes.level ?? 1) <= level)
        )
          end++
        return end
      }
      const end = endOf(index)
      let previous = index - 1
      while (
        previous >= 0 &&
        !(
          nodes[previous]!.type === 'heading' &&
          Number(nodes[previous]!.attributes.level ?? 1) <= level
        )
      )
        previous--
      const adjacent = offset < 0 ? previous : end
      if (
        adjacent < 0 ||
        adjacent >= nodes.length ||
        Number(nodes[adjacent]!.attributes.level ?? 1) !== level
      )
        throw new Error('当前方向没有同级章节')
      const ids =
        offset < 0
          ? [
              ...siblings.slice(0, previous),
              ...siblings.slice(index, end),
              ...siblings.slice(previous, index),
              ...siblings.slice(end),
            ]
          : [
              ...siblings.slice(0, index),
              ...siblings.slice(end, endOf(end)),
              ...siblings.slice(index, end),
              ...siblings.slice(endOf(end)),
            ]
      reorderChildren(content, node.parentId, ids)
      return
    }
    ;[siblings[index], siblings[next]] = [siblings[next]!, siblings[index]!]
    reorderChildren(content, node.parentId, siblings)
  })
}
function list(ordered: boolean): void {
  edit('设置列表', (content) => {
    const items =
      range(content)?.nodes ?? content.nodes.filter((node) => node.nodeId === activeId.value)
    if (
      !items.length ||
      items.some((node) => !['paragraph', 'heading', 'list-item'].includes(node.type))
    )
      throw new Error('请选择普通正文或列表条目')
    const parentId = items[0]!.parentId!
    if (items.some((node) => node.parentId !== parentId)) throw new Error('请选择同一层级的段落')
    const parent = content.nodes.find((node) => node.nodeId === parentId)!
    if (parent.type === 'list') {
      parent.attributes.ordered = ordered
      return
    }
    const group = newNode(parentId, 'list')
    delete group.text
    group.attributes.ordered = ordered
    insertAfter(
      content,
      officeChildren(content, parentId)[
        Math.max(
          0,
          officeChildren(content, parentId).findIndex((node) => node.nodeId === items[0]!.nodeId) -
            1,
        )
      ],
      group,
    )
    items.forEach((node, index) => {
      node.parentId = group.nodeId
      node.type = 'list-item'
      node.orderKey = String(index + 1).padStart(10, '0')
    })
  })
}
function table(): void {
  edit('插入表格', (content) => {
    const selected = content.nodes.find((node) => node.nodeId === activeId.value)
    const node = newNode(root.value.nodeId, 'table')
    delete node.text
    insertAfter(content, selected?.parentId === root.value.nodeId ? selected : undefined, node)
    for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
      const row = newNode(node.nodeId, 'table-row')
      delete row.text
      row.orderKey = String(rowIndex).padStart(10, '0')
      content.nodes.push(row)
      for (let column = 0; column < 3; column++) {
        const cell = newNode(row.nodeId, 'table-cell')
        cell.orderKey = String(column).padStart(10, '0')
        content.nodes.push(cell)
      }
    }
  })
}
function changeTable(action: OfficeTableAction): void {
  edit('调整表格', (content) =>
    editOfficeTable(content, activeId.value, action, () => crypto.randomUUID()),
  )
}
function columnWidth(width: number): void {
  edit('调整表格列宽', (content) => {
    const cell = content.nodes.find((node) => node.nodeId === activeId.value),
      row = content.nodes.find((node) => node.nodeId === cell?.parentId),
      table = content.nodes.find((node) => node.nodeId === row?.parentId)
    if (!table || table.type !== 'table') return
    const grid = officeTableGrid(content, table.nodeId),
      current = grid.positions.find((position) => position.node.nodeId === cell?.nodeId)!
    const widths = Array.from({ length: grid.width }, (_, index) =>
      Array.isArray(table.attributes.columnWidths)
        ? Number(table.attributes.columnWidths[index]) || 120
        : 120,
    )
    widths[current.column] = Math.max(24, Math.min(1600, width || 120))
    table.attributes.columnWidths = widths
  })
}
async function image(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  await insertImage(file)
}
async function insertImage(file: File): Promise<void> {
  const documentId = session.value?.baseline.documentId,
    referenceId = activeId.value
  uploads.value++
  store.officeDirty = true
  try {
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ||
      file.size > 20 * 1024 * 1024
    )
      throw new Error('请选择 20 MB 以内的 PNG、JPEG、WebP 或 GIF 图片')
    if (!store.transport || !store.session) throw new Error('请先连接 Arca 后再插入图片')
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
    const blob = (await store.transport.invoke(
      'blob.put',
      { base64: btoa(binary), surfaceSessionToken: store.session.token },
      { idempotencyKey: crypto.randomUUID() },
    )) as { blobId: string }
    if (disposed || session.value?.baseline.documentId !== documentId) return
    if (composing.value) await new Promise<void>((resolve) => compositionWaiters.push(resolve))
    if (disposed || session.value?.baseline.documentId !== documentId) return
    edit('插入或替换图片', (content) => {
      const reference = content.nodes.find((node) => node.nodeId === referenceId)
      if (reference?.type === 'asset') {
        reference.attributes.blobId = blob.blobId
        reference.attributes.mimeType = file.type
        return
      }
      const node = newNode(root.value.nodeId, 'asset')
      delete node.text
      node.attributes = {
        blobId: blob.blobId,
        mimeType: file.type,
        alt: file.name,
        caption: '',
        width: 480,
      }
      insertAfter(content, reference?.parentId === root.value.nodeId ? reference : undefined, node)
    })
  } catch (error) {
    message.value = error instanceof Error ? error.message : '图片插入失败'
  } finally {
    uploads.value--
    if (!disposed && store.activeDocumentId === documentId)
      store.officeDirty = !!session.value?.hasChanges || uploads.value > 0 || composing.value
  }
}
async function loadAssets(): Promise<void> {
  for (const node of content.value.nodes.filter((node) => node.type === 'asset')) {
    const id = String(node.attributes.blobId ?? '')
    if (
      !/^sha256:[a-f0-9]{64}$/i.test(id) ||
      assetLoads.has(id) ||
      assets.value[id] ||
      !store.transport
    )
      continue
    assetLoads.add(id)
    try {
      const result = (await store.transport.invoke('blob.get', { blobId: id })) as {
        base64: string
      }
      if (disposed) return
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      const mimeType = String(node.attributes.mimeType)
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) continue
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
      objectUrls.add(url)
      assets.value[id] = url
    } catch {
      message.value = '部分图片暂时无法读取，文稿引用仍已保留'
    } finally {
      assetLoads.delete(id)
    }
  }
}
watch(
  () => [version.value, store.connection],
  () => {
    void loadAssets()
  },
)
async function flush(): Promise<void> {
  if (uploads.value) throw new Error('图片仍在上传，请等待插入完成后再切换文稿')
  if (composing.value) throw new Error('请先完成当前输入法组合输入')
  await session.value?.flush()
}
async function reload(confirmed = false): Promise<void> {
  try {
    if (session.value?.hasChanges && !confirmed) {
      reloadOpen.value = true
      return
    }
    const snapshot = (await store.transport?.invoke('document.inspect', {
      documentId: props.snapshot.documentId,
    })) as DocumentSnapshot | undefined
    if (snapshot) {
      session.value?.discard(snapshot)
      message.value = ''
      reloadOpen.value = false
    }
  } catch (error) {
    message.value = String(error)
  }
}
function pageSettings(): void {
  edit('设置页面', (content) => {
    const node = content.nodes.find((node) => node.type === 'document-root')!
    node.attributes.paperSize = pageSize.value
    node.attributes.paperOrientation = orientation.value
    node.attributes.pageNumbers = pageNumbers.value
    node.attributes.pageMargin = Math.max(5, Math.min(50, margin.value))
    node.attributes.header = header.value
    node.attributes.footer = footer.value
    node.attributes.officeSchemaVersion = 1
  })
}
function addReference(): void {
  if (
    !referenceTitle.value.trim() ||
    (referenceUrl.value && !/^https?:\/\//i.test(referenceUrl.value))
  ) {
    message.value = '请填写资料标题，来源链接使用 http:// 或 https://'
    return
  }
  let point: { id: string; offset: number } | undefined
  edit('插入资料引用或脚注', (content) => {
    const current = range(content),
      node = content.nodes.find((node) => node.nodeId === current?.end.nodeId)
    if (!current || !node) throw new Error('请先把光标放到正文中的引用位置')
    const id = crypto.randomUUID(),
      number = Math.max(0, ...references.value.map((reference) => reference.number ?? 0)) + 1,
      label = `[${number}]`,
      runs = runsOf(node),
      root = content.nodes.find((node) => node.type === 'document-root')!
    root.attributes.references = [
      ...references.value,
      {
        id,
        number,
        title: referenceTitle.value.trim(),
        url: referenceUrl.value.trim(),
        note: referenceNote.value.trim(),
      },
    ]
    setNodeRuns(node, [
      ...sliceRuns(runs, 0, current.end.offset),
      { text: label, marks: { citation: id } },
      ...sliceRuns(runs, current.end.offset, Infinity),
    ])
    point = { id: node.nodeId, offset: current.end.offset + label.length }
  })
  if (point) {
    referenceOpen.value = false
    referenceTitle.value = ''
    referenceUrl.value = ''
    referenceNote.value = ''
    focus(point.id, point.offset)
  }
}
function printPreview(): void {
  try {
    if (!previewReady.value) return
    previewFrame.value?.contentWindow?.focus()
    previewFrame.value?.contentWindow?.print()
  } catch {
    message.value = '当前容器无法打开打印对话框，可导出 HTML 后在浏览器打印'
  }
}
function link(): void {
  linkValue.value = currentMarks.value.link ?? ''
  linkError.value = ''
  linkOpen.value = true
}
function applyLink(removeLink = false): void {
  const value = removeLink ? '' : linkValue.value.trim()
  if (value && !/^(https?:|mailto:|#)/i.test(value)) {
    linkError.value = '请输入有效的链接地址'
    return
  }
  format({ link: value || undefined })
  linkOpen.value = false
  void nextTick(() => {
    if (selection.value) restoreOfficeSelection(selection.value)
  })
}
function closeFileMenu(event: MouseEvent): void {
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}
function showFind(): void {
  findOpen.value = true
  void nextTick(() => findInput.value?.focus())
}
function setRibbon(value: 'home' | 'insert' | 'layout' | 'review'): void {
  ribbon.value = value
}
function getSelectedText(): string {
  const selected = range(content.value)
  if (!selected) return ''
  return selected.nodes
    .map((node) =>
      runsOf(node)
        .map((run) => run.text)
        .join('')
        .slice(
          node.nodeId === selected.start.nodeId ? selected.start.offset : 0,
          node.nodeId === selected.end.nodeId ? selected.end.offset : undefined,
        ),
    )
    .join('\n')
}
function toggleView(): void {
  viewMode.value = viewMode.value === 'page' ? 'continuous' : 'page'
  try {
    localStorage.setItem('arca-document-view', viewMode.value)
  } catch {
    /* 视图偏好存储失败不影响编辑。 */
  }
}
function setZoom(value: number): void {
  zoom.value = Math.max(50, Math.min(150, value || 100))
}
function hideSelectionToolbar(): void {
  selectionPosition.value = undefined
}
function shortcuts(event: KeyboardEvent): void {
  if (
    event.defaultPrevented ||
    props.mode === 'review' ||
    document.querySelector('[aria-modal="true"]')
  )
    return
  if (!(event.ctrlKey || event.metaKey) || event.isComposing) return
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault()
    showFind()
  } else if (event.key.toLowerCase() === 's' && !store.applicationStopping) {
    event.preventDefault()
    void flush().catch((error) => {
      message.value = String(error)
    })
  }
}
async function prepareExit(keepDraft: boolean): Promise<void> {
  if (uploads.value || composing.value) throw new Error('请等待图片上传或当前输入完成')
  if (keepDraft) {
    if (session.value?.hasChanges && !session.value.recoverable)
      throw new Error('草稿未能保存，请先备份')
  } else await flush()
  session.value?.suspend()
}
function resumeAfterExitFailure(): void {
  session.value?.resume()
}
function backup(): void {
  const data = JSON.stringify(
    {
      version: 1,
      baseline: session.value?.baseline,
      content: session.value?.content,
      legacyDrafts: legacyStore.list(props.snapshot.documentId),
      unreadableDraft: session.value?.unreadableDraft,
    },
    null,
    2,
  )
  download(data, 'application/json', `${content.value.title}.草稿备份.json`)
}
async function saveCopy(): Promise<void> {
  try {
    if (!store.transport || !store.session || !session.value)
      throw new Error('请先连接 Arca 后再另存副本')
    const current = session.value,
      encoded = JSON.stringify(current.content)
    if (!copyRequest || copyRequest.content !== encoded)
      copyRequest = { key: crypto.randomUUID(), content: encoded }
    const snapshot = (await store.transport.invoke(
      'document.duplicate',
      {
        documentId: current.baseline.documentId,
        baseRevisionId: current.baseline.revisionId,
        get title() {
          return __t('apps.arca.ui', '{0}（草稿副本）', [current.content.title])
        },
        content: current.content,
        surfaceSessionToken: store.session.token,
      },
      { idempotencyKey: copyRequest.key },
    )) as DocumentSnapshot
    if (JSON.stringify(current.content) !== encoded) {
      message.value = '副本已保存，后续编辑仍保留在当前草稿'
      await store.refreshDocumentIndex()
      return
    }
    current.discard(current.baseline)
    emit('copy', snapshot.documentId)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '另存副本失败，草稿仍保留'
  }
}
const matches = computed(() => {
  if (!findText.value) return []
  return orderedText(content.value).flatMap((node) => {
    const text = runsOf(node)
        .map((run) => run.text)
        .join(''),
      result: Array<{ nodeId: string; offset: number }> = []
    for (
      let from = 0, at: number;
      (at = text.indexOf(findText.value, from)) >= 0;
      from = at + findText.value.length
    )
      result.push({ nodeId: node.nodeId, offset: at })
    return result
  })
})
function findNext(): void {
  const match = matches.value[searchIndex.value++ % matches.value.length]
  if (!match) {
    message.value = '没有找到匹配文字'
    return
  }
  const selected = {
    revisionId: session.value!.baseline.revisionId,
    anchor: { nodeId: match.nodeId, offset: match.offset },
    focus: { nodeId: match.nodeId, offset: match.offset + findText.value.length },
  }
  focusOfficeNode(match.nodeId, match.offset)
  restoreOfficeSelection(selected)
  selection.value = selected
  activeId.value = match.nodeId
  document
    .querySelector(`[data-node-id="${CSS.escape(match.nodeId)}"]`)
    ?.scrollIntoView({ block: 'center' })
}
function replaceAll(): void {
  if (!findText.value) return
  const found = matches.value
  edit('批量替换文字', (content) => {
    for (const match of [...found].reverse()) {
      const node = content.nodes.find((node) => node.nodeId === match.nodeId)!,
        runs = runsOf(node)
      setNodeRuns(node, [
        ...sliceRuns(runs, 0, match.offset),
        {
          text: replacementText.value,
          marks: sliceRuns(runs, match.offset, match.offset + 1)[0]?.marks,
        },
        ...sliceRuns(runs, match.offset + findText.value.length, Infinity),
      ])
    }
  })
}
function download(data: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function preview(downloadFile = false): Promise<void> {
  try {
    await flush()
    const result = (await store.transport?.invoke('document.preview', {
      documentId: props.snapshot.documentId,
      revisionId: session.value?.baseline.revisionId,
    })) as { html: string } | undefined
    if (!result) throw new Error('请先连接 Arca 后再预览')
    if (downloadFile)
      download(result.html, 'text/html;charset=utf-8', `${content.value.title}.html`)
    else {
      previewReady.value = false
      previewHtml.value = result.html
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : '预览失败'
  }
}
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (store.applicationStopped) return
  if (session.value?.hasChanges || uploads.value || composing.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => {
  document.addEventListener('selectionchange', readSelection)
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', shortcuts)
  window.addEventListener('scroll', hideSelectionToolbar, true)
  window.addEventListener('resize', hideSelectionToolbar)
  void loadAssets()
  paperObserver = new ResizeObserver((entries) => {
    for (const entry of entries) paperWidth.value = (entry.target as HTMLElement).clientWidth
  })
  if (paperElement.value) paperObserver.observe(paperElement.value)
})
onBeforeUnmount(() => {
  paperObserver?.disconnect()
  disposed = true
  for (const resolve of compositionWaiters.splice(0)) resolve()
  store.officeCharacterCount = undefined
  session.value?.detach()
  document.removeEventListener('selectionchange', readSelection)
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', shortcuts)
  window.removeEventListener('scroll', hideSelectionToolbar, true)
  window.removeEventListener('resize', hideSelectionToolbar)
  for (const url of objectUrls) URL.revokeObjectURL(url)
})
defineExpose({
  flush,
  session,
  prepareExit,
  resumeAfterExitFailure,
  selected,
  cell,
  selectedColumnWidth,
  attributes,
  columnWidth,
  showFind,
  viewMode,
  zoom,
  toggleView,
  setZoom,
  chooseImage: () => fileInput.value?.click(),
  ribbon,
  setRibbon,
  preview,
  backup,
  saveCopy,
  getSelectedText,
  hideSelectionToolbar,
  getSelection: () => selection.value,
  hasPendingAssets: computed(() => uploads.value > 0 || composing.value),
})
</script>

<template>
  <section ref="editorElement" class="office-editor">
    <div v-if="!toolbarTarget" class="editor-commandbar">
      <nav v-if="editable" class="ribbon-tabs" :aria-label="__t('apps.arca.ui', '编辑工具')">
        <button
          v-for="tab in ribbonTabs"
          :key="tab.id"
          type="button"
          :aria-pressed="ribbon === tab.id"
          :class="{ active: ribbon === tab.id }"
          @mousedown.prevent
          @click="ribbon = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
      <span v-else class="reader-label">
        {{ props.writable ? __t('apps.arca.ui', '阅读') : __t('apps.arca.ui', '只读') }}
      </span>
      <span class="toolbar-spacer" />
      <span v-if="uploads" class="upload-status" role="status">
        {{ __t('apps.arca.ui', '上传中…') }}
      </span>
      <details class="editor-file-menu">
        <summary>
          {{ __t('apps.arca.ui', '文件') }}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div class="context-menu" @click="closeFileMenu">
          <button type="button" @click="preview()">{{ __t('apps.arca.ui', '预览与打印') }}</button>
          <button type="button" @click="preview(true)">
            {{ __t('apps.arca.ui', '导出 HTML') }}
          </button>
          <button type="button" @click="emit('exportProject')">
            {{ __t('apps.arca.ui', '导出工程') }}
          </button>
          <button type="button" @click="emit('importProject')">
            {{ __t('apps.arca.ui', '导入工程') }}
          </button>
          <button type="button" @click="backup">{{ __t('apps.arca.ui', '备份') }}</button>
          <button v-if="session?.hasChanges" type="button" @click="saveCopy">
            {{ __t('apps.arca.ui', '另存副本') }}
          </button>
        </div>
      </details>
    </div>
    <Teleport :to="toolbarTarget ?? 'body'" :disabled="!toolbarTarget">
      <div v-show="mode !== 'review'" class="editor-ribbon-stack">
        <div v-if="!editable" class="reader-toolbar">
          <span>
            {{ writable ? __t('apps.arca.ui', '阅读模式') : __t('apps.arca.ui', '只读文稿') }}
          </span>
          <span class="toolbar-spacer" />
          <button @click="preview()">{{ __t('apps.arca.ui', '预览与打印') }}</button>
          <button @click="emit('inspect', 'outline')">{{ __t('apps.arca.ui', '大纲') }}</button>
          <button @click="showFind">{{ __t('apps.arca.ui', '查找') }}</button>
        </div>
        <fieldset v-if="editable" :key="ribbon" class="ribbon-controls" :disabled="composing">
          <template v-if="ribbon === 'home'">
            <div class="ribbon-group">
              <button
                class="icon-button"
                :title="__t('apps.arca.ui', '撤销（Ctrl+Z）')"
                :aria-label="__t('apps.arca.ui', '撤销')"
                :disabled="!session?.history.length"
                @mousedown.prevent
                @click="session?.undo()"
              >
                <ArcaIcon name="undo" :size="17" />
              </button>
              <button
                class="icon-button"
                :title="__t('apps.arca.ui', '重做（Ctrl+Y）')"
                :aria-label="__t('apps.arca.ui', '重做')"
                :disabled="!session?.future.length"
                @mousedown.prevent
                @click="session?.redo()"
              >
                <ArcaIcon name="redo" :size="17" />
              </button>
            </div>
            <div class="ribbon-group">
              <ArcaSelect
                :aria-label="__t('apps.arca.ui', '段落样式')"
                :model-value="
                  selected?.type === 'heading'
                    ? Number(selected.attributes.level) || 1
                    : selected?.type === 'quote'
                      ? 'quote'
                      : 'paragraph'
                "
                :options="paragraphOptions"
                @change="changeParagraph"
              />
              <ArcaSelect
                v-model="fontFamily"
                :aria-label="__t('apps.arca.ui', '字体')"
                :options="fontOptions"
                @change="format({ fontFamily })"
              />
              <input
                v-model.number="fontSize"
                type="number"
                min="8"
                max="96"
                :title="__t('apps.arca.ui', '字号')"
                :aria-label="__t('apps.arca.ui', '字号')"
                @change="format({ fontSize: Math.max(8, Math.min(96, Number(fontSize) || 12)) })"
              />
            </div>
            <div class="ribbon-group mark-tools">
              <button
                :aria-label="__t('apps.arca.ui', '加粗')"
                :title="__t('apps.arca.ui', '加粗（Ctrl+B）')"
                :aria-pressed="!!currentMarks.bold"
                :class="{ active: currentMarks.bold }"
                @mousedown.prevent
                @click="toggleMark('bold')"
              >
                <b>B</b>
              </button>
              <button
                :aria-label="__t('apps.arca.ui', '斜体')"
                :title="__t('apps.arca.ui', '斜体（Ctrl+I）')"
                :aria-pressed="!!currentMarks.italic"
                :class="{ active: currentMarks.italic }"
                @mousedown.prevent
                @click="toggleMark('italic')"
              >
                <i>I</i>
              </button>
              <button
                :aria-label="__t('apps.arca.ui', '下划线')"
                :title="__t('apps.arca.ui', '下划线（Ctrl+U）')"
                :aria-pressed="!!currentMarks.underline"
                :class="{ active: currentMarks.underline }"
                @mousedown.prevent
                @click="toggleMark('underline')"
              >
                <u>U</u>
              </button>
              <details class="ribbon-format-menu">
                <summary :aria-label="__t('apps.arca.ui', '更多文字格式')">
                  <ArcaIcon name="more" :size="16" />
                </summary>
                <div class="context-menu">
                  <button
                    :aria-label="__t('apps.arca.ui', '删除线')"
                    :title="__t('apps.arca.ui', '删除线')"
                    :aria-pressed="!!currentMarks.strike"
                    :class="{ active: currentMarks.strike }"
                    @mousedown.prevent
                    @click="toggleMark('strike')"
                  >
                    <s>S</s>
                  </button>
                  <label>
                    {{ __t('apps.arca.ui', '文字颜色') }}
                    <input
                      v-model="color"
                      type="color"
                      :aria-label="__t('apps.arca.ui', '文字颜色')"
                      @change="format({ color })"
                    />
                  </label>
                  <label>
                    {{ __t('apps.arca.ui', '高亮颜色') }}
                    <input
                      v-model="highlight"
                      type="color"
                      :aria-label="__t('apps.arca.ui', '高亮颜色')"
                      @change="format({ highlight })"
                    />
                  </label>
                </div>
              </details>
            </div>
            <div class="ribbon-group">
              <button
                :class="{
                  active: selected?.attributes.align === 'left' || !selected?.attributes.align,
                }"
                :title="__t('apps.arca.ui', '左对齐')"
                :aria-label="__t('apps.arca.ui', '左对齐')"
                @mousedown.prevent
                @click="attributes({ align: 'left' })"
              >
                <ArcaIcon name="alignLeft" :size="16" />
              </button>
              <button
                :class="{ active: selected?.attributes.align === 'center' }"
                :title="__t('apps.arca.ui', '居中')"
                :aria-label="__t('apps.arca.ui', '居中')"
                @mousedown.prevent
                @click="attributes({ align: 'center' })"
              >
                <ArcaIcon name="alignCenter" :size="16" />
              </button>
              <button
                :class="{ active: selected?.attributes.align === 'right' }"
                :title="__t('apps.arca.ui', '右对齐')"
                :aria-label="__t('apps.arca.ui', '右对齐')"
                @mousedown.prevent
                @click="attributes({ align: 'right' })"
              >
                <ArcaIcon name="alignRight" :size="16" />
              </button>
              <button @mousedown.prevent @click="list(false)">
                {{ __t('apps.arca.ui', '项目符号') }}
              </button>
              <button @mousedown.prevent @click="list(true)">
                {{ __t('apps.arca.ui', '编号') }}
              </button>
            </div>
            <div v-if="selected?.type === 'list-item'" class="ribbon-group">
              <button @mousedown.prevent @click="nestList(false)">
                {{ __t('apps.arca.ui', '增加层级') }}
              </button>
              <button @mousedown.prevent @click="nestList(true)">
                {{ __t('apps.arca.ui', '减少层级') }}
              </button>
            </div>
          </template>
          <template v-else-if="ribbon === 'insert'">
            <div class="ribbon-group">
              <button @mousedown.prevent @click="fileInput?.click()">
                {{ __t('apps.arca.ui', '图片') }}
              </button>
              <button @mousedown.prevent @click="table">{{ __t('apps.arca.ui', '表格') }}</button>
              <button @mousedown.prevent @click="link">{{ __t('apps.arca.ui', '链接') }}</button>
            </div>
            <div class="ribbon-group">
              <button @mousedown.prevent @click="referenceOpen = true">
                {{ __t('apps.arca.ui', '引用与脚注') }}
              </button>
              <button
                :class="{ active: root.attributes.showToc }"
                @mousedown.prevent
                @click="
                  edit(__t('apps.arca.ui', '切换文稿目录'), (content) => {
                    const node = content.nodes.find((node) => node.type === 'document-root')!
                    node.attributes.showToc = !node.attributes.showToc
                  })
                "
              >
                {{ __t('apps.arca.ui', '目录') }}
              </button>
              <button @mousedown.prevent @click="paragraph('quote')">
                {{ __t('apps.arca.ui', '引用段落') }}
              </button>
              <button @mousedown.prevent @click="paragraph('code-block')">
                {{ __t('apps.arca.ui', '代码块') }}
              </button>
            </div>
            <div class="ribbon-group">
              <button @mousedown.prevent @click="attributes({ pageBreakBefore: true })">
                {{ __t('apps.arca.ui', '分页符') }}
              </button>
              <button
                v-if="selected?.attributes.pageBreakBefore"
                @mousedown.prevent
                @click="attributes({ pageBreakBefore: false })"
              >
                {{ __t('apps.arca.ui', '移除分页符') }}
              </button>
            </div>
          </template>
          <template v-else-if="ribbon === 'layout'">
            <div class="ribbon-group">
              <label>
                {{ __t('apps.arca.ui', '纸张') }}
                <ArcaSelect
                  v-model="pageSize"
                  :aria-label="__t('apps.arca.ui', '纸张')"
                  :options="[
                    { value: 'A4', label: 'A4' },
                    { value: 'Letter', label: 'Letter' },
                  ]"
                  @change="pageSettings"
                />
              </label>
              <ArcaSelect
                v-model="orientation"
                :aria-label="__t('apps.arca.ui', '纸张方向')"
                :options="[
                  { value: 'portrait', label: __t('apps.arca.ui', '纵向') },
                  { value: 'landscape', label: __t('apps.arca.ui', '横向') },
                ]"
                @change="pageSettings"
              />
              <label>
                {{ __t('apps.arca.ui', '页边距') }}
                <input
                  v-model.number="margin"
                  type="number"
                  min="5"
                  max="50"
                  @change="pageSettings"
                />
                mm
              </label>
            </div>
            <div class="ribbon-group">
              <label>
                {{ __t('apps.arca.ui', '页眉') }}
                <input
                  v-model="header"
                  class="page-text"
                  :placeholder="__t('apps.arca.ui', '页眉')"
                  @change="pageSettings"
                />
              </label>
              <label>
                {{ __t('apps.arca.ui', '页脚') }}
                <input
                  v-model="footer"
                  class="page-text"
                  :placeholder="__t('apps.arca.ui', '页脚')"
                  @change="pageSettings"
                />
              </label>
              <label>
                <input v-model="pageNumbers" type="checkbox" @change="pageSettings" />
                {{ __t('apps.arca.ui', '页码') }}
              </label>
            </div>
            <div class="ribbon-group">
              <button :disabled="!activeId" @mousedown.prevent @click="move(activeId, -1)">
                {{ __t('apps.arca.ui', '上移') }}
              </button>
              <button :disabled="!activeId" @mousedown.prevent @click="move(activeId, 1)">
                {{ __t('apps.arca.ui', '下移') }}
              </button>
            </div>
          </template>
          <template v-else>
            <div class="ribbon-group">
              <button @mousedown.prevent @click="emit('collaborate', activeId || undefined)">
                <ArcaIcon name="sparkle" :size="16" />
                {{ __t('apps.arca.ui', '协作修改') }}
              </button>
              <button :disabled="!activeId" @mousedown.prevent @click="emit('comment', activeId)">
                <ArcaIcon name="comment" :size="16" />
                {{ __t('apps.arca.ui', '添加评论') }}
              </button>
            </div>
            <div class="ribbon-group">
              <button @click="emit('inspect', 'review')">
                <ArcaIcon name="compare" :size="16" />
                {{ __t('apps.arca.ui', '待审修改') }}
              </button>
              <button @click="emit('inspect', 'revisions')">
                <ArcaIcon name="clock" :size="16" />
                {{ __t('apps.arca.ui', '历史版本') }}
              </button>
              <button @click="emit('inspect', 'activity')">
                {{ __t('apps.arca.ui', '协作活动') }}
              </button>
            </div>
          </template>
          <span class="toolbar-spacer" />
          <div class="ribbon-group">
            <button :disabled="!selected" @click="emit('inspect', 'properties')">
              {{ __t('apps.arca.ui', '属性') }}
            </button>
            <button @click="emit('inspect', 'outline')">
              <ArcaIcon name="panel" :size="16" />
              {{ __t('apps.arca.ui', '大纲') }}
            </button>
            <button
              class="icon-button"
              :title="__t('apps.arca.ui', '查找')"
              :aria-label="__t('apps.arca.ui', '查找')"
              @click="showFind"
            >
              <ArcaIcon name="search" :size="16" />
            </button>
          </div>
        </fieldset>
        <fieldset
          v-if="cell && editable"
          class="table-contextbar"
          :disabled="composing"
          :aria-label="__t('apps.arca.ui', '表格工具')"
        >
          <span>{{ __t('apps.arca.ui', '表格') }}</span>
          <button @mousedown.prevent @click="changeTable('row')">
            {{ __t('apps.arca.ui', '插入行') }}
          </button>
          <button @mousedown.prevent @click="changeTable('column')">
            {{ __t('apps.arca.ui', '插入列') }}
          </button>
          <button @mousedown.prevent @click="changeTable('merge-right')">
            {{ __t('apps.arca.ui', '向右合并') }}
          </button>
          <button @mousedown.prevent @click="changeTable('merge-down')">
            {{ __t('apps.arca.ui', '向下合并') }}
          </button>
          <button @mousedown.prevent @click="changeTable('split')">
            {{ __t('apps.arca.ui', '拆分') }}
          </button>
          <button @mousedown.prevent @click="changeTable('delete-row')">
            {{ __t('apps.arca.ui', '删除行') }}
          </button>
          <button @mousedown.prevent @click="changeTable('delete-column')">
            {{ __t('apps.arca.ui', '删除列') }}
          </button>
        </fieldset>
        <div v-if="findOpen" class="find-bar">
          <input
            ref="findInput"
            v-model="findText"
            type="search"
            :aria-label="__t('apps.arca.ui', '查找（区分大小写）')"
            :placeholder="__t('apps.arca.ui', '查找')"
            @input="searchIndex = 0"
            @keydown.enter.prevent="findNext"
            @keydown.esc.stop="findOpen = false"
          />
          <span>{{ matches.length }} {{ __t('apps.arca.ui', '处') }}</span>
          <button :disabled="!matches.length" @click="findNext">
            {{ __t('apps.arca.ui', '下一处') }}
          </button>
          <template v-if="editable">
            <input
              v-model="replacementText"
              :aria-label="__t('apps.arca.ui', '替换为')"
              :placeholder="__t('apps.arca.ui', '替换为')"
            />
            <button :disabled="!matches.length || composing" @mousedown.prevent @click="replaceAll">
              {{ __t('apps.arca.ui', '全部替换') }}
            </button>
          </template>
          <button
            class="icon-button"
            :aria-label="__t('apps.arca.ui', '关闭查找')"
            @click="findOpen = false"
          >
            <ArcaIcon name="close" :size="16" />
          </button>
        </div>
      </div>
    </Teleport>
    <div v-if="message || session?.error" class="office-message" role="status">
      <span>{{ message || session?.error }}</span>
      <button @click="flush().catch((error) => (message = String(error)))">
        {{ __t('apps.arca.ui', '重试保存') }}
      </button>
      <button @click="reload()">{{ __t('apps.arca.ui', '重新读取') }}</button>
      <button
        class="icon-button"
        :aria-label="__t('apps.arca.ui', '关闭提示')"
        @click="
          () => {
            message = ''
            if (session) session.error = ''
          }
        "
      >
        ×
      </button>
    </div>
    <div
      class="office-scroll"
      :class="{ 'continuous-view': viewMode === 'continuous' }"
      @copy="copySelection"
    >
      <div
        :key="snapshot.documentId"
        class="office-page-frame"
        :style="{ maxWidth: pageStyle.maxWidth, zoom: zoom / 100 }"
      >
        <div
          v-if="viewMode === 'page'"
          class="office-ruler"
          aria-hidden="true"
          :style="{ '--ruler-inset': pageInset + 'px' }"
        >
          <span
            v-for="number in rulerNumbers"
            :key="number"
            :style="{ left: pageInset + (number * 96) / 2.54 + 'px' }"
          >
            {{ number }}
          </span>
        </div>
        <div ref="paperElement" class="office-paper" :style="pageStyle">
          <header v-if="root.attributes.header">{{ root.attributes.header }}</header>
          <h1
            v-if="!hasDocumentTitle"
            class="office-document-title"
            :title="__t('apps.arca.ui', '双击重命名')"
            @dblclick="emit('rename')"
          >
            {{ content.title }}
          </h1>
          <nav v-if="root.attributes.showToc" :aria-label="__t('apps.arca.ui', '文稿目录')">
            <strong>{{ __t('apps.arca.ui', '目录') }}</strong>
            <ol>
              <li
                v-for="heading in headings"
                :key="heading.nodeId"
                :style="{ marginLeft: `${(Number(heading.attributes.level) || 1) - 1}em` }"
              >
                <a :href="`#node-${heading.nodeId}`" @click.prevent="navigate(heading.nodeId)">
                  {{ heading.text || __t('apps.arca.ui', '未命名章节') }}
                </a>
              </li>
            </ol>
          </nav>
          <OfficeBlock
            v-for="node in officeChildren(content, root.nodeId)"
            :key="`${node.nodeId}:${renderEpoch}`"
            :node="node"
            :content="content"
            :writable="editable"
            :selected-id="activeId"
            :assets="assets"
            @input="textInput"
            @key="key"
            @paste="paste"
            @select="selectNode"
            @insert="insert"
            @remove="remove"
            @compose="composition"
            @cut="cut"
            @before="beforeInput"
          />
          <button
            v-if="editable && !officeChildren(content, root.nodeId).length"
            type="button"
            @click="insert()"
          >
            {{ __t('apps.arca.ui', '开始输入正文') }}
          </button>
          <section v-if="references.length" :aria-label="__t('apps.arca.ui', '参考资料与脚注')">
            <h2>{{ __t('apps.arca.ui', '参考资料与脚注') }}</h2>
            <ol>
              <li
                v-for="reference in references"
                :id="`reference-${reference.id}`"
                :key="reference.id"
                :value="reference.number"
              >
                <strong>{{ reference.title }}</strong>
                <a
                  v-if="reference.url && /^https?:\/\//i.test(reference.url)"
                  :href="reference.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ __t('apps.arca.ui', '查看来源') }}
                </a>
                <p v-if="reference.note">{{ reference.note }}</p>
              </li>
            </ol>
          </section>
          <footer v-if="root.attributes.footer">{{ root.attributes.footer }}</footer>
        </div>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      @change="image"
    />
    <Teleport to="body">
      <div
        v-if="selectionPosition && editable && !composing && !linkOpen && !referenceOpen"
        class="selection-toolbar"
        :style="selectionPosition"
        role="toolbar"
        :aria-label="__t('apps.arca.ui', '选中文字工具')"
        @mousedown.prevent
      >
        <button
          :aria-label="__t('apps.arca.ui', '加粗')"
          :aria-pressed="!!currentMarks.bold"
          @click="toggleMark('bold')"
        >
          <b>B</b>
        </button>
        <button
          :aria-label="__t('apps.arca.ui', '斜体')"
          :aria-pressed="!!currentMarks.italic"
          @click="toggleMark('italic')"
        >
          <i>I</i>
        </button>
        <button
          :aria-label="__t('apps.arca.ui', '下划线')"
          :aria-pressed="!!currentMarks.underline"
          @click="toggleMark('underline')"
        >
          <u>U</u>
        </button>
        <button :disabled="!activeId" @click="emit('comment', activeId)">
          {{ __t('apps.arca.ui', '评论') }}
        </button>
        <button @click="emit('collaborate', activeId || undefined)">
          {{ __t('apps.arca.ui', '协作') }}
        </button>
      </div>
    </Teleport>
    <ArcaDialog :open="linkOpen" :title="__t('apps.arca.ui', '链接')" @close="linkOpen = false">
      <form id="office-link" class="form-stack" @submit.prevent="applyLink()">
        <label>
          {{ __t('apps.arca.ui', '地址') }}
          <input v-model="linkValue" placeholder="https://" />
        </label>
        <p v-if="linkError" class="form-error">{{ linkError }}</p>
      </form>
      <template #footer>
        <button @click="applyLink(true)">{{ __t('apps.arca.ui', '移除链接') }}</button>
        <button class="primary-button" type="submit" form="office-link">
          {{ __t('apps.arca.ui', '应用') }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="referenceOpen"
      :title="__t('apps.arca.ui', '引用与脚注')"
      @close="referenceOpen = false"
    >
      <form id="office-reference" class="form-stack" @submit.prevent="addReference">
        <label>
          {{ __t('apps.arca.ui', '标题') }}
          <input v-model="referenceTitle" required />
        </label>
        <label>
          {{ __t('apps.arca.ui', '来源') }}
          <input v-model="referenceUrl" type="url" :placeholder="__t('apps.arca.ui', '可选')" />
        </label>
        <label>
          {{ __t('apps.arca.ui', '脚注') }}
          <textarea v-model="referenceNote" rows="3" :placeholder="__t('apps.arca.ui', '可选')" />
        </label>
        <p v-if="message" class="form-error">{{ message }}</p>
      </form>
      <template #footer>
        <button @click="referenceOpen = false">{{ __t('apps.arca.ui', '取消') }}</button>
        <button
          class="primary-button"
          type="submit"
          form="office-reference"
          :disabled="!referenceTitle.trim()"
        >
          {{ __t('apps.arca.ui', '插入') }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="reloadOpen"
      :title="__t('apps.arca.ui', '重新读取文稿？')"
      @close="reloadOpen = false"
    >
      <p>{{ __t('apps.arca.ui', '当前未保存的草稿将被替换。') }}</p>
      <template #footer>
        <button @click="backup">{{ __t('apps.arca.ui', '备份') }}</button>
        <button @click="reloadOpen = false">{{ __t('apps.arca.ui', '取消') }}</button>
        <button class="danger-button" @click="reload(true)">
          {{ __t('apps.arca.ui', '重新读取') }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="Boolean(previewHtml)"
      :title="__t('apps.arca.ui', '预览')"
      wide
      @close="previewHtml = ''"
    >
      <iframe
        ref="previewFrame"
        class="history-preview"
        :title="__t('apps.arca.ui', '文稿预览')"
        sandbox="allow-same-origin allow-modals"
        :srcdoc="previewHtml"
        @load="previewReady = true"
      />
      <template #footer>
        <button @click="previewHtml = ''">{{ __t('apps.arca.ui', '关闭') }}</button>
        <button class="primary-button" :disabled="!previewReady" @click="printPreview">
          {{ __t('apps.arca.ui', '打印 / PDF') }}
        </button>
      </template>
    </ArcaDialog>
  </section>
</template>

<style scoped>
.office-paper {
  margin: 0 auto;
  width: 100%;
  min-height: 960px;
  border: 1px solid var(--arca-line);
  border-radius: 0;
  background: var(--arca-document);
  box-shadow: var(--arca-shadow-sm);
  color: var(--arca-text);
  line-height: 1.7;
}
.continuous-view .office-paper {
  min-height: calc(100% - 16px);
  border: 0;
  box-shadow: none;
}
.office-paper > header,
.office-paper > footer {
  color: var(--arca-text-soft);
  font-size: 10pt;
}
.office-paper > header {
  padding-bottom: 18px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--arca-line);
}
.office-paper > footer {
  padding-top: 18px;
  margin-top: 40px;
  border-top: 1px solid var(--arca-line);
}
.office-paper > nav {
  margin-bottom: 32px;
  padding: 16px 20px;
  background: var(--arca-surface-soft);
  border-radius: 6px;
  font-size: 13px;
}
.office-paper > nav ol {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.office-paper > nav a {
  display: block;
  padding: 3px 0;
  color: var(--arca-text-soft);
  text-decoration: none;
}
.office-paper > nav a:hover {
  color: var(--arca-mist);
}
.office-paper > section[aria-label] {
  border-top: 1px solid var(--arca-line);
  margin-top: 40px;
  padding-top: 20px;
  font-size: 12px;
}
.office-paper > section[aria-label] h2 {
  font-size: 15px;
}
.office-paper > section[aria-label] a {
  margin-left: 12px;
}
@media (max-width: 720px) {
  .office-paper {
    padding: 28px 38px !important;
    min-width: 280px;
  }
}
</style>
