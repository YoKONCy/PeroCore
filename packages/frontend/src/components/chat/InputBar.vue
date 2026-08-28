<script setup lang="ts">
/**
 * InputBar.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import { attachmentsApi, type AttachmentInfo } from '../../api/modules/attachmentsApi'
import { configApi } from '../../api/modules/configApi'
import { modelApi } from '../../api/modules/modelApi'
import { voiceApi } from '../../api/modules/voiceApi'
import { useAgentStore, useNotificationStore, useThreadStore } from '../../stores'
import {
  threadsApi,
  type FlowStateInfo,
  type ThreadToolSetting,
} from '../../api/modules/threadsApi'
import { toolDisplayColor, toolDisplayIcon } from '../../composables/tools/useToolDisplay'
import { logger } from '../../lib/logger'

/** 可被 @ 的成员候选（group 模式 @ 弹窗数据源）。 */
export interface MentionCandidate {
  agentId: string
  name: string
  avatarUrl?: string
}

interface Props {
  isSending?: boolean
  placeholder?: string
  disabled?: boolean
  /** 窄容器模式：隐藏次要文字并将工具区改为自适应网格。 */
  compact?: boolean
  /** 输入台所处通道；group 模式复用 CHAR OPS 外观但关闭 desktop 专属能力。 */
  channel?: 'desktop' | 'group'
  /** group 模式显示的上下文名称，例如房间名。 */
  contextLabel?: string
  /** group 模式显示的参与者摘要。 */
  participantLabel?: string
  /** group 模式 @ 弹窗的候选成员（当前房间在场的 Agent）。 */
  mentionCandidates?: MentionCandidate[]
  /** @ 弹窗中「全体成员」选项的展示名。 */
  mentionAllLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  isSending: false,
  placeholder: '向角色下达指令或输入 / 打开命令面板…',
  disabled: false,
  compact: false,
  channel: 'desktop',
  contextLabel: '据点房间',
  participantLabel: '群聊成员',
  mentionCandidates: () => [],
  mentionAllLabel: '全体成员',
})

const emit = defineEmits<{
  send: [
    text: string,
    mentions: string[],
    attachmentIds: string[],
    attachments: AttachmentInfo[],
    imageMode: 'auto' | 'native' | 'relay',
    complete: (success: boolean) => void,
  ]
  stop: []
  newThread: []
}>()

interface PendingAttachment extends AttachmentInfo {
  uploadState: 'uploading' | 'success' | 'failed'
  localKey: string
  previewUrl?: string
  error?: string
}

const threadStore = useThreadStore()
const agentStore = useAgentStore()
const notify = useNotificationStore()
const inputText = ref('')
const INPUT_HISTORY_KEY = 'infos:char-ops-input-history'
const INPUT_HISTORY_LIMIT = 100
const inputHistory = ref<string[]>(loadInputHistory())
const historyIndex = ref(inputHistory.value.length)
const historyDraft = ref('')
const pendingAttachments = ref<PendingAttachment[]>([])
const textareaRef = ref<HTMLTextAreaElement | null>(null)
/** @ 内联 chip 的叠加渲染层（group 模式与 textarea 同尺寸叠放）。 */
const overlayRef = ref<HTMLElement | null>(null)
const imageInputRef = ref<HTMLInputElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const commandOpen = ref(false)
const toolOpen = ref(false)
const flowOpen = ref(false)
const flowLoading = ref(false)
const flowClearing = ref(false)
const flowStates = ref<FlowStateInfo[]>([])
const threadTools = ref<ThreadToolSetting[]>([])
const toolsLoading = ref(false)
const toolsSaving = ref(false)
const autoExecuteTools = ref(false)
const toolQuery = ref('')
const imageModeOpen = ref(false)
const imageMode = ref<'auto' | 'native' | 'relay'>('auto')
const relayAvailable = ref(false)
/** 识图方式弹层的触发按钮引用，用于 fixed 定位计算真实坐标（避免被 .deck-tools 的 overflow 裁剪）。 */
const imageModeToggleRef = ref<HTMLElement | null>(null)
/** 识图方式弹层的 fixed 定位样式（相对视口计算）。 */
const imageModePopoverStyle = ref({ left: '0px', bottom: '0px' })

/** 识图方式按钮文案：跟随当前选择实时切换。 */
const imageModeLabel = computed(() => {
  if (imageMode.value === 'native') return '原生多模态'
  if (imageMode.value === 'relay') return '多模态转述'
  return '自动识图'
})

