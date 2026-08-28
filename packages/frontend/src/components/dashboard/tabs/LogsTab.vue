<script setup lang="ts">
/**
 * LogsTab — 对话日志 Tab (F1-3)
 *
 * 对标 v1 气泡式聊天 UI：
 * - 工具栏 PCard (Agent选择/来源筛选/日期/排序)
 * - 会话列表 → 点击展开为气泡对话视图
 * - 头像 + 角色标签 + 消息气泡 + hover 装饰
 */
import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PButton, PEmpty, PCard, PDialog } from '../../pixel'
import { threadsApi } from '../../../api/modules/threadsApi'
import { strongholdApi } from '../../../api/modules/strongholdApi'
import type { ThreadInfo, ThreadMessageInfo } from '../../../api/modules/threadsApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { useConversationRewind } from '../../../composables/chat/useConversationRewind'
import ConversationRewindDialog from '../../chat/ConversationRewindDialog.vue'
import { useAgentStore, useNotificationStore } from '../../../stores'
import { getApiBaseUrl } from '../../../api/transport'
import { logger } from '../../../lib/logger'

const ctx = useDashboardContext()
const notif = useNotificationStore()
const rewind = useConversationRewind()
const agentStore = useAgentStore()

function handleRewindVisibility(visible: boolean): void {
  if (!visible) threadPendingDelete.value = null
}

// ── 当前激活角色 ──
const activeAgentName = computed(() => {
  return agentStore.currentAgent?.name || ctx.activeAgentId.value || '未知'
})

// ── 类型 ──

interface LogMessage {
  id: string
  role: string
  content: string
  /** 群聊权威消息的实际发言 Agent；普通 Thread 消息为 null。 */
  agentId?: string | null
  /** Agent 回复的原始内容（含调试块），仅 assistant 可能有值。 */
  rawContent?: string | null
  /** 包含进入 ReAct 前的初始提示词快照与 Token 使用量。 */
  metadataJson?: string
  /** Assistant 可见输出的总 Token。 */
  outputTokens?: number
  timestamp?: string
}

interface InitialPromptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

interface LogEntry {
  id: string
  threadId: string
  /** group 日志以 roomId 聚合；普通日志保留 null。 */
  roomId?: string
  agentId: string
  agentName: string
  summary: string
  /** 列表加载时即携带真实消息数；展开后不再以已加载条数覆盖。 */
  messageCount: number
  channel: string
  createdAt: string
  /** 展开后加载的消息 */
  messages: LogMessage[]
  /** 消息是否已加载 */
  messagesLoaded: boolean
  /** 是否正在加载消息 */
  isLoadingMessages: boolean
}

// ── 状态 ──

const logs = shallowRef<LogEntry[]>([])
const roomNames = shallowRef(new Map<string, string>())
const isLoading = ref(false)
const searchQuery = ref('')
const filterAgent = ref('all')
const filterChannel = ref('all')
const selectedSort = ref('desc')
const expandedId = ref<string | null>(null)
const threadPendingDelete = ref<LogEntry | null>(null)
const threadPendingRename = ref<LogEntry | null>(null)
const currentPage = ref(1)
const totalCount = ref(0)

const agentOptions = computed(() => [
  { label: '全部角色', value: 'all' },
  ...agentStore.agents.map((agent) => ({
    label: agent.name || agent.id,
    value: agent.id,
  })),
])

const channelOptions = [
  { label: '全部频道', value: 'all' },
  { label: 'Desktop', value: 'desktop' },
  { label: 'Group', value: 'group' },
]

/** 从据点群聊 Thread 的平台标识中提取房间 ID（格式：{roomId}:{agentId}）。 */
function getStrongholdRoomId(thread: ThreadInfo): string | null {
  if (thread.channel !== 'group' || thread.platform !== 'stronghold') return null
  return thread.platformIdentifier?.split(':', 1)[0] || null
}