/** 切换识图方式弹层：打开时按触发按钮的真实位置计算 fixed 坐标。 */
function toggleImageModePopover() {
  imageModeOpen.value = !imageModeOpen.value
  if (imageModeOpen.value) {
    nextTick(() => {
      const el = imageModeToggleRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      imageModePopoverStyle.value = {
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 6}px`,
      }
    })
  }
}

/** 选择某个识图方式后：更新模式并收起弹层。 */
function selectImageMode(mode: 'auto' | 'native' | 'relay') {
  imageMode.value = mode
  imageModeOpen.value = false
}

/** 点击弹层与触发按钮以外的区域时收起弹层。 */
function onDocumentClick(event: MouseEvent) {
  if (!imageModeOpen.value) return
  const target = event.target as Node
  if (imageModeToggleRef.value?.contains(target)) return
  const popover = (event.target as HTMLElement).closest?.('.image-mode-popover')
  if (popover) return
  imageModeOpen.value = false
}

const commandQuery = ref('')
const enableVision = ref(false)
const enableAudioInput = ref(false)
const asrAvailable = ref(false)

watch(
  () => [enableVision.value, relayAvailable.value],
  () => {
    // 当前选择的能力变得不可用时自动回退到“自动选择”，避免发送时被拦截。
    if (imageMode.value === 'native' && !enableVision.value) imageMode.value = 'auto'
    if (imageMode.value === 'relay' && !relayAvailable.value) imageMode.value = 'auto'
  },
)
const isRecording = ref(false)
const isTranscribing = ref(false)
const recordingSeconds = ref(0)
let recorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let audioChunks: Blob[] = []

const activeAgent = computed(() => agentStore.currentAgent)
const isGroupChannel = computed(() => props.channel === 'group')
const channelLabel = computed(
  () =>
    ({
      desktop: '桌面会话',
      group: '据点群聊',
      companion: '陪伴会话',
      social: '社交会话',
      work: '工作会话',
    })[props.channel] ?? '当前会话',
)
const successfulAttachments = computed(() =>
  pendingAttachments.value.filter((item) => item.uploadState === 'success'),
)
const hasUploading = computed(() =>
  pendingAttachments.value.some((item) => item.uploadState === 'uploading'),
)
const enabledToolCount = computed(() => threadTools.value.filter((tool) => tool.enabled).length)
const visibleThreadTools = computed(() => {
  const query = toolQuery.value.trim().toLowerCase()
  return threadTools.value.filter(
    (tool) => !query || `${tool.label} ${tool.description}`.toLowerCase().includes(query),
  )
})
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase()
  return commands.value.filter(
    (command) => !query || `${command.label} ${command.keywords}`.toLowerCase().includes(query),
  )
})

async function loadThreadTools(): Promise<void> {
  if (isGroupChannel.value) {
    threadTools.value = []
    return
  }
  if (!threadStore.threadId) {
    threadTools.value = []
    return
  }
  toolsLoading.value = true
  try {
    const response = await threadsApi.getTools(threadStore.threadId)
    threadTools.value = response.data?.tools ?? []
    autoExecuteTools.value = response.data?.autoExecuteTools ?? false
  } catch (error) {
    logger.warn('InputBar', '加载本会话工具配置失败', error)
    threadTools.value = []
  } finally {
    toolsLoading.value = false
  }
}

async function toggleAutoExecute(): Promise<void> {
  if (toolsSaving.value || props.isSending || !threadStore.threadId) return
  const previous = autoExecuteTools.value
  autoExecuteTools.value = !previous
  toolsSaving.value = true
  try {
    const response = await threadsApi.updateExecutionMode(
      threadStore.threadId,
      autoExecuteTools.value,
    )
    autoExecuteTools.value = response.data?.autoExecuteTools ?? autoExecuteTools.value
    notify.toast(autoExecuteTools.value ? '自动执行模式已开启' : '自动执行模式已关闭', {
      type: autoExecuteTools.value ? 'success' : 'info',
    })
  } catch (error) {
    autoExecuteTools.value = previous
    notify.toast(error instanceof Error ? error.message : '保存执行模式失败', { type: 'error' })
  } finally {
    toolsSaving.value = false
  }
}

async function toggleThreadTool(tool: ThreadToolSetting): Promise<void> {
  if (tool.locked) {
    notify.toast(`${tool.label}属于系统协议，始终启用`, { type: 'info' })
    return
  }
  if (toolsSaving.value || props.isSending || !threadStore.threadId) return
  const previous = tool.enabled
  tool.enabled = !previous
  toolsSaving.value = true
  try {
    const disabled = threadTools.value.filter((item) => !item.enabled).map((item) => item.name)
    const response = await threadsApi.updateTools(threadStore.threadId, disabled)
    if (response.data?.tools) threadTools.value = response.data.tools
    notify.toast(`${tool.label}已${tool.enabled ? '启用' : '禁用'}，仅影响本会话`, {
      type: 'success',
    })
  } catch (error) {
    tool.enabled = previous
    notify.toast(error instanceof Error ? error.message : '保存工具配置失败', { type: 'error' })
  } finally {
    toolsSaving.value = false
  }
}

async function toggleToolManager(): Promise<void> {
  toolOpen.value = !toolOpen.value
  if (toolOpen.value) await loadThreadTools()
}

async function loadFlowState(): Promise<void> {
  if (!threadStore.threadId) {
    flowStates.value = []
    return
  }
  flowLoading.value = true
  try {
    const response = await threadsApi.getFlowState(
      threadStore.threadId,
      agentStore.activeAgentId || undefined,
    )
    flowStates.value = response.data ?? []
  } catch (error) {
    logger.warn('InputBar', '加载会话心流失败', error)
    flowStates.value = []
  } finally {
    flowLoading.value = false
  }
}

async function toggleFlowPanel(): Promise<void> {
  flowOpen.value = !flowOpen.value
  if (flowOpen.value) await loadFlowState()
}

async function clearFlowState(agentId: string): Promise<void> {
  if (!threadStore.threadId || flowClearing.value) return
  flowClearing.value = true
  try {
    await threadsApi.clearFlowState(threadStore.threadId, agentId)
    await loadFlowState()
    notify.toast('当前会话心流已清空', { type: 'success' })
  } catch (error) {
    notify.toast(error instanceof Error ? error.message : '清空心流失败', { type: 'error' })
  } finally {
    flowClearing.value = false
  }
}

async function clearWorkContext(agentId: string): Promise<void> {
  if (!threadStore.threadId || flowClearing.value) return
  flowClearing.value = true
  try {
    await threadsApi.clearWorkContext(threadStore.threadId, agentId)
    await loadFlowState()
    notify.toast('工作上下文已清空', { type: 'success' })
  } catch (error) {
    notify.toast(error instanceof Error ? error.message : '清空工作上下文失败', { type: 'error' })
  } finally {
    flowClearing.value = false
  }
}

watch(
  () => props.isSending,
  (sending, previous) => {
    if (previous && !sending && flowOpen.value) void loadFlowState()
  },
)

watch(
  () => threadStore.threadId,
  () => {
    toolOpen.value = false
    flowOpen.value = false
    flowStates.value = []
    toolQuery.value = ''
    void loadThreadTools()
  },
  { immediate: true },
)

/** 命令面板：基础操作 + 动态角色切换（不硬编码任何角色名）。 */
const commands = computed(() => [
  { id: 'new', label: '新会话', hint: '创建当前角色的新会话', keywords: 'new 新建' },
  { id: 'clear', label: '清空输入', hint: '清除尚未发送的文字', keywords: 'clear 清除' },
  { id: 'stop', label: '停止生成', hint: '中止当前回复', keywords: 'stop 停止' },
  ...agentStore.agents.map((agent) => ({
    id: agent.id,
    label: `切换 ${agent.name || agent.id}`,
    hint: '切换到该角色',
    keywords: `agent 角色 ${agent.name || agent.id}`,
  })),
])

async function loadCapabilities(): Promise<void> {
  // 据点群聊当前仅支持文本，不读取 desktop 模型和语音能力。
  if (isGroupChannel.value) return
  try {
    const [mainRes, voiceRes, relayRes] = await Promise.all([
      configApi.get('model.main'),
      voiceApi.getStatus(),
      configApi.batch(['multimodalRelay.enabled', 'multimodalRelay.modelConfigId']),
    ])
    const relayConfig = relayRes.data ?? {}
    relayAvailable.value =
      relayConfig['multimodalRelay.enabled'] === 'true' &&
      Boolean(relayConfig['multimodalRelay.modelConfigId'])
    asrAvailable.value = voiceRes.data?.asr?.available === true
    const mainId = String(mainRes.data?.value ?? '')
    if (!mainId) {
      enableVision.value = false
      enableAudioInput.value = false
      return
    }
    const model = await modelApi.getById(mainId)
    enableVision.value = model.data?.enableVision === true
    enableAudioInput.value = model.data?.enableAudioInput === true
  } catch (error) {
    logger.error('InputBar', '读取输入能力状态失败', error)
  }
}

watch(() => agentStore.activeAgentId, loadCapabilities, { immediate: true })

function onModelCapabilitiesChanged(): void {
  void loadCapabilities()
}

watch(
  () => threadStore.threadId,
  async (_next, previous) => {
    if (previous) await clearPendingAttachments()
  },
)

function loadInputHistory(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const stored = JSON.parse(localStorage.getItem(INPUT_HISTORY_KEY) ?? '[]') as unknown
    if (!Array.isArray(stored)) return []
    return stored
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(-INPUT_HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveInputHistory(text: string): void {
  const normalized = text.trim()
  if (!normalized) return
  inputHistory.value = [...inputHistory.value, normalized].slice(-INPUT_HISTORY_LIMIT)
  historyIndex.value = inputHistory.value.length
  historyDraft.value = ''
  try {
    localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory.value))
  } catch (error) {
    logger.warn('InputBar', '保存本地输入历史失败', error)
  }
}

function showHistory(direction: -1 | 1): void {
  const length = inputHistory.value.length
  if (!length) return
  if (direction === -1) {
    if (historyIndex.value === length) historyDraft.value = inputText.value
    historyIndex.value = Math.max(0, historyIndex.value - 1)
  } else {
    if (historyIndex.value >= length) return
    historyIndex.value += 1
  }
  inputText.value =
    historyIndex.value === length
      ? historyDraft.value
      : (inputHistory.value[historyIndex.value] ?? '')
  mentionOpen.value = false
  nextTick(() => {
    const element = textareaRef.value
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    autoResize()
  })
}

function canNavigateHistory(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing)
    return false
  const element = textareaRef.value
  if (!element || element.selectionStart !== element.selectionEnd) return false
  const caret = element.selectionStart
  if (event.key === 'ArrowUp') return !element.value.slice(0, caret).includes('\n')
  if (event.key === 'ArrowDown') return !element.value.slice(caret).includes('\n')
  return false
}

function autoResize() {
  const element = textareaRef.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`
}

function onKeydown(event: KeyboardEvent) {
  // @ 弹窗打开时优先处理选择导航，避免 Enter 直接发送。
  if (mentionOpen.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeMentionIndex.value = (activeMentionIndex.value + 1) % mentionFiltered.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeMentionIndex.value =
        (activeMentionIndex.value - 1 + mentionFiltered.value.length) % mentionFiltered.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const target = mentionFiltered.value[activeMentionIndex.value]
      if (target) selectMention(target)
      return
    }
    if (event.key === 'Escape') {
      mentionOpen.value = false
      return
    }
  }
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && canNavigateHistory(event)) {
    event.preventDefault()
    showHistory(event.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  } else if (event.key === 'Escape') {
    commandOpen.value = false
    toolOpen.value = false
  }
}

async function ensureThread(): Promise<string> {
  if (!threadStore.threadId) await threadStore.createNewThread(agentStore.activeAgentId, 'desktop')
  return threadStore.threadId
}

function validateFile(file: File): 'image' | 'text' | null {
  const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  const textTypes = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/xml',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
    'text/yaml',
    'text/x-python',
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'text/css',
    'text/x-c',
    'text/x-c++',
    'text/x-java-source',
    'application/sql',
  ])
  if (imageTypes.has(file.type)) {
    if (file.size > 20 * 1024 * 1024) {
      notify.toast('图片不能超过 20MB', { type: 'warning' })
      return null
    }
    return 'image'
  }
  if (textTypes.has(file.type)) {
    if (file.size > 2 * 1024 * 1024) {
      notify.toast('文本附件不能超过 2MB', { type: 'warning' })
      return null
    }
    return 'text'
  }
  notify.toast('暂不支持 PDF 与大文档解析；请选择受支持的图片或 UTF-8 文本文件', {
    type: 'warning',
  })
  return null
}

async function uploadFile(file: File) {
  const kind = validateFile(file)
  if (!kind) return
  // 模型配置可能由设置页或其他窗口刚刚更新；上传前复核权威能力，避免使用陈旧快照。
  if (kind === 'image') await loadCapabilities()
  if (kind === 'image' && !enableVision.value && !relayAvailable.value) {
    notify.toast('主模型不支持视觉，且尚未配置多模态转述模型', { type: 'warning' })
    return
  }
  if (kind === 'image' && imageMode.value === 'native' && !enableVision.value) {
    notify.toast('当前主模型不支持原生识图，请改用多模态转述', { type: 'warning' })
    return
  }
  if (kind === 'image' && imageMode.value === 'relay' && !relayAvailable.value) {
    notify.toast('多模态转述模型尚未配置', { type: 'warning' })
    return
  }
  if (pendingAttachments.value.length >= 5) {
    notify.toast('每轮最多添加 5 个附件', { type: 'warning' })
    return
  }
  const localKey = `${Date.now()}-${Math.random()}`
  const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined
  const pending: PendingAttachment = {
    id: '',
    threadId: '',
    messageId: null,
    kind,
    originalName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    contextPolicy: 'once',
    status: 'uploaded',
    uploadState: 'uploading',
    localKey,
    previewUrl,
  }
  pendingAttachments.value.push(pending)
  try {
    const threadId = await ensureThread()
    const response = await attachmentsApi.upload(file, threadId)
    if (!response.data) throw new Error('服务端未返回附件信息')
    Object.assign(pending, response.data, { uploadState: 'success' })
    pendingAttachments.value = [...pendingAttachments.value]
  } catch (error) {
    pending.uploadState = 'failed'
    pending.error = (error as Error).message
    pendingAttachments.value = [...pendingAttachments.value]
    notify.toast(`附件上传失败：${pending.error}`, { type: 'error' })
  }
}

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) await uploadFile(file)
  input.value = ''
}

async function onPaste(event: ClipboardEvent) {
  // group 通道目前只接收文本，禁止粘贴文件时隐式创建 desktop Thread。
  if (isGroupChannel.value) return
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  for (const file of files) await uploadFile(file)
}

async function removeAttachment(item: PendingAttachment) {
  if (item.id && item.uploadState === 'success') {
    try {
      await attachmentsApi.removeUnbound(item.id)
    } catch (error) {
      notify.toast(`附件删除失败：${(error as Error).message}`, { type: 'error' })
      return
    }
  }
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  pendingAttachments.value = pendingAttachments.value.filter(
    (entry) => entry.localKey !== item.localKey,
  )
}

async function clearPendingAttachments() {
  const items = [...pendingAttachments.value]
  await Promise.allSettled(
    items
      .filter((item) => item.id && item.uploadState === 'success')
      .map((item) => attachmentsApi.removeUnbound(item.id)),
  )
  items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
  pendingAttachments.value = []
}

// ── @ 提及（group 模式）──

/** @ 弹窗是否打开 */
const mentionOpen = ref(false)
/** 光标前 @ 之后的过滤关键词 */
const mentionQuery = ref('')
/** 弹窗内高亮项索引 */
const activeMentionIndex = ref(0)

/** 「全体成员」置顶的候选列表，按名字过滤。 */
const mentionFiltered = computed<MentionCandidate[]>(() => {
  const query = mentionQuery.value.trim().toLowerCase()
  const agents = props.mentionCandidates.filter(
    (candidate) => !query || candidate.name.toLowerCase().includes(query),
  )
  return [{ agentId: '@all', name: props.mentionAllLabel }, ...agents]
})

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 输入事件：检测光标前是否刚键入 @（或处于 @ 查询中），
 * 满足条件则打开成员候选弹窗。
 */
function onTextInput(event: Event) {
  historyIndex.value = inputHistory.value.length
  historyDraft.value = ''
  autoResize()
  if (!isGroupChannel.value) return
  const element = event.target as HTMLTextAreaElement
  const caret = element.selectionStart ?? element.value.length
  const atIndex = element.value.lastIndexOf('@', caret - 1)
  // 弹窗只在「光标前的 @ 是查询串开头、查询串不含 @ 与空格」时打开。
  // 选中 "@名字 " 后查询串含空格，弹窗自动收起，避免持续干扰后续输入。
  const querySegment = atIndex === -1 ? '' : element.value.slice(atIndex + 1, caret)
  const open =
    atIndex !== -1 &&
    (atIndex === 0 || /\s/.test(element.value[atIndex - 1] ?? '')) &&
    !querySegment.includes('@') &&
    !/\s/.test(querySegment)
  if (open) {
    mentionQuery.value = querySegment
    mentionOpen.value = true
    activeMentionIndex.value = 0
  } else {
    mentionOpen.value = false
  }
}

/** 把 overlay 的滚动位置与 textarea 对齐（两者字体/宽度一致）。 */
function syncOverlayScroll() {
  if (!overlayRef.value || !textareaRef.value) return
  overlayRef.value.scrollTop = textareaRef.value.scrollTop
  overlayRef.value.scrollLeft = textareaRef.value.scrollLeft
}

/** 选中候选：把 [@, 光标) 替换为 "@名字 "，光标移到名字之后。 */
function selectMention(candidate: MentionCandidate) {
  const element = textareaRef.value
  if (!element) return
  const text = element.value
  const caret = element.selectionStart ?? text.length
  const atIndex = text.lastIndexOf('@', caret - 1)
  // 兜底：找不到合法 @ 前缀时直接追加到末尾。
  const next =
    atIndex === -1
      ? `${text}@${candidate.name} `
      : `${text.slice(0, atIndex)}@${candidate.name} ${text.slice(caret)}`
  inputText.value = next
  mentionOpen.value = false
  nextTick(() => {
    const position = atIndex === -1 ? next.length : atIndex + candidate.name.length + 2
    element.focus()
    element.setSelectionRange(position, position)
    autoResize()
  })
}

/** @ 按钮：在光标处插入 @ 并打开成员候选弹窗（房间没有候选时禁用）。 */
function openMentionPicker() {
  if (!isGroupChannel.value || props.disabled || props.mentionCandidates.length === 0) return
  const element = textareaRef.value
  if (!element) return
  const caret = element.selectionStart ?? element.value.length
  const text = element.value
  const next = `${text.slice(0, caret)}@${text.slice(caret)}`
  inputText.value = next
  mentionOpen.value = true
  mentionQuery.value = ''
  activeMentionIndex.value = 0
  nextTick(() => {
    element.focus()
    const position = caret + 1
    element.setSelectionRange(position, position)
    autoResize()
  })
}

/** 从文本中解析被 @ 的成员（名字 → agentId；全体成员 → '@all'），去重保序。 */
function resolveMentions(text: string): string[] {
  if (props.mentionCandidates.length === 0) return []
  const allLabel = props.mentionAllLabel
  const byName = new Map(
    props.mentionCandidates.map((candidate) => [candidate.name, candidate.agentId]),
  )
  const tokens = [...byName.keys(), allLabel].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`@(${tokens.map(escapeRegExp).join('|')})`, 'g')
  const found: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const token = match[1]!
    found.push(token === allLabel ? '@all' : (byName.get(token) ?? token))
  }
  return [...new Set(found)]
}