/** 据点群聊仅以房间聚合，Agent 隔离 Thread 仅供后端编译上下文，不作为日志分组依据。 */
function groupLogsByRoom(threads: ThreadInfo[]): LogEntry[] {
  const groupLogs = new Map<string, LogEntry>()
  const entries: LogEntry[] = []

  for (const thread of threads) {
    const roomId = getStrongholdRoomId(thread)
    if (!roomId) {
      entries.push(toLogEntry(thread))
      continue
    }

    const createdAt = thread.updatedAt || thread.createdAt
    const existing = groupLogs.get(roomId)
    if (!existing || new Date(createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      groupLogs.set(roomId, {
        id: `stronghold-room-${roomId}`,
        threadId: thread.id,
        roomId,
        // group 日志不归属单一角色；保留空值仅满足已有 LogEntry 结构。
        agentId: '',
        agentName: '据点房间',
        summary: roomNames.value.get(roomId) || `据点房间 · ${roomId}`,
        messageCount: 0,
        channel: 'group',
        createdAt,
        messages: [],
        messagesLoaded: false,
        isLoadingMessages: false,
      })
    }
  }

  return [...entries, ...groupLogs.values()]
}

const sortOptions = [
  { label: '最新在前', value: 'desc' },
  { label: '最早在前', value: 'asc' },
]

const filteredLogs = computed(() => {
  let list = logs.value
  if (filterAgent.value !== 'all') {
    // 据点群聊按房间展示，不隶属任何单个 Agent，因此不受角色筛选影响。
    list = list.filter((log) => log.roomId || log.agentId === filterAgent.value)
  }
  if (filterChannel.value !== 'all') {
    list = list.filter((l) => l.channel === filterChannel.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((l) => l.summary.toLowerCase().includes(q))
  }
  // 排序
  if (selectedSort.value === 'asc') {
    list = [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }
  return list
})

// ── API 操作 ──

async function fetchSessions(): Promise<void> {
  isLoading.value = true
  try {
    // group Thread 按角色隔离只是后端上下文实现；日志聚合必须总能取得同房间的全部 Thread。
    const agentId = undefined
    const channel = filterChannel.value !== 'all' ? filterChannel.value : undefined
    const [threadsResponse, roomsResponse] = await Promise.all([
      threadsApi.list({
        agentId,
        channel,
        page: currentPage.value,
        // group Thread 按角色隔离，日志页需要在同一页看到所有房间对应 Thread 才能正确聚合。
        pageSize: 100,
      }),
      strongholdApi.listRooms(),
    ])
    const data = threadsResponse.data
    if (roomsResponse.data) {
      roomNames.value = new Map(roomsResponse.data.map((room) => [room.id, room.name]))
    }
    if (data) {
      // 保留已加载的消息状态（删除/手动刷新时避免展开的对话详情被重置）
      const oldLogs = logs.value
      const grouped = groupLogsByRoom(data.items)
      // 据点房间的消息数须从群聊表实时统计：
      // group Thread 的 messageCount 仅覆盖触发过 RAG 的回合，不代表房间全部消息，不权威。
      await Promise.all(
        [...new Set(grouped.filter((e) => e.roomId).map((e) => e.roomId!))].map(async (roomId) => {
          try {
            const res = await strongholdApi.getMessageCount(roomId)
            grouped.forEach((entry) => {
              if (entry.roomId === roomId) entry.messageCount = res.data?.count ?? 0
            })
          } catch (err) {
            logger.error('LogsTab', `加载据点房间消息数失败: ${roomId}`, err)
          }
        }),
      )
      logs.value = grouped.map((entry) => {
        const old = oldLogs.find((log) => log.id === entry.id)
        // 若该条已展开且消息已加载,保留原有 messages/messagesLoaded/isLoadingMessages,
        // 防止刷新时展开的详情区域全部消失（UX 事故）。
        // messageCount 始终使用最新拉取的真实总数，与消息预览窗口解耦。
        if (old && old.messagesLoaded) {
          entry.messages = old.messages
          entry.messagesLoaded = true
          entry.isLoadingMessages = false
        }
        return entry
      })
      totalCount.value = data.total
    }
  } catch (e) {
    logger.error('LogsTab', '加载 Thread 列表失败', e)
  } finally {
    isLoading.value = false
  }
}

/** 展开时加载消息详情 */
async function toggleExpand(id: string): Promise<void> {
  if (expandedId.value === id) {
    expandedId.value = null
    return
  }
  expandedId.value = id

  const log = logs.value.find((item) => item.id === id)
  if (log && !log.messagesLoaded) {
    logs.value = logs.value.map((item) =>
      item.id === id ? { ...item, isLoadingMessages: true } : item,
    )
    try {
      let roomMessages: LogMessage[] | undefined
      if (log.roomId) {
        const response = await strongholdApi.getProjection(log.roomId, 100)
        roomMessages =
          response.data?.messages.map((message) => ({
            id: message.messageId,
            role: message.role,
            content: message.content,
            agentId: message.senderId,
            timestamp: message.timestamp ?? undefined,
          })) ?? []
      }

      if (roomMessages) {
        logs.value = logs.value.map((item) =>
          item.id === id
            ? {
                ...item,
                messages: roomMessages,
                // 不覆盖 messageCount：列表已展示房间真实总数，展开窗口只是预览
                messagesLoaded: true,
                isLoadingMessages: false,
              }
            : item,
        )
        return
      }

      const res = await threadsApi.get(log.threadId, { pageSize: 30 })
      const data = res.data
      if (data) {
        const threadMessages = [...data.messages].reverse().map((message: ThreadMessageInfo) => ({
          // 后端 id 为 number，本地统一转 string 以兼容删除等 API 调用
          id: String(message.id),
          role: message.role,
          content: message.content,
          agentId: message.agentId,
          // 使用后端返回的原始内容（含调试块），缺失时回退为 null
          rawContent: message.rawContent ?? null,
          metadataJson: message.metadataJson,
          // 后端字段名为 timestamp（不是 createdAt）
          timestamp: message.timestamp ?? undefined,
        }))
        logs.value = logs.value.map((item) =>
          item.id === id
            ? {
                ...item,
                messages: threadMessages,
                // 不覆盖 messageCount：列表已展示 Thread 真实总数，展开窗口只是预览
                messagesLoaded: true,
                isLoadingMessages: false,
              }
            : item,
        )
      }
    } catch (e) {
      logger.error('LogsTab', '加载 Thread 详情失败', e)
    } finally {
      if (!logs.value.find((item) => item.id === id)?.messagesLoaded) {
        logs.value = logs.value.map((item) =>
          item.id === id ? { ...item, isLoadingMessages: false } : item,
        )
      }
    }
  }
}

function getAgentName(agentId: string): string {
  return agentStore.agents.find((agent) => agent.id === agentId)?.name || agentId
}

function toLogEntry(t: ThreadInfo): LogEntry {
  return {
    id: t.id,
    threadId: t.id,
    agentId: t.agentId,
    agentName: getAgentName(t.agentId),
    summary: t.title || '未命名会话',
    // 后端列表已返回真实计数，无需展开即可展示
    messageCount: t.messageCount ?? 0,
    channel: t.channel || 'desktop',
    createdAt: t.updatedAt || t.createdAt,
    messages: [],
    messagesLoaded: false,
    isLoadingMessages: false,
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMsgTime(ts?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 动态获取 agent 头像完整 URL */
function getAgentAvatar(agentId: string): string | null {
  const agent = agentStore.agents.find((a) => a.id === agentId)
  if (agent?.avatarUrl) {
    return `${getApiBaseUrl()}${agent.avatarUrl}`
  }
  return null
}

/** 群聊权威消息携带实际发言者；普通 Thread 则使用所属 Agent。 */
function getMessageAgentName(log: LogEntry, message: LogMessage): string {
  return message.agentId ? getAgentName(message.agentId) : log.agentName
}

/** 复制记录到剪贴板 */
async function handleCopy(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    logger.info('LogsTab', '已复制日志内容')
    notif.toast('已复制', { type: 'success' })
  } catch (err) {
    logger.error('LogsTab', '复制失败', err)
    notif.toast('复制失败', { type: 'error' })
  }
}

/** 修改日志中的会话标题，并立即同步当前列表。 */
async function confirmRenameThread(value?: string) {
  const target = threadPendingRename.value
  if (!target) return
  const title = value?.trim() ?? ''
  try {
    await threadsApi.rename(target.threadId, title)
    logs.value = logs.value.map((log) =>
      log.id === target.id ? { ...log, summary: title || '未命名会话' } : log,
    )
    notif.toast('会话标题已更新', { type: 'success', title: '对话日志' })
  } catch (err) {
    logger.error('LogsTab', '会话改名失败', err)
    notif.toast(err instanceof Error ? err.message : '会话改名失败', {
      type: 'error',
      title: '对话日志',
    })
  } finally {
    threadPendingRename.value = null
  }
}

/** 打开整条会话的统一 rewind 预检。 */
async function requestDeleteThread(log: LogEntry) {
  threadPendingDelete.value = log
  try {
    await rewind.open({
      threadId: log.threadId,
      wholeThread: true,
      title: log.summary || '未命名会话',
      onSuccess: (result) => {
        logs.value = logs.value.filter((item) => item.id !== log.id)
        totalCount.value = Math.max(0, totalCount.value - 1)
        if (expandedId.value === log.id) expandedId.value = null
        window.dispatchEvent(
          new CustomEvent('infos:workspace-rewound', {
            detail: { threadId: log.threadId, files: result.preview.files },
          }),
        )
        notif.toast('会话与工作区已回滚', { type: 'success', title: '对话日志' })
      },
    })
  } catch (err) {
    threadPendingDelete.value = null
    notif.toast(err instanceof Error ? err.message : '回滚预检失败', {
      type: 'error',
      title: '对话日志',
    })
  }
}

/** 在日志中链式回滚目标轮次及后续所有轮次。 */
async function handleDeletePair(log: LogEntry, id: string) {
  try {
    await rewind.open({
      threadId: log.threadId,
      messageId: Number(id),
      onSuccess: (result) => {
        const deletedIds = new Set(result.deletedMessageIds.map(String))
        logs.value = logs.value.map((item) =>
          item.id === log.id
            ? {
                ...item,
                messages: item.messages.filter((message) => !deletedIds.has(message.id)),
                messageCount: Math.max(0, item.messageCount - deletedIds.size),
              }
            : item,
        )
        window.dispatchEvent(
          new CustomEvent('infos:conversation-rewound', {
            detail: {
              threadId: log.threadId,
              deletedMessageIds: result.deletedMessageIds.map(String),
              projection: result.projection,
            },
          }),
        )
        window.dispatchEvent(
          new CustomEvent('infos:workspace-rewound', {
            detail: { threadId: log.threadId, files: result.preview.files },
          }),
        )
        notif.toast(`已回滚 ${result.preview.pairCount} 轮对话`, {
          type: 'success',
          title: '对话日志',
        })
      },
    })
  } catch (err) {
    logger.error('LogsTab', '回滚预检失败', err)
    notif.toast(err instanceof Error ? err.message : '回滚预检失败', {
      type: 'error',
      title: '对话日志',
    })
  }
}

// ══════ 调试日志查看器 ══════
const showDebugDialog = ref(false)
const currentDebugMsg = ref<LogMessage | null>(null)
const debugViewMode = ref<'prompt' | 'raw'>('prompt')

function hasStoredRawContent(msg: LogMessage): boolean {
  return Boolean(msg.rawContent?.trim())
}

/** 调试弹窗中显示原始转写；旧记录未落库时回退可见回复。 */
function getDebugRawContent(msg: LogMessage): string {
  return msg.rawContent?.trim() || msg.content
}

/** 读取进入 ReAct 前首次发送给 LLM 的完整消息快照。 */
function getInitialPromptMessages(msg: LogMessage): InitialPromptMessage[] {
  if (!msg.metadataJson) return []
  try {
    const parsed = JSON.parse(msg.metadataJson) as {
      initialPromptMessages?: InitialPromptMessage[]
    }
    return Array.isArray(parsed.initialPromptMessages) ? parsed.initialPromptMessages : []
  } catch {
    return []
  }
}

function getInputTokenCount(msg: LogMessage): number | undefined {
  if (!msg.metadataJson) return undefined
  try {
    const parsed = JSON.parse(msg.metadataJson) as { tokenUsage?: { inputTokens?: unknown } }
    const value = parsed.tokenUsage?.inputTokens
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

function formatPromptContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  return JSON.stringify(content, null, 2)
}

/** 打开调试弹窗。 */
function openDebugDialog(msg: LogMessage): void {
  currentDebugMsg.value = msg
  debugViewMode.value = 'prompt'
  showDebugDialog.value = true
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => fetchSessions(),
)

function handleConversationCompleted(): void {
  void fetchSessions()
}

function handleConversationRewound(event: Event): void {
  const detail = (event as CustomEvent<{ threadId?: string }>).detail
  if (!detail?.threadId) return
  void fetchSessions()
}

onMounted(async () => {
  window.addEventListener('infos:conversation-completed', handleConversationCompleted)
  window.addEventListener('infos:conversation-rewound', handleConversationRewound)
  // Dashboard 窗口可能独立于 Launcher 打开，需要先拿到完整 Agent 列表再渲染筛选项和显示名
  if (!agentStore.agents.length) await agentStore.fetchAgents()
  await fetchSessions()
})

onUnmounted(() => {
  window.removeEventListener('infos:conversation-completed', handleConversationCompleted)
  window.removeEventListener('infos:conversation-rewound', handleConversationRewound)
})
</script>

<template>
  <div class="logs-tab h-full flex flex-col overflow-hidden">
    <!-- 工具栏 -->
    <div class="p-6 pb-0 flex-none">
      <PCard pixel overflow-visible class="relative group/toolbar z-30">
        <!-- 背景装饰 ✨ -->
        <div
          class="absolute -right-20 -top-20 w-40 h-40 bg-sky-400/5 blur-[60px] rounded-full pointer-events-none group-hover/toolbar:bg-sky-400/15 transition-all duration-1000"
        />
        <div
          class="absolute -left-10 -bottom-10 w-32 h-32 bg-sky-300/5 blur-[50px] rounded-full pointer-events-none group-hover/toolbar:bg-sky-300/10 transition-all duration-1000 delay-150"
        />

        <div class="flex flex-wrap items-end gap-5 relative z-10">
          <!-- 标题 -->
          <div class="flex flex-col gap-1.5 min-w-[120px]">
            <h2 class="flex items-center gap-2 text-xl font-black text-slate-800 font-pixel">
              <span
                class="group-hover/toolbar:scale-110 group-hover/toolbar:rotate-6 transition-transform duration-500"
              >
                <PixelIcon name="chat" size="md" />
              </span>
              对话日志
              <span
                class="opacity-0 group-hover/toolbar:opacity-100 transition-opacity duration-500"
              >
                <PixelIcon name="paw" size="xs" />
              </span>
            </h2>
          </div>

          <!-- 当前角色头像徽标 -->
          <div class="flex items-center gap-2.5 ml-auto mr-4">
            <div
              class="current-agent-badge relative flex items-center gap-2 px-3 py-1.5 pixel-border-sky group/avatar cursor-default transition-all"
            >
              <div
                class="w-8 h-8 pixel-border-sky overflow-hidden flex items-center justify-center bg-sky-100 group-hover/avatar:scale-110 transition-transform"
              >
                <img
                  v-if="agentStore.currentAgent?.avatarUrl"
                  :src="`${getApiBaseUrl()}${agentStore.currentAgent.avatarUrl}`"
                  :alt="activeAgentName"
                  class="w-full h-full object-cover"
                />
                <PixelIcon v-else name="cat" size="sm" class="text-sky-500" />
              </div>
              <span class="current-agent-name text-sm font-bold transition-colors">
                {{ activeAgentName }}
              </span>
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm" />
            </div>
          </div>

          <!-- 搜索 -->
          <div class="flex flex-col gap-1.5 flex-1 min-w-[160px] max-w-[280px]">
            <label
              class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-sky-500" />
              搜索
              <span class="opacity-50 font-normal">Search</span>
            </label>
            <PInput v-model="searchQuery" placeholder="搜索对话摘要..." class="!text-sm" />
          </div>

          <!-- Agent -->
          <div class="flex flex-col gap-1.5 min-w-[130px]">
            <label
              class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
              角色
              <span class="opacity-50 font-normal">Agent</span>
            </label>
            <PSelect v-model="filterAgent" :options="agentOptions" @change="fetchSessions" />
          </div>

          <!-- 来源 -->
          <div class="flex flex-col gap-1.5 min-w-[130px]">
            <label
              class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-sky-500" />
              来源
              <span class="opacity-50 font-normal">Source</span>
            </label>
            <PSelect v-model="filterChannel" :options="channelOptions" @change="fetchSessions" />
          </div>

          <!-- 排序 -->
          <div class="flex flex-col gap-1.5 min-w-[120px]">
            <label
              class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-sky-500" />
              排序
              <span class="opacity-50 font-normal">Sort</span>
            </label>
            <PSelect v-model="selectedSort" :options="sortOptions" />
          </div>

          <!-- 刷新 -->
          <div class="pb-0.5 ml-auto">
            <PButton
              variant="secondary"
              :loading="isLoading"
              class="group/refresh"
              @click="fetchSessions"
            >
              <span
                class="group-hover/refresh:rotate-180 transition-transform duration-700 inline-block"
              >
                <PixelIcon name="refresh" size="xs" />
              </span>
              刷新
            </PButton>
          </div>
        </div>
      </PCard>
    </div>

    <!-- 聊天列表 -->
    <div class="flex-1 overflow-y-auto px-6 pb-6 pt-4 logs-scrollbar">
      <PEmpty v-if="filteredLogs.length === 0">
        <template #description>
          <div class="flex items-center gap-2 justify-center">
            暂无对话记录
            <PixelIcon name="thought" size="xs" />
          </div>
        </template>
      </PEmpty>

      <div v-else class="space-y-3 max-w-4xl mx-auto">
        <div v-for="log in filteredLogs" :key="log.id" class="group/session">
          <!-- 会话头 -->
          <PCard pixel hoverable padding="sm" class="cursor-pointer" @click="toggleExpand(log.id)">
            <div class="flex justify-between items-center relative">
              <!-- 头像 + 摘要 -->
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-11 h-11 flex items-center justify-center bg-gradient-to-br from-sky-400 to-sky-600 text-white font-black text-base flex-shrink-0 shadow-lg shadow-sky-200/30 group-hover/session:scale-110 group-hover/session:rotate-6 transition-all duration-500 relative overflow-hidden"
                >
                  <!-- 据点群聊使用与据点页面一致的五边形 Logo，不显示任意角色头像。 -->
                  <svg
                    v-if="log.roomId"
                    viewBox="0 0 48 48"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-label="据点房间"
                    class="w-full h-full p-1"
                  >
                    <path
                      d="M24 2 L44.92 17.2 L36.93 41.8 L11.07 41.8 L3.08 17.2 Z"
                      fill="#1e3a5f"
                    />
                    <path
                      d="M24 6 L41.15 18.42 L34.6 38.6 L13.4 38.6 L6.85 18.42 Z"
                      fill="#38bdf8"
                    />
                    <path d="M16.4 24.4 L31.6 24.4 L24 13.4 Z" fill="#f8fafc" opacity="0.95" />
                    <rect
                      x="16.4"
                      y="24.4"
                      width="15.2"
                      height="10"
                      fill="#f8fafc"
                      opacity="0.95"
                    />
                    <rect x="22.1" y="27.6" width="3.8" height="6.8" rx="1.9" fill="#1e3a5f" />
                  </svg>
                  <img
                    v-else-if="getAgentAvatar(log.agentId)"
                    :src="getAgentAvatar(log.agentId)!"
                    class="w-full h-full object-cover"
                    :alt="log.agentName"
                  />
                  <template v-else>
                    <div class="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent" />
                    <span class="relative z-10">{{ log.agentName[0] }}</span>
                  </template>
                  <!-- 🐾 小脚印装饰 -->
                  <div
                    class="absolute -bottom-1 -right-1 text-[10px] opacity-0 group-hover/session:opacity-100 transition-opacity duration-500 z-20"
                  >
                    <PixelIcon name="paw" size="xs" animation="bounce" />
                  </div>
                </div>
                <div class="min-w-0">
                  <h4 class="text-[13px] font-bold text-slate-800 truncate">
                    {{ log.summary }}
                  </h4>
                  <div class="flex gap-3 mt-1 flex-wrap">
                    <span class="text-[10px] text-slate-400 flex items-center gap-1">
                      <PixelIcon name="chat" size="xs" />
                      {{ log.messageCount }} 条
                    </span>
                    <span
                      class="text-[10px] font-bold px-1.5 py-0.5 bg-sky-50 text-sky-500 border border-sky-100"
                    >
                      {{ log.channel }}
                    </span>
                    <span class="text-[10px] text-slate-400 font-pixel">
                      {{ formatDate(log.createdAt) }}
                    </span>
                  </div>
                </div>
              </div>
              <!-- 会话操作 -->
              <div class="flex items-center gap-1 relative z-20">
                <button
                  class="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                  title="修改会话标题"
                  aria-label="修改会话标题"
                  @click.stop="threadPendingRename = log"
                >
                  <PixelIcon name="pencil" size="xs" />
                </button>
                <button
                  class="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="删除整条会话"
                  aria-label="删除整条会话"
                  @click.stop="requestDeleteThread(log)"
                >
                  <PixelIcon name="trash" size="xs" />
                </button>
                <PixelIcon
                  :name="expandedId === log.id ? 'chevron-up' : 'chevron-down'"
                  size="xs"
                  class="text-slate-400 flex-shrink-0 transition-transform duration-500"
                  :class="expandedId === log.id ? 'rotate-0' : ''"
                />
              </div>
              <!-- 装饰水印 -->
              <div
                class="absolute -right-3 -bottom-3 opacity-[0.03] group-hover/session:opacity-[0.08] transition-all duration-700 pointer-events-none"
              >
                <PixelIcon name="thought" size="3xl" />
              </div>
            </div>
          </PCard>

          <!-- 展开后的气泡式对话 -->
          <div
            v-if="expandedId === log.id"
            class="mt-2 ml-4 pl-4 border-l-2 border-sky-100 space-y-4 py-3"
          >
            <!-- 加载中 -->
            <div
              v-if="log.isLoadingMessages"
              class="flex items-center gap-2 text-slate-400 text-sm font-bold py-4 justify-center"
            >
              <PixelIcon name="refresh" size="sm" animation="spin" />
              <span class="font-pixel">加载消息中...</span>
            </div>

            <!-- 消息气泡 -->
            <template v-else>
              <div
                v-for="(msg, i) in log.messages"
                :key="i"
                class="flex gap-3 group/msg"
                :class="msg.role === 'user' ? 'flex-row-reverse' : ''"
              >
                <!-- 头像 -->
                <div
                  class="message-avatar flex-none w-9 h-9 flex items-center justify-center text-sm border transition-all duration-500 group-hover/msg:scale-110 group-hover/msg:rotate-3 relative overflow-hidden flex-shrink-0"
                  :class="
                    msg.role === 'user' ? 'message-avatar--user' : 'message-avatar--assistant'
                  "
                >
                  <PixelIcon
                    v-if="msg.role === 'user'"
                    name="user"
                    size="sm"
                    class="relative z-10"
                  />
                  <template v-else>
                    <!-- 据点房间消息统一使用据点 Logo，避免视觉上重新绑定到某个 Agent。 -->
                    <svg
                      v-if="log.roomId"
                      viewBox="0 0 48 48"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-label="据点房间"
                      class="w-full h-full p-1 relative z-10"
                    >
                      <path
                        d="M24 2 L44.92 17.2 L36.93 41.8 L11.07 41.8 L3.08 17.2 Z"
                        fill="#1e3a5f"
                      />
                      <path
                        d="M24 6 L41.15 18.42 L34.6 38.6 L13.4 38.6 L6.85 18.42 Z"
                        fill="#38bdf8"
                      />
                      <path d="M16.4 24.4 L31.6 24.4 L24 13.4 Z" fill="#f8fafc" opacity="0.95" />
                      <rect
                        x="16.4"
                        y="24.4"
                        width="15.2"
                        height="10"
                        fill="#f8fafc"
                        opacity="0.95"
                      />
                      <rect x="22.1" y="27.6" width="3.8" height="6.8" rx="1.9" fill="#1e3a5f" />
                    </svg>
                    <img
                      v-else-if="getAgentAvatar(log.agentId)"
                      :src="getAgentAvatar(log.agentId)!"
                      class="w-full h-full object-cover relative z-10"
                    />
                    <PixelIcon v-else name="robot" size="sm" class="relative z-10" />
                  </template>
                </div>

                <!-- 气泡 -->
                <div
                  class="flex flex-col max-w-[80%]"
                  :class="msg.role === 'user' ? 'items-end' : 'items-start'"
                >
                  <!-- 角色标签 -->
                  <div
                    class="flex items-center gap-2 mb-1 text-[10px] text-slate-400 px-2 font-bold"
                  >
                    <span
                      class="tracking-wider uppercase flex items-center gap-1"
                      :class="msg.role === 'user' ? 'text-sky-600/70' : 'text-purple-500'"
                    >
                      <PixelIcon
                        v-if="msg.role !== 'user'"
                        name="sparkle"
                        size="xs"
                        animation="spin"
                      />
                      {{ msg.role === 'user' ? '主人' : getMessageAgentName(log, msg) }}
                      <PixelIcon
                        v-if="msg.role === 'user'"
                        name="heart"
                        size="xs"
                        animation="pulse"
                      />
                    </span>
                    <span v-if="msg.timestamp" class="opacity-40 font-mono text-[9px]">
                      {{ formatMsgTime(msg.timestamp) }}
                    </span>
                    <span
                      v-if="msg.role !== 'user' && msg.outputTokens !== undefined"
                      class="opacity-50 font-mono text-[9px]"
                    >
                      {{ msg.outputTokens.toLocaleString('zh-CN') }} Token
                    </span>
                  </div>

                  <!-- 气泡主体 -->
                  <div
                    class="message-bubble relative px-5 py-3 text-[13px] leading-relaxed transition-all duration-500 border group/bubble"
                    :class="
                      msg.role === 'user' ? 'message-bubble--user' : 'message-bubble--assistant'
                    "
                  >
                    <!-- 浮动装饰 -->
                    <div
                      v-if="msg.role !== 'user'"
                      class="absolute -right-4 -top-4 opacity-0 group-hover/bubble:opacity-100 transition-all duration-700 transform scale-0 group-hover/bubble:scale-110 rotate-12 group-hover/bubble:rotate-0"
                    >
                      <PixelIcon name="sparkle" size="sm" animation="spin" />
                    </div>
                    <div
                      v-if="msg.role === 'user'"
                      class="absolute -left-4 -top-4 opacity-0 group-hover/bubble:opacity-100 transition-all duration-700 transform scale-0 group-hover/bubble:scale-110 -rotate-12 group-hover/bubble:rotate-0"
                    >
                      <PixelIcon name="paw" size="sm" animation="bounce" />
                    </div>
                    <p class="whitespace-pre-wrap break-words relative z-10">{{ msg.content }}</p>

                    <!-- 气泡操作栏 (Hover 时浮现) -->
                    <div
                      v-if="!log.roomId"
                      class="bubble-actions absolute -top-4 right-2 opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center z-20 rounded-sm overflow-hidden"
                    >
                      <button
                        class="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                        title="复制"
                        @click.stop="handleCopy(msg.content)"
                      >
                        <PixelIcon name="copy" size="sm" />
                      </button>
                      <button
                        class="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        title="删除该对话对"
                        @click.stop="handleDeletePair(log, msg.id)"
                      >
                        <PixelIcon name="trash" size="sm" />
                      </button>
                      <button
                        v-if="msg.role === 'assistant'"
                        class="p-1.5 text-slate-400 hover:text-purple-500 hover:bg-purple-50 transition-colors border-l border-slate-100"
                        title="查看内部构造"
                        @click.stop="openDebugDialog(msg)"
                      >
                        <PixelIcon name="terminal" size="sm" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 底部提示 -->
              <div class="text-center pt-2">
                <span
                  class="text-[10px] text-slate-400 font-bold px-3 py-1 bg-sky-50/50 border border-sky-100 inline-flex items-center gap-1.5"
                >
                  <PixelIcon name="thought" size="xs" />
                  展示前 {{ log.messages.length }} 条消息
                  <PixelIcon name="paw" size="xs" />
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══ 调试日志弹窗 ═══ -->
  <PDialog
    :model-value="Boolean(threadPendingRename)"
    title="修改会话标题"
    mode="prompt"
    :default-value="
      threadPendingRename?.summary === '未命名会话' ? '' : threadPendingRename?.summary || ''
    "
    placeholder="未命名会话"
    confirm-text="保存标题"
    @update:model-value="
      (visible) => {
        if (!visible) threadPendingRename = null
      }
    "
    @confirm="confirmRenameThread"
  />

  <ConversationRewindDialog
    v-model="rewind.visible.value"
    :preview="rewind.preview.value"
    :loading="rewind.loading.value"
    @update:model-value="handleRewindVisibility"
    @confirm="rewind.confirm"
  />

  <PDialog v-model="showDebugDialog" title="对话调试详情 (Debug View)" width="800px">
    <div v-if="currentDebugMsg" class="debug-dialog-body space-y-4">
      <div class="debug-view-switch" role="tablist" aria-label="调试内容视图">
        <button
          type="button"
          role="tab"
          :aria-selected="debugViewMode === 'prompt'"
          :class="{ active: debugViewMode === 'prompt' }"
          @click="debugViewMode = 'prompt'"
        >
          <PixelIcon name="terminal" size="xs" />
          <span>完整提示词</span>
          <small>PROMPT</small>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="debugViewMode === 'raw'"
          :class="{ active: debugViewMode === 'raw' }"
          @click="debugViewMode = 'raw'"
        >
          <PixelIcon name="file" size="xs" />
          <span>原始文本</span>
          <small>RAW</small>
        </button>
      </div>

      <!-- 元信息 -->
      <div class="debug-meta flex flex-wrap items-center gap-4 p-3 text-[11px] font-pixel">
        <div class="flex items-center gap-1.5">
          <span class="opacity-50 uppercase">Log ID:</span>
          <span class="font-bold border-b border-current opacity-60">{{ currentDebugMsg.id }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="opacity-50 uppercase">Role:</span>
          <span
            class="debug-role-badge px-1.5 py-0.5 font-bold uppercase tracking-wider"
            :class="
              currentDebugMsg.role === 'user'
                ? 'debug-role-badge--user'
                : 'debug-role-badge--assistant'
            "
          >
            {{ currentDebugMsg.role }}
          </span>
        </div>
        <div v-if="debugViewMode === 'prompt'" class="flex items-center gap-1.5">
          <span class="opacity-50 uppercase">输入 Token:</span>
          <span class="font-bold font-mono">
            {{ getInputTokenCount(currentDebugMsg)?.toLocaleString('zh-CN') ?? '历史记录无统计' }}
          </span>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <span class="opacity-50 uppercase">Storage:</span>
          <span class="font-bold flex items-center gap-1">
            <template v-if="hasStoredRawContent(currentDebugMsg)">
              <PixelIcon name="check" size="xs" class="text-emerald-500" />
              已保存原始日志 ({{ currentDebugMsg.rawContent!.length }} bytes)
            </template>
            <template v-else>
              <PixelIcon name="alert" size="xs" class="text-amber-500" />
              历史记录未保存原始转写，已显示可见回复
            </template>
          </span>
        </div>
      </div>

      <!-- 完整提示词：仅展示进入 ReAct 前首次发送给 LLM 的消息快照。 -->
      <div v-if="debugViewMode === 'prompt'" class="prompt-view logs-scrollbar">
        <template v-if="getInitialPromptMessages(currentDebugMsg).length">
          <article
            v-for="(message, index) in getInitialPromptMessages(currentDebugMsg)"
            :key="`${message.role}:${index}`"
            class="prompt-message"
            :class="`is-${message.role}`"
          >
            <header>
              <span>{{ message.role }}</span>
              <small>#{{ String(index + 1).padStart(2, '0') }}</small>
            </header>
            <pre><code>{{ formatPromptContent(message.content) }}</code></pre>
          </article>
        </template>
        <div v-else class="prompt-view__empty">
          <PixelIcon name="info" size="md" />
          <strong>该轮没有初始提示词快照</strong>
          <span>此记录生成于提示词持久化功能启用之前，无法还原首次 LLM 请求。</span>
        </div>
      </div>

      <!-- 原始模型转写。 -->
      <div v-else class="max-h-[50vh] overflow-y-auto pr-2 logs-scrollbar">
        <pre
          class="debug-raw p-4 border text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto"
        ><code>{{ getDebugRawContent(currentDebugMsg) }}</code></pre>
      </div>
    </div>

    <template #footer>
      <PButton variant="secondary" size="sm" @click="showDebugDialog = false">关闭</PButton>
    </template>
  </PDialog>
</template>

<style scoped>
/* 日志业务区统一使用主题语义色。 */
.logs-tab {
  color: var(--ui-text-primary);
}
.logs-tab :is(.text-slate-800, .text-slate-700, .text-slate-600) {
  color: var(--ui-text-primary);
}
.logs-tab :is(.text-slate-500, .text-slate-400) {
  color: var(--ui-text-secondary);
}
.current-agent-badge {
  background: var(--ui-accent-sky-soft);
}
.current-agent-badge:hover {
  background: var(--ui-bg-hover);
}
.current-agent-name {
  color: var(--ui-accent-sky);
}
.current-agent-badge:hover .current-agent-name {
  color: color-mix(in srgb, var(--ui-accent-sky) 78%, white);
}
.conversation-thread {
  border-left: 2px solid var(--ui-border-default);
}
.message-avatar,
.message-bubble {
  background: var(--dash-panel-soft);
  color: var(--ui-text-primary);
  box-shadow: var(--ui-shadow-sm);
}
.message-avatar--user,
.message-bubble--user {
  border-color: var(--ui-accent-sky);
}
.message-avatar--assistant,
.message-bubble--assistant {
  border-color: var(--ui-accent-purple);
}
.message-bubble--user {
  border-right-width: 4px;
}
.message-bubble--assistant {
  border-left-width: 4px;
}
.message-bubble:hover {
  background: var(--ui-bg-hover);
}
.bubble-actions {
  border: 1px solid var(--ui-border-default);
  background: var(--dash-panel-elevated);
  box-shadow: var(--ui-shadow-sm);
}
.debug-view-switch {
  display: grid;
  width: min(100%, 390px);
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-panel-soft);
  box-shadow: 3px 3px 0 var(--ui-border-subtle);
}
.debug-view-switch button {
  position: relative;
  display: grid;
  min-height: 38px;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}
.debug-view-switch button:hover {
  border-color: var(--ui-border-default);
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.debug-view-switch button.active {
  border-color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--ui-accent-purple) 28%, transparent);
}
.debug-view-switch button:last-child.active {
  border-color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--ui-accent-sky) 28%, transparent);
}
.debug-view-switch small {
  color: currentColor;
  font: 700 7px var(--ui-font-mono);
  letter-spacing: 0.08em;
  opacity: 0.55;
}
.prompt-view {
  display: flex;
  max-height: 50vh;
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  padding-right: 6px;
}
.prompt-message {
  overflow: hidden;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-panel-soft);
  box-shadow: 2px 2px 0 var(--ui-border-subtle);
}
.prompt-message > header {
  display: flex;
  min-height: 29px;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-hover);
}
.prompt-message > header span {
  color: var(--ui-text-secondary);
  font: 900 8px var(--ui-font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.prompt-message > header small {
  color: var(--ui-text-disabled);
  font: 700 7px var(--ui-font-mono);
}
.prompt-message pre {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  padding: 11px 12px;
  color: var(--ui-text-primary);
  font: 10px/1.65 var(--ui-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.prompt-message.is-system {
  border-left: 3px solid var(--ui-accent-purple);
}
.prompt-message.is-system > header span {
  color: var(--ui-accent-purple);
}
.prompt-message.is-user {
  border-left: 3px solid var(--ui-accent-sky);
}
.prompt-message.is-user > header span {
  color: var(--ui-accent-sky);
}
.prompt-message.is-assistant {
  border-left: 3px solid var(--ui-success);
}
.prompt-message.is-tool {
  border-left: 3px solid var(--ui-warning);
}
.prompt-view__empty {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px dashed var(--ui-border-default);
  background: var(--dash-panel-soft);
  color: var(--ui-text-tertiary);
  text-align: center;
}
.prompt-view__empty strong {
  color: var(--ui-text-secondary);
  font-size: 11px;
}
.prompt-view__empty span {
  max-width: 420px;
  font-size: 9px;
  line-height: 1.6;
}
:global([data-theme='dark']) .debug-view-switch,
:global([data-theme='dark']) .prompt-message {
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.32);
}

.debug-raw {
  border-color: var(--ui-border-default);
  background: var(--dash-panel-soft);
  color: var(--ui-text-primary);
}
.debug-meta {
  border: 1px solid var(--ui-border-default);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}
/* 调试弹窗内文字兜底（弹窗 Teleport 到 body，不受 .logs-tab 祖先规则影响） */
.debug-dialog-body :is(.text-slate-600, .text-slate-700) {
  color: var(--ui-text-primary);
}
.debug-dialog-body :is(.text-slate-500, .text-slate-400) {
  color: var(--ui-text-secondary);
}
.debug-role-badge {
  background: var(--dash-panel-soft);
  border: 1px solid var(--ui-border-default);
}
.debug-role-badge--user {
  color: var(--ui-accent-sky);
  border-color: var(--ui-accent-sky);
}
.debug-role-badge--assistant {
  color: var(--ui-accent-purple);
  border-color: var(--ui-accent-purple);
}

/* 像素风滚动条 */
.logs-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.logs-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
  border-radius: 0;
}
</style>