/** overlay 渲染：把 @名字 高亮为内联 chip，其余文本保持原样。 */
const mentionOverlayHtml = computed(() => {
  const text = inputText.value
  if (!text) return ''
  const escaped = escapeHtml(text)
  const names = [...props.mentionCandidates.map((candidate) => candidate.name)]
  if (names.length > 0) names.push(props.mentionAllLabel)
  names.sort((a, b) => b.length - a.length)
  if (names.length === 0) return escaped
  // 后瞻允许空格与常见中英文标点，让「@名字，」这类紧跟标点的提及也能渲染为 chip。
  const pattern = new RegExp(
    `@(${names.map((name) => escapeRegExp(escapeHtml(name))).join('|')})(?=[\\s，。！？；：,.!?;:]|$)`,
    'g',
  )
  return escaped.replace(
    pattern,
    (_all, name: string) => `<span class="mention-chip-inline">@${name}</span>`,
  )
})

function send() {
  const text = inputText.value.trim()
  if ((!text && !successfulAttachments.value.length) || hasUploading.value) return
  const mentions = isGroupChannel.value ? resolveMentions(inputText.value) : []
  const ids = successfulAttachments.value.map((item) => item.id)
  const sentAttachments = [...pendingAttachments.value]
  saveInputHistory(text)
  // 提交给流式管道后立刻清空本地输入，避免等待模型完整回复才更新指挥台。
  inputText.value = ''
  pendingAttachments.value = []
  mentionOpen.value = false
  nextTick(autoResize)
  const resolvedImageMode =
    imageMode.value === 'auto' ? (enableVision.value ? 'native' : 'relay') : imageMode.value
  emit(
    'send',
    text || '请查看本轮附件。',
    mentions,
    ids,
    sentAttachments.map(
      ({
        uploadState: _uploadState,
        localKey: _localKey,
        previewUrl: _previewUrl,
        error: _error,
        ...item
      }) => item,
    ),
    resolvedImageMode,
    (success) => {
      if (!success) {
        // 请求未被服务端接受时恢复待发送内容，便于用户修正后重试。
        inputText.value = text
        pendingAttachments.value = sentAttachments
        return
      }
      sentAttachments.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    },
  )
}

async function executeCommand(id: string) {
  commandOpen.value = false
  commandQuery.value = ''
  if (id === 'new') emit('newThread')
  else if (id === 'clear') inputText.value = ''
  else if (id === 'stop') emit('stop')
  else {
    const target = agentStore.agents.find((agent) => agent.id.toLowerCase() === id)
    if (target) await agentStore.switchAgent(target.id)
    else notify.toast(`未找到角色「${id}」`, { type: 'warning' })
  }
}

async function startAsr() {
  if (!asrAvailable.value) {
    notify.toast('ASR 当前不可用，请先在语音配置中启用并配置服务', { type: 'warning' })
    return
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(mediaStream)
    audioChunks = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) audioChunks.push(event.data)
    }
    recorder.start()
    isRecording.value = true
    recordingSeconds.value = 0
    recordingTimer = setInterval(() => recordingSeconds.value++, 1000)
  } catch (error) {
    notify.toast(`无法使用麦克风：${(error as Error).message}`, { type: 'error' })
    cleanupRecorder()
  }
}

function stopAsr(cancel = false) {
  if (!recorder || recorder.state === 'inactive') return
  const current = recorder
  current.onstop = async () => {
    const blob = new Blob(audioChunks, { type: current.mimeType || 'audio/webm' })
    cleanupRecorder()
    if (cancel) return
    isTranscribing.value = true
    try {
      const result = await voiceApi.recognize(await blob.arrayBuffer(), blob.type)
      const transcript = result.text?.trim()
      if (transcript)
        inputText.value = [inputText.value.trim(), transcript].filter(Boolean).join('\n')
      else notify.toast('未识别到有效语音内容', { type: 'warning' })
      await nextTick(autoResize)
    } catch (error) {
      notify.toast(`语音转写失败：${(error as Error).message}`, { type: 'error' })
    } finally {
      isTranscribing.value = false
    }
  }
  current.stop()
}

function cleanupRecorder() {
  if (recordingTimer) clearInterval(recordingTimer)
  recordingTimer = null
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
  recorder = null
  isRecording.value = false
}

function nativeAudioNotice() {
  notify.toast(
    enableAudioInput.value
      ? '当前 Provider 尚未接入原生音频协议，暂不能发送音频'
      : '当前主模型未声明原生音频输入能力',
    { type: 'warning' },
  )
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

onMounted(() => {
  // 监听全局点击，用于识图方式弹层的点击外部关闭。
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('infos:model-capabilities-changed', onModelCapabilitiesChanged)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('infos:model-capabilities-changed', onModelCapabilitiesChanged)
  cleanupRecorder()
  void clearPendingAttachments()
})

defineExpose({ focus: () => textareaRef.value?.focus(), clearPendingAttachments })
</script>

<template>
  <div class="deck" :class="{ 'deck--sending': isSending, 'deck--compact': compact }">
    <div class="deck-status">
      <span class="deck-brand">CHAR OPS</span>
      <template v-if="isGroupChannel">
        <span class="deck-chip">
          <PixelIcon name="home" size="xs" />
          {{ contextLabel }}
        </span>
        <span class="deck-chip">GROUP</span>
        <span class="deck-chip">
          <PixelIcon name="user" size="xs" />
          {{ participantLabel }}
        </span>
        <span class="deck-chip" :class="{ active: isSending }">
          {{ isSending ? '等待角色回复' : '群聊就绪' }}
        </span>
      </template>
      <template v-else>
        <span class="deck-chip">
          <PixelIcon name="user" size="xs" />
          {{ activeAgent?.name ?? '角色' }}
        </span>
        <span class="deck-chip">DESKTOP</span>
        <span class="deck-chip" :class="{ off: !enableVision }">
          视觉 {{ enableVision ? 'ON' : 'OFF' }}
        </span>
        <span class="deck-chip" :class="{ off: !asrAvailable }">
          ASR {{ asrAvailable ? 'READY' : 'OFF' }}
        </span>
        <span class="deck-chip" :class="{ active: isSending }">
          工具 {{ isSending ? 'BUSY' : 'STANDBY' }}
        </span>
        <button
          class="deck-flow-chip"
          :class="{ active: flowOpen }"
          title="查看当前会话心流"
          @click="toggleFlowPanel"
        >
          <PixelIcon name="thought" size="xs" />
          心流
        </button>
      </template>
    </div>

    <div v-if="!isGroupChannel && pendingAttachments.length" class="attachment-list">
      <article
        v-for="item in pendingAttachments"
        :key="item.localKey"
        class="attachment-card"
        :class="{ 'attachment-card--image': item.previewUrl }"
      >
        <template v-if="item.previewUrl">
          <img :src="item.previewUrl" alt="待发送图片" />
          <span
            class="attachment-image-state"
            :class="`attachment-image-state--${item.uploadState}`"
            :title="
              item.uploadState === 'uploading'
                ? '上传中'
                : item.uploadState === 'success'
                  ? '已就绪'
                  : '上传失败'
            "
          />
        </template>
        <template v-else>
          <PixelIcon name="file" size="md" />
          <div class="attachment-info">
            <strong>{{ item.originalName }}</strong>
            <span>
              {{ formatSize(item.sizeBytes) }} ·
              {{
                item.uploadState === 'uploading'
                  ? '上传中'
                  : item.uploadState === 'success'
                    ? '已就绪'
                    : '上传失败'
              }}
            </span>
          </div>
        </template>
        <button title="取消附件" aria-label="取消附件" @click="removeAttachment(item)">
          <PixelIcon name="close" size="xs" />
        </button>
      </article>
    </div>

    <div class="deck-text-area">
      <!-- group 模式的 @ 内联 chip 叠加层：文字透明 + overlay 高亮渲染 -->
      <div
        v-if="isGroupChannel && inputText"
        ref="overlayRef"
        class="deck-text-overlay"
        v-html="mentionOverlayHtml"
      />
      <textarea
        ref="textareaRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        :class="{ 'deck-textarea-transparent': isGroupChannel }"
        @input="onTextInput"
        @scroll="syncOverlayScroll"
        @keydown="onKeydown"
        @paste="onPaste"
      />

      <!-- @ 候选弹窗（QQ 风格：@全体成员置顶 + 房间成员） -->
      <div v-if="mentionOpen && isGroupChannel" class="deck-popover mention-popover">
        <button
          v-for="(candidate, index) in mentionFiltered"
          :key="candidate.agentId"
          :class="{ active: index === activeMentionIndex }"
          @mousedown.prevent="selectMention(candidate)"
        >
          <span class="mention-avatar">
            <img v-if="candidate.avatarUrl" :src="candidate.avatarUrl" :alt="candidate.name" />
            <PixelIcon v-else :name="candidate.agentId === '@all' ? 'users' : 'user'" size="xs" />
          </span>
          <strong>{{ candidate.name }}</strong>
          <small v-if="candidate.agentId === '@all'">全体成员</small>
        </button>
        <p v-if="!mentionFiltered.length" class="mention-empty">没有匹配的成员</p>
      </div>
    </div>

    <div v-if="!isGroupChannel && (isRecording || isTranscribing)" class="record-strip">
      <template v-if="isRecording">
        <span class="record-dot" />
        正在录音 {{ recordingSeconds }}s
        <button @click="stopAsr(false)">停止并转写</button>
        <button @click="stopAsr(true)">取消</button>
      </template>
      <template v-else>
        <PixelIcon name="refresh" size="xs" animation="spin" />
        正在转写，请稍候…
      </template>
    </div>

    <div class="deck-footer">
      <div v-if="!isGroupChannel" class="deck-tools">
        <button title="命令" @click="commandOpen = !commandOpen">
          <PixelIcon name="terminal" size="xs" class="deck-tool-icon" />
          <span class="pixel-label">/ CMD</span>
        </button>
        <div class="image-mode-control">
          <!-- 识图方式按钮永远可点击；即使能力未配置，也应允许用户打开菜单查看原因。 -->
          <button
            ref="imageModeToggleRef"
            class="image-mode-selector"
            title="选择识图方式"
            @click.stop="toggleImageModePopover"
          >
            <PixelIcon name="image" size="xs" />
            {{ imageModeLabel }}
            <span class="image-mode-chevron">⌄</span>
          </button>
          <!-- 添加图片是独立动作，只有没有任何识图能力时才禁用。 -->
          <button
            class="image-add-button"
            :disabled="!enableVision && !relayAvailable"
            :title="enableVision || relayAvailable ? '添加图片' : '没有可用的识图模型'"
            @click="imageInputRef?.click()"
          >
            <PixelIcon name="plus" size="xs" />
            <span>添加图片</span>
          </button>
          <Teleport to="body">
            <div
              v-if="imageModeOpen"
              class="deck-popover image-mode-popover"
              :style="imageModePopoverStyle"
              @click.stop
            >
              <strong>识图方式</strong>
              <button
                v-for="option in [
                  {
                    value: 'auto',
                    label: '自动选择',
                    hint: enableVision
                      ? '优先主模型原生识图'
                      : relayAvailable
                        ? '使用多模态转述'
                        : '暂无可用能力',
                  },
                  {
                    value: 'native',
                    label: '原生多模态',
                    hint: enableVision ? '当前可用' : '当前模型不支持',
                  },
                  {
                    value: 'relay',
                    label: '多模态转述',
                    hint: relayAvailable ? '当前可用' : '尚未配置',
                  },
                ]"
                :key="option.value"
                :disabled="
                  (option.value === 'native' && !enableVision) ||
                  (option.value === 'relay' && !relayAvailable)
                "
                @click="selectImageMode(option.value as 'auto' | 'native' | 'relay')"
              >
                <span>{{ imageMode === option.value ? '✓' : '·' }} {{ option.label }}</span>
                <small>{{ option.hint }}</small>
              </button>
            </div>
          </Teleport>
        </div>
        <button title="添加文本文件" @click="fileInputRef?.click()">
          <PixelIcon name="file" size="xs" />
          文件
        </button>
        <button
          :disabled="isRecording || isTranscribing"
          title="录音并转写到输入框"
          @click="startAsr"
        >
          <PixelIcon name="volume" size="xs" />
          语音转写
        </button>
        <button
          :class="{ reserved: enableAudioInput }"
          title="原生音频输入"
          @click="nativeAudioNotice"
        >
          <PixelIcon name="radio" size="xs" />
          原生音频
        </button>
        <button
          title="管理本会话可用工具"
          :class="{ reserved: toolOpen }"
          @click="toggleToolManager"
        >
          <PixelIcon name="tool" size="xs" />
          会话工具
          <span v-if="threadTools.length" class="tool-count">
            {{ enabledToolCount }}/{{ threadTools.length }}
          </span>
        </button>
      </div>
      <div v-else-if="isGroupChannel" class="group-footer-tools">
        <button
          class="mention-btn"
          :disabled="disabled || !mentionCandidates.length"
          title="提及成员：在当前光标处插入 @"
          @click="openMentionPicker"
        >
          <span class="mention-btn-at">@</span>
          <span>提及</span>
        </button>
      </div>
      <button v-if="isSending && !isGroupChannel" class="stop-btn" @click="emit('stop')">
        <PixelIcon name="square" size="xs" />
        停止
      </button>
      <button
        v-else
        class="send-btn"
        :disabled="
          disabled ||
          isSending ||
          hasUploading ||
          (!inputText.trim() && !successfulAttachments.length)
        "
        @click="send"
      >
        <PixelIcon name="send" size="sm" />
        <span>发送</span>
      </button>
    </div>

    <div v-if="commandOpen" class="deck-popover command-popover">
      <input v-model="commandQuery" autofocus placeholder="搜索命令…" />
      <button
        v-for="command in filteredCommands"
        :key="command.id"
        @click="executeCommand(command.id)"
      >
        <strong>/ {{ command.label }}</strong>
        <span>{{ command.hint }}</span>
      </button>
      <p v-if="!filteredCommands.length">没有匹配的命令</p>
    </div>

    <div v-if="flowOpen" class="deck-popover flow-popover">
      <header class="flow-panel__head">
        <div>
          <strong>私有临时心流</strong>
          <span>当前会话 · Agent 自维护</span>
        </div>
        <div class="flow-panel__actions">
          <button title="刷新心流" :disabled="flowLoading" @click="loadFlowState">
            <PixelIcon name="refresh" size="xs" :animation="flowLoading ? 'spin' : undefined" />
          </button>
          <button title="收起心流" @click="flowOpen = false">
            <PixelIcon name="chevron-down" size="xs" />
          </button>
        </div>
      </header>
      <div v-if="flowLoading && !flowStates.length" class="flow-panel__empty">
        <PixelIcon name="refresh" size="xs" animation="spin" />
        正在读取心流…
      </div>
      <div v-else-if="!flowStates.length" class="flow-panel__empty">当前会话还没有心流</div>
      <article v-for="state in flowStates" v-else :key="state.agentId" class="flow-state-card">
        <header>
          <span>
            {{
              agentStore.agents.find((agent) => agent.id === state.agentId)?.name ?? state.agentId
            }}
          </span>
          <b>REV.{{ state.revision }}</b>
        </header>
        <section>
          <small>当前目标</small>
          <p>{{ state.currentGoal || '暂无明确的持续目标。' }}</p>
        </section>
        <section class="flow-state-card__private">
          <small>私有事实</small>
          <p>{{ state.privateFacts || '暂无需要私下持续记住的事实。' }}</p>
        </section>
        <section class="flow-state-card__work">
          <small>工作上下文</small>
          <p>{{ state.workContext || '暂无工作上下文。' }}</p>
          <div class="flow-work-meta">
            <span v-if="state.workContext">剩余 {{ state.workContextRemainingPairs }} 轮</span>
            <button
              :disabled="flowClearing || !state.workContext"
              @click="clearWorkContext(state.agentId)"
            >
              <PixelIcon name="trash" size="xs" />
              清空工作上下文
            </button>
          </div>
        </section>
        <footer>
          <time>{{ state.updatedAt ? `更新于 ${state.updatedAt}` : '尚未更新' }}</time>
          <button
            :disabled="flowClearing || (!state.currentGoal && !state.privateFacts)"
            @click="clearFlowState(state.agentId)"
          >
            <PixelIcon name="trash" size="xs" />
            清空
          </button>
        </footer>
      </article>
      <p class="flow-panel__notice">
        心流与工作上下文都不会写入聊天记录或长期记忆；工作上下文会按配置轮次强制清空。
      </p>
    </div>

    <div v-if="toolOpen" class="deck-popover tool-popover">
      <header class="tool-manager__head">
        <div>
          <strong>本会话工具</strong>
          <span>{{ channelLabel }}</span>
        </div>
        <b>{{ enabledToolCount }}/{{ threadTools.length }} 启用</b>
      </header>
      <button
        class="tool-manager__auto"
        :class="{ 'is-active': autoExecuteTools }"
        :disabled="toolsSaving || isSending"
        type="button"
        @click="toggleAutoExecute"
      >
        <span class="tool-manager__auto-icon">
          <PixelIcon name="flash" size="xs" />
        </span>
        <span>
          <strong>自动执行</strong>
          <small>普通工具直接运行；三个终端入口与工作区外删除仍需确认</small>
        </span>
        <b>{{ autoExecuteTools ? 'ON' : 'OFF' }}</b>
        <i><em /></i>
      </button>
      <p class="tool-manager__notice">
        你可以决定本次会话允许助手使用哪些功能。关闭某项功能后，助手在本会话中将无法使用它；带“系统必需”标记的功能不能关闭。
      </p>
      <label class="tool-manager__search">
        <PixelIcon name="search" size="xs" />
        <input v-model="toolQuery" placeholder="搜索功能名称或用途…" />
      </label>
      <div class="tool-manager__list">
        <div v-if="toolsLoading" class="tool-manager__empty">
          <PixelIcon name="refresh" size="xs" animation="spin" />
          正在加载工具权限…
        </div>
        <button
          v-for="tool in visibleThreadTools"
          v-else
          :key="tool.name"
          class="tool-manager__item"
          :class="{ 'is-enabled': tool.enabled, 'is-locked': tool.locked }"
          :disabled="toolsSaving || isSending"
          @click="toggleThreadTool(tool)"
        >
          <span class="tool-manager__icon" :style="{ color: toolDisplayColor(tool.display) }">
            <PixelIcon :name="toolDisplayIcon(tool.display)" size="xs" />
          </span>
          <span class="tool-manager__meta">
            <strong>{{ tool.label }}</strong>
            <small>{{ tool.description }}</small>
            <span class="tool-manager__tooltip" role="tooltip">
              <b>{{ tool.label }}</b>
              <span>{{ tool.description || '暂无工具介绍' }}</span>
            </span>
          </span>
          <span v-if="tool.locked" class="tool-manager__protocol">系统必需</span>
          <span
            v-else
            class="tool-manager__switch"
            :aria-label="tool.enabled ? '已启用' : '已禁用'"
          >
            <i />
          </span>
        </button>
        <div v-if="!toolsLoading && !visibleThreadTools.length" class="tool-manager__empty">
          当前会话没有匹配的功能。
        </div>
      </div>
      <footer v-if="isSending">助手工作期间暂不能修改功能设置</footer>
    </div>

    <input
      ref="imageInputRef"
      hidden
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      @change="handleFiles"
    />
    <input ref="fileInputRef" hidden type="file" multiple @change="handleFiles" />
  </div>
</template>

<style scoped>
.deck {
  position: relative;
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-md);
  box-shadow: var(--ui-shadow-md);
  transition: 0.2s;
}
.deck:focus-within,
.deck--sending {
  border-color: var(--ui-accent-primary);
  box-shadow: var(--ui-shadow-md), var(--ui-glow-pink);
}
.deck-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  white-space: nowrap;
}
.deck-brand,
.pixel-label {
  font-family: var(--font-pixel);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: var(--ui-accent-primary);
}
.deck-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 2px;
  color: var(--ui-success);
  font: 800 9px var(--font-mono);
}
.deck-flow-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid var(--ui-accent-purple);
  border-radius: 2px;
  background: transparent;
  color: var(--ui-accent-purple);
  font: 800 9px var(--font-mono);
  cursor: pointer;
}
.deck-flow-chip:hover,
.deck-flow-chip.active {
  background: var(--ui-accent-purple-soft);
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-accent-purple) 18%, transparent);
}
.deck-chip.off {
  color: var(--ui-text-disabled);
}
.deck-chip.active {
  color: var(--ui-accent-primary);
  animation: pulse 1s infinite;
}
.deck textarea {
  display: block;
  width: 100%;
  min-height: 60px;
  max-height: 180px;
  padding: 14px 16px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-primary);
  font: 500 14px/1.6 var(--font-sans);
}
/* ── @ 提及：输入区叠加层（group 模式） ── */
.deck-text-area {
  position: relative;
}
.deck-text-overlay {
  position: absolute;
  inset: 0;
  padding: 14px 16px;
  overflow: hidden;
  pointer-events: none;
  color: var(--ui-text-primary);
  font: 500 14px/1.6 var(--font-sans);
  white-space: pre-wrap;
  word-break: break-word;
}
/* 文字透明 + 光标可见 + 隐藏滚动条，保证与 overlay 宽度/换行一致 */
.deck-textarea-transparent {
  color: transparent;
  caret-color: var(--ui-text-primary);
  scrollbar-width: none;
  word-break: break-word;
}
.deck-textarea-transparent::-webkit-scrollbar {
  display: none;
}
.deck-textarea-transparent::placeholder {
  color: var(--ui-text-disabled);
}
.mention-chip-inline {
  display: inline;
  padding: 1px 4px;
  margin: 0 1px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-primary) 40%, transparent);
  background: var(--ui-accent-primary-soft);
  color: var(--ui-accent-primary);
  font-weight: 800;
}
.mention-popover {
  left: 10px;
  bottom: 48px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 30;
}
.mention-popover button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: transparent;
  color: var(--ui-text-primary);
  text-align: left;
  font-size: 12px;
}
.mention-popover button:hover,
.mention-popover button.active {
  background: var(--ui-bg-hover);
}
.mention-popover small {
  margin-left: auto;
  font-size: 9px;
  color: var(--ui-text-tertiary);
}
.mention-avatar {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ui-accent-primary-soft);
  color: var(--ui-accent-primary);
  overflow: hidden;
}
.mention-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mention-empty {
  margin: 0;
  padding: 8px;
  font-size: 10px;
  color: var(--ui-text-tertiary);
}
.attachment-list {
  display: flex;
  gap: 8px;
  padding: 10px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.attachment-card {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(110px, 180px) 20px;
  align-items: center;
  gap: 8px;
  padding: 7px;
  background: var(--ui-bg-surface-soft);
  border: 1px solid var(--ui-border-subtle);
  border-radius: 4px;
}
.attachment-card--image {
  display: block;
  width: 84px;
  height: 84px;
  flex: 0 0 84px;
  padding: 4px;
  background:
    linear-gradient(var(--ui-bg-surface), var(--ui-bg-surface)) padding-box,
    linear-gradient(135deg, var(--ui-accent-sky), var(--ui-accent-purple), var(--ui-accent-primary))
      border-box;
  border: 2px solid transparent;
  border-radius: 12px 5px 12px 5px;
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ui-accent-sky) 20%, transparent);
  transform: rotate(-0.5deg);
}
.attachment-card img {
  width: 42px;
  height: 42px;
  object-fit: cover;
}
.attachment-card--image img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 8px 3px 8px 3px;
}
.attachment-info {
  min-width: 0;
}
.attachment-info strong,
.attachment-info span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-info strong {
  font-size: 11px;
  color: var(--ui-text-primary);
}
.attachment-info span {
  font-size: 9px;
  color: var(--ui-text-tertiary);
}
button {
  cursor: pointer;
}
.attachment-card button {
  border: 0;
  background: none;
  color: var(--ui-text-tertiary);
}
.attachment-card--image button {
  position: absolute;
  top: -7px;
  right: -7px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 42%, var(--ui-border-default));
  border-radius: 50%;
  background: var(--ui-bg-elevated);
  box-shadow: 0 3px 8px color-mix(in srgb, var(--ui-accent-purple) 20%, transparent);
  color: var(--ui-text-primary);
}
.attachment-image-state {
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-bg-surface);
  border-radius: 50%;
  background: var(--ui-success, #4cc38a);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--ui-text-primary) 25%, transparent);
}
.attachment-image-state--uploading {
  background: var(--ui-accent-sky);
  animation: attachment-state-pulse 0.9s ease-in-out infinite alternate;
}
.attachment-image-state--failed {
  background: var(--ui-danger, #ef5b72);
}
@keyframes attachment-state-pulse {
  to {
    opacity: 0.45;
    transform: scale(0.72);
  }
}
.deck-footer {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--ui-border-subtle);
}
.deck-tools {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
}
.image-mode-control {
  position: relative;
  display: inline-flex;
}

.image-mode-chevron {
  margin-left: 2px;
  color: var(--ui-text-muted);
}

.deck-tools .image-add-button {
  border-left: 0;
}

.image-mode-popover {
  /* Teleport 到 body 后彻底脱离 .deck-tools 的 overflow 裁剪上下文。 */
  position: fixed;
  z-index: 1000;
  width: 250px;
  padding: 8px;
}

.image-mode-popover > strong {
  display: block;
  padding: 4px 8px 8px;
  color: var(--ui-text-primary);
  font-size: 11px;
}

.image-mode-popover button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 38px;
  padding: 8px;
  border: 0;
  border-top: 1px solid var(--ui-border-subtle);
  background: transparent;
  color: var(--ui-text-primary);
  cursor: pointer;
}

.image-mode-popover button:hover:not(:disabled) {
  background: var(--ui-bg-hover);
}

.image-mode-popover button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.image-mode-popover small {
  color: var(--ui-text-muted);
}

.deck-tools button,
.stop-btn,
.send-btn,
.record-strip button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 30px;
  padding: 0 8px;
  white-space: nowrap;
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
  border: 1px solid var(--ui-border-subtle);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}
.deck-tools button:hover:not(:disabled) {
  color: var(--ui-accent-primary);
  border-color: var(--ui-accent-primary);
}
.deck-tools button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.deck-tools .reserved {
  color: var(--ui-accent-purple);
}
/* 据点群聊的 @ 提及按钮：品牌色描边，突出 @ 符号 */
.group-footer-tools {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.mention-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 10px;
  white-space: nowrap;
  background: var(--ui-bg-surface);
  color: var(--ui-accent-primary);
  border: 1px solid var(--ui-accent-primary);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 800;
  transition: all var(--ui-duration-fast);
}
.mention-btn:hover:not(:disabled) {
  background: var(--ui-accent-primary-soft);
  box-shadow: var(--ui-glow-pink);
}
.mention-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.mention-btn-at {
  font-family: var(--font-pixel), monospace;
  font-size: 13px;
  line-height: 1;
}
[data-theme='dark'] .mention-btn {
  border-color: var(--ui-accent-purple);
  color: var(--ui-accent-purple);
}
[data-theme='dark'] .mention-btn:hover:not(:disabled) {
  background: var(--ui-accent-purple-soft);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
}
.send-btn {
  background: var(--ui-accent-primary);
  border-color: var(--ui-accent-primary);
  color: #fff;
}
.send-btn:disabled {
  opacity: 0.4;
}
.stop-btn {
  border-color: var(--ui-danger);
  background: var(--ui-danger);
  color: #fff;
}
.record-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--ui-accent-red-soft);
  color: var(--ui-danger);
  font-size: 11px;
}
.record-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-danger);
  animation: pulse 1s infinite;
}
.flow-popover {
  width: min(430px, calc(100% - 20px));
  padding: 0;
  overflow: hidden;
  border-top: 3px solid var(--ui-accent-purple);
}
.flow-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-accent-purple-soft);
}
.flow-panel__head > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.flow-panel__head strong {
  color: var(--ui-text-primary);
  font-size: 12px;
}
.flow-panel__head span {
  color: var(--ui-text-tertiary);
  font: 800 8px var(--ui-font-mono);
}
.flow-panel__actions {
  display: flex;
  align-items: center;
  gap: 5px;
}
.flow-panel__actions > button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg-surface);
  color: var(--ui-accent-purple);
  cursor: pointer;
}
.flow-panel__actions > button:hover:not(:disabled) {
  border-color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
}
.flow-panel__actions > button:focus-visible {
  outline: 2px solid var(--ui-accent-primary);
  outline-offset: 2px;
}
.flow-panel__actions > button:disabled {
  opacity: 0.5;
  cursor: default;
}
.flow-panel__empty {
  display: flex;
  min-height: 90px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.flow-state-card {
  margin: 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  box-shadow: 3px 3px 0 var(--ui-border-subtle);
}
.flow-state-card > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-bottom: 1px solid var(--ui-border-default);
}
.flow-state-card > header span {
  color: var(--ui-accent-purple);
  font: 900 9px var(--ui-font-mono);
}
.flow-state-card > header b {
  color: var(--ui-text-disabled);
  font: 800 8px var(--ui-font-mono);
}
.flow-state-card section {
  padding: 9px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.flow-state-card section small {
  display: block;
  margin-bottom: 5px;
  color: var(--ui-accent-sky);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.flow-state-card__private small {
  color: var(--ui-accent-purple) !important;
}
.flow-state-card section p {
  max-height: 110px;
  margin: 0;
  overflow: auto;
  color: var(--ui-text-secondary);
  font-size: 10px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.flow-state-card__work {
  border-left: 3px solid #8b5cf6;
  background: color-mix(in srgb, #8b5cf6 7%, var(--ui-bg-elevated));
}

.flow-work-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 10px;
  color: var(--ui-text-tertiary);
}

.flow-work-meta button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ui-accent-purple, #8b5cf6);
}
.flow-state-card > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  background: var(--ui-bg-surface-soft);
}
.flow-state-card time {
  color: var(--ui-text-disabled);
  font: 7px var(--ui-font-mono);
}
.flow-state-card footer button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: 1px solid var(--ui-danger);
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
  font-size: 8px;
  font-weight: 800;
  cursor: pointer;
}
.flow-state-card footer button:disabled {
  opacity: 0.4;
  cursor: default;
}
.flow-panel__notice {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--ui-warning);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font-size: 8px;
}
:global([data-theme='dark']) .flow-state-card {
  background: color-mix(in srgb, var(--ui-accent-purple) 5%, var(--ui-bg-elevated));
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.36);
}

.deck-popover {
  position: absolute;
  z-index: 20;
  bottom: 50px;
  width: min(360px, calc(100% - 20px));
  padding: 8px;
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-default);
  border-radius: 4px;
  box-shadow: var(--ui-shadow-lg);
}
.command-popover {
  left: 10px;
}
.command-popover input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
  outline: none;
}
.command-popover button {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 8px;
  border: 0;
  border-bottom: 1px solid var(--ui-border-subtle);
  text-align: left;
  background: transparent;
  color: var(--ui-text-primary);
}
.command-popover button:hover {
  background: var(--ui-bg-hover);
}
.command-popover span,
.deck-popover p {
  font-size: 10px;
  color: var(--ui-text-tertiary);
}
.tool-count {
  margin-left: 2px;
  padding-left: 6px;
  border-left: 1px solid var(--ui-border-default);
  color: var(--ui-text-tertiary);
  font: 800 8px var(--ui-font-mono);
}
.tool-popover {
  right: 10px;
  width: min(430px, calc(100% - 20px));
  max-height: min(520px, 70vh);
  overflow: hidden;
  padding: 0;
  border-radius: 0;
}
.tool-manager__head {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
}
.tool-manager__head div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tool-manager__head strong {
  color: var(--ui-text-primary);
  font-size: 11px;
}
.tool-manager__head span {
  color: var(--ui-text-tertiary);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.tool-manager__head b {
  color: var(--ui-accent-primary);
  font: 800 9px var(--ui-font-mono);
}
.tool-manager__auto {
  display: grid;
  width: calc(100% - 16px);
  min-height: 54px;
  grid-template-columns: 28px minmax(0, 1fr) auto 32px;
  align-items: center;
  gap: 8px;
  margin: 8px;
  padding: 7px 8px;
  border: 1px solid var(--ui-border-default);
  border-left: 3px solid var(--ui-text-disabled);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
  text-align: left;
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-text-primary) 8%, transparent);
  cursor: pointer;
  transition: 0.14s steps(3, end);
}
.tool-manager__auto:hover:not(:disabled) {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ui-accent-sky) 18%, transparent);
}
.tool-manager__auto:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.tool-manager__auto > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.tool-manager__auto strong {
  font-size: 10px;
}
.tool-manager__auto small {
  color: var(--ui-text-tertiary);
  font-size: 9px;
  line-height: 1.35;
}
.tool-manager__auto-icon {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid var(--ui-border-strong);
  color: var(--ui-text-tertiary);
}
.tool-manager__auto > b {
  color: var(--ui-text-tertiary);
  font: 900 9px var(--ui-font-mono);
}
.tool-manager__auto > i {
  position: relative;
  width: 30px;
  height: 16px;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-bg-primary);
}
.tool-manager__auto > i em {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  background: var(--ui-text-disabled);
  transition: transform 0.14s steps(3, end);
}
.tool-manager__auto.is-active {
  border-color: color-mix(in srgb, var(--ui-accent-sky) 55%, var(--ui-border-default));
  border-left-color: var(--ui-accent-sky);
  background: color-mix(in srgb, var(--ui-accent-sky) 8%, var(--ui-bg-elevated));
}
.tool-manager__auto.is-active .tool-manager__auto-icon,
.tool-manager__auto.is-active > b {
  border-color: var(--ui-accent-sky);
  color: var(--ui-accent-sky);
}
.tool-manager__auto.is-active > i {
  border-color: var(--ui-accent-sky);
  background: color-mix(in srgb, var(--ui-accent-sky) 15%, var(--ui-bg-primary));
}
.tool-manager__auto.is-active > i em {
  background: var(--ui-accent-sky);
  transform: translateX(14px);
}
.tool-manager__notice {
  margin: 0 !important;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  line-height: 1.5;
}
.tool-manager__search {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border-bottom: 1px solid var(--ui-border-default);
  color: var(--ui-text-tertiary);
}
.tool-manager__search:focus-within {
  box-shadow: inset 2px 0 0 var(--ui-accent-primary);
}
.tool-manager__search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-primary);
  font-size: 10px;
}
.tool-manager__list {
  max-height: 350px;
  overflow: auto;
}
.tool-manager__item {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 48px;
  grid-template-columns: 30px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  border: 0;
  border-bottom: 1px solid var(--ui-border-subtle);
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.tool-manager__item:hover {
  border-left-color: var(--ui-text-disabled);
  background: var(--ui-bg-hover);
}
.tool-manager__item.is-enabled {
  border-left-color: var(--ui-accent-primary);
}
.tool-manager__item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.tool-manager__icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid currentColor;
}
.tool-manager__meta {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.tool-manager__meta strong {
  color: var(--ui-text-primary);
  font-size: 10px;
}
.tool-manager__meta small {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font-size: 9px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-manager__tooltip {
  display: none;
  margin-top: 5px;
  padding: 7px 8px;
  border: 1px solid var(--ui-border-default);
  border-left: 2px solid var(--ui-accent-primary);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-secondary);
  font-size: 9px;
  line-height: 1.55;
  white-space: normal;
}
.tool-manager__tooltip b {
  display: block;
  margin-bottom: 3px;
  color: var(--ui-text-primary);
  font-size: 9px;
}
.tool-manager__tooltip span {
  display: block;
}
.tool-manager__item:hover .tool-manager__tooltip,
.tool-manager__item:focus-visible .tool-manager__tooltip {
  display: block;
}
.tool-manager__item:hover .tool-manager__meta > small,
.tool-manager__item:focus-visible .tool-manager__meta > small {
  display: none;
}
.tool-manager__item.is-locked {
  cursor: default;
  border-left-color: var(--ui-success);
}
.tool-manager__protocol {
  display: grid;
  min-width: 52px;
  height: 18px;
  padding: 0 5px;
  place-items: center;
  border: 1px solid var(--ui-success);
  color: var(--ui-success);
  font: 800 8px var(--ui-font-mono);
  letter-spacing: 0.06em;
}
.tool-manager__switch {
  position: relative;
  width: 30px;
  height: 16px;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-bg-surface-soft);
}
.tool-manager__switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  background: var(--ui-text-disabled);
  transition:
    transform var(--ui-duration-fast),
    background var(--ui-duration-fast);
}
.is-enabled .tool-manager__switch {
  border-color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
}
.is-enabled .tool-manager__switch i {
  background: var(--ui-accent-primary);
  transform: translateX(14px);
}
.tool-manager__empty {
  display: flex;
  min-height: 80px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 12px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.tool-popover > footer {
  min-height: 28px;
  padding: 0 9px;
  border-top: 1px solid var(--ui-warning);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font: 800 8px/28px var(--ui-font-mono);
  letter-spacing: 0.06em;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
.deck--compact .deck-status {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  overflow-x: hidden;
  scrollbar-width: none;
}
.deck--compact .deck-status::-webkit-scrollbar,
.deck--compact .deck-tools::-webkit-scrollbar {
  display: none;
}
/* 紧凑下只保留「品牌 + Agent + 工具状态」，隐藏 DESKTOP/视觉/ASR 次要状态 */
.deck--compact .deck-status .deck-chip:nth-of-type(3),
.deck--compact .deck-status .deck-chip:nth-of-type(4),
.deck--compact .deck-status .deck-chip:nth-of-type(5) {
  display: none;
}
.deck--compact .deck-status .deck-chip {
  min-width: 0;
  max-width: 132px;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}
.deck--compact .deck-status .deck-chip:last-child {
  margin-left: auto;
}
.deck--compact .deck-footer {
  align-items: flex-end;
}
/* 紧凑模式下 footer 仍保持同一条基线，避免会话工具计数把按钮顶偏。 */
.deck--compact .deck-footer {
  align-items: center;
}
.deck--compact .deck-tools {
  align-items: center;
}
/* ── 紧凑模式：等宽图标按钮，自然换行，不拉伸、不横向滚动 ── */
.deck--compact .deck-tools {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
  overflow: visible;
}
/* / CMD 在紧凑下只显示图标 */
.deck-tool-icon {
  display: none;
}
.deck--compact .deck-tool-icon {
  display: inline-flex;
}
.deck--compact .pixel-label {
  display: none;
}
/* 工具按钮统一收窄为 30px 等宽图标钮 */
.deck--compact .deck-tools > button,
.deck--compact .deck-tools .image-mode-selector,
.deck--compact .deck-tools .image-add-button {
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  justify-content: center;
  font-size: 0;
  overflow: visible;
  white-space: nowrap;
}
.deck--compact .deck-tools > button {
  position: relative;
}
.deck--compact .deck-tools > button .tool-count {
  position: absolute;
  right: -3px;
  bottom: -5px;
  margin: 0;
  padding: 1px 2px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  color: var(--ui-accent-primary);
  font-size: 7px;
  line-height: 1;
  letter-spacing: -0.04em;
  transform: scale(0.82);
  transform-origin: right bottom;
}
/* 识图组合拆成两个独立图标钮，避免整体撑宽 */
.deck--compact .deck-tools > .image-mode-control {
  display: inline-flex;
  width: auto;
  min-width: 0;
  gap: 4px;
}
.deck--compact .image-add-button {
  border-left: 1px solid var(--ui-border-subtle);
}
.deck--compact .deck-tools button :deep(.pixel-icon) {
  flex-shrink: 0;
  font-size: initial;
}
.deck--compact .image-mode-chevron {
  display: none;
}
.deck--compact .send-btn {
  width: 34px;
  min-width: 34px;
  padding: 0;
  justify-content: center;
}
.deck--compact .send-btn span {
  display: none;
}

@media (max-width: 700px) {
  .deck-status {
    padding: 6px;
  }
  .deck-footer {
    align-items: flex-end;
  }
  .deck-tools button {
    padding: 0 6px;
  }
  .deck-tools button:not(:first-child) {
    font-size: 0;
  }
  .deck-tools button :deep(.pixel-icon) {
    font-size: initial;
  }
  .send-btn span {
    display: none;
  }
}
[data-theme='dark'] .deck {
  background: rgba(30, 27, 45, 0.92);
  border-color: rgba(139, 92, 246, 0.25);
}
</style>
