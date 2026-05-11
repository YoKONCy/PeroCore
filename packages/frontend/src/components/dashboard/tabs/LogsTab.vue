<script setup lang="ts">
/**
 * LogsTab — 对话日志 Tab (F1-3)
 *
 * 对标 v1 气泡式聊天 UI：
 * - 工具栏 PCard (Agent选择/来源筛选/日期/排序)
 * - 会话列表 → 点击展开为气泡对话视图
 * - 头像 + 角色标签 + 消息气泡 + hover 装饰
 */
import { ref, shallowRef, computed, onMounted, watch } from 'vue'
import { PixelIcon, PInput, PSelect, PButton, PEmpty, PCard, PDialog } from '../../pixel'
import { sessionsApi } from '../../../api/modules/sessionsApi'
import { chatApi } from '../../../api/modules/chatApi'
import type { SessionSummary } from '../../../api/modules/sessionsApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { useAgentStore } from '../../../stores'
import { getApiBaseUrl } from '../../../api/transport'
import { logger } from '../../../lib/logger'

const ctx = useDashboardContext()
const agentStore = useAgentStore()

// ── 当前激活角色 ──
const activeAgentName = computed(() => {
  return agentStore.currentAgent?.name || ctx.activeAgentId.value || '未知'
})

// ── 类型 ──

interface LogMessage {
  id: number
  role: string
  content: string
  rawContent?: string | null
  timestamp?: string
}

interface LogEntry {
  id: string
  sessionId: string
  agentId: string
  agentName: string
  summary: string
  messageCount: number
  source: string
  createdAt: string
  /** 展开后加载的消息 */
  messages: LogMessage[]
  /** 消息是否已加载 */
  messagesLoaded: boolean
  /** 是否正在加载消息 */
  isLoadingMessages: boolean
}

/** 调试解析段落 */
interface DebugSegment {
  type: 'thinking' | 'monologue' | 'nit' | 'text'
  content: string
}

// ── 状态 ──

const logs = shallowRef<LogEntry[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const filterAgent = ref('all')
const filterSource = ref('all')
const selectedSort = ref('desc')
const expandedId = ref<string | null>(null)
const currentPage = ref(1)
const totalCount = ref(0)
const pageSize = 20

const agentOptions = computed(() => [
  { label: '全部角色', value: 'all' },
  ...agentStore.agents.map((agent) => ({
    label: agent.name || agent.id,
    value: agent.id,
  })),
])

const sourceOptions = [
  { label: '全部来源', value: 'all' },
  { label: 'Desktop', value: 'desktop' },
  { label: 'Mobile', value: 'mobile' },
]

const sortOptions = [
  { label: '最新在前', value: 'desc' },
  { label: '最早在前', value: 'asc' },
]

const filteredLogs = computed(() => {
  let list = logs.value
  if (filterAgent.value !== 'all') {
    list = list.filter((l) => l.agentId === filterAgent.value)
  }
  if (filterSource.value !== 'all') {
    list = list.filter((l) => l.source === filterSource.value)
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
    const agentId = filterAgent.value !== 'all' ? filterAgent.value : undefined
    const source = filterSource.value !== 'all' ? filterSource.value : undefined
    const res = await sessionsApi.list({
      agentId,
      source,
      page: currentPage.value,
      pageSize,
    })
    const data = res.data
    if (data) {
      logs.value = data.items.map(toLogEntry)
      totalCount.value = data.total
    }
  } catch (e) {
    logger.error('LogsTab', '加载会话列表失败', e)
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

  const log = logs.value.find((l) => l.id === id)
  if (log && !log.messagesLoaded) {
    logs.value = logs.value.map((item) =>
      item.id === id ? { ...item, isLoadingMessages: true } : item,
    )
    try {
      const res = await sessionsApi.detail(log.sessionId, { agentId: log.agentId, limit: 30 })
      const data = res.data
      if (data) {
        const messages = data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          rawContent: m.rawContent,
          timestamp: m.timestamp ?? undefined,
        }))
        logs.value = logs.value.map((item) =>
          item.id === id
            ? {
                ...item,
                messages,
                messagesLoaded: true,
                isLoadingMessages: false,
              }
            : item,
        )
      }
    } catch (e) {
      logger.error('LogsTab', '加载会话详情失败', e)
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

function toLogEntry(s: SessionSummary): LogEntry {
  return {
    id: s.sessionId,
    sessionId: s.sessionId,
    agentId: s.agentId,
    agentName: getAgentName(s.agentId),
    summary: s.preview || `会话 ${s.sessionId.slice(0, 8)}...`,
    messageCount: s.messageCount,
    source: s.source || 'desktop',
    createdAt: s.lastMessageAt,
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

/** 复制记录到剪贴板 */
async function handleCopy(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    logger.info('LogsTab', '已复制日志内容')
  } catch (err) {
    logger.error('LogsTab', '复制失败', err)
  }
}

/** 在日志中级联删除消息对 */
async function handleDeletePair(log: LogEntry, id: number) {
  // 本地 UI 乐观删除 (匹配上下游一对)
  const idx = log.messages.findIndex((m) => m.id === id)
  if (idx >= 0) {
    const msg = log.messages[idx]
    if (msg) {
      const pairIds = [id]
      if (msg.role === 'user' && idx + 1 < log.messages.length) {
        const nextMsg = log.messages[idx + 1]
        if (nextMsg?.role === 'assistant') pairIds.push(nextMsg.id)
      } else if (msg.role === 'assistant' && idx - 1 >= 0) {
        const prevMsg = log.messages[idx - 1]
        if (prevMsg?.role === 'user') pairIds.push(prevMsg.id)
      }
      logs.value = logs.value.map((item) =>
        item.id === log.id
          ? {
              ...item,
              messages: item.messages.filter((m) => !pairIds.includes(m.id)),
              messageCount: Math.max(0, item.messageCount - pairIds.length),
            }
          : item,
      )
    }
  }

  // 异步删除
  try {
    await chatApi.deleteMessagePair(id)
  } catch (err) {
    logger.error('LogsTab', '日志删除失败', err)
  }
}

// ══════ 调试日志查看器 ══════
const showDebugDialog = ref(false)
const currentDebugMsg = ref<LogMessage | null>(null)
const debugViewMode = ref<'response' | 'raw'>('response')
const debugSegments = ref<DebugSegment[]>([])

/** 打开调试弹窗 */
function openDebugDialog(msg: LogMessage) {
  currentDebugMsg.value = msg
  debugViewMode.value = 'response'
  debugSegments.value = parseDebugSegments(msg.rawContent || msg.content)
  showDebugDialog.value = true
}

/**
 * 解析 Thinking/Monologue/NIT 块
 * 对标 v1 的 parseDebugResponseContent 逻辑
 */
function parseDebugSegments(text: string): DebugSegment[] {
  const segments: DebugSegment[] = []
  // 匹配中文【】和英文 [] 两种格式
  const regex = /[\u3010[]\s*(Thinking|Monologue|NIT)\s*[:：]?\s*([\s\S]*?)[\u3011\]]/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // 匹配前的普通文本
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: 'text', content: before })
    }
    const matchTag = match[1]
    const matchContent = match[2]
    if (matchTag && matchContent) {
      const tag = matchTag.toLowerCase() as 'thinking' | 'monologue' | 'nit'
      segments.push({ type: tag, content: matchContent.trim() })
    }
    lastIndex = match.index + match[0].length
  }

  // 剩余文本
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim()
    if (rest) segments.push({ type: 'text', content: rest })
  }

  // 如果没有解析到任何特殊块，整个作为文本
  if (segments.length === 0) {
    segments.push({ type: 'text', content: text })
  }

  return segments
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => fetchSessions(),
)

onMounted(async () => {
  // Dashboard 窗口可能独立于 Launcher 打开，需要先拿到完整 Agent 列表再渲染筛选项和显示名
  if (!agentStore.agents.length) await agentStore.fetchAgents()
  await fetchSessions()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
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
              class="relative flex items-center gap-2 px-3 py-1.5 bg-sky-50/60 pixel-border-sky group/avatar cursor-default hover:bg-sky-50 transition-all"
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
              <span
                class="text-sm font-bold text-sky-600 group-hover/avatar:text-sky-700 transition-colors"
              >
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
            <PSelect v-model="filterSource" :options="sourceOptions" @change="fetchSessions" />
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

      <div v-else class="space-y-6 max-w-4xl mx-auto">
        <div v-for="log in filteredLogs" :key="log.id" class="group/session">
          <!-- 会话头 -->
          <PCard pixel hoverable padding="sm" class="cursor-pointer" @click="toggleExpand(log.id)">
            <div class="flex justify-between items-center relative">
              <!-- 头像 + 摘要 -->
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-11 h-11 flex items-center justify-center bg-gradient-to-br from-sky-400 to-sky-600 text-white font-black text-base flex-shrink-0 shadow-lg shadow-sky-200/30 group-hover/session:scale-110 group-hover/session:rotate-6 transition-all duration-500 relative overflow-hidden"
                >
                  <img
                    v-if="getAgentAvatar(log.agentId)"
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
                      {{ log.source }}
                    </span>
                    <span class="text-[10px] text-slate-400 font-pixel">
                      {{ formatDate(log.createdAt) }}
                    </span>
                  </div>
                </div>
              </div>
              <!-- 展开指示 -->
              <PixelIcon
                :name="expandedId === log.id ? 'chevron-up' : 'chevron-down'"
                size="xs"
                class="text-slate-400 flex-shrink-0 transition-transform duration-500"
                :class="expandedId === log.id ? 'rotate-0' : ''"
              />
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
                  class="flex-none w-9 h-9 flex items-center justify-center text-sm shadow-md border transition-all duration-500 group-hover/msg:scale-110 group-hover/msg:rotate-3 relative overflow-hidden flex-shrink-0"
                  :class="
                    msg.role === 'user'
                      ? 'bg-sky-50 text-sky-600 border-sky-200 shadow-sky-100/30'
                      : 'bg-white text-purple-500 border-purple-100 shadow-purple-100/20'
                  "
                >
                  <PixelIcon
                    v-if="msg.role === 'user'"
                    name="user"
                    size="sm"
                    class="relative z-10"
                  />
                  <template v-else>
                    <img
                      v-if="getAgentAvatar(log.agentId)"
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
                      {{ msg.role === 'user' ? '主人' : log.agentName }}
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
                  </div>

                  <!-- 气泡主体 -->
                  <div
                    class="relative px-5 py-3 text-[13px] leading-relaxed shadow-md transition-all duration-500 border group/bubble"
                    :class="
                      msg.role === 'user'
                        ? 'bg-sky-50/80 text-slate-700 border-sky-100 hover:border-sky-300 shadow-sky-100/30'
                        : 'bg-white/80 text-slate-700 border-purple-100 hover:border-purple-300 shadow-purple-100/20'
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
                      class="absolute -top-4 right-2 opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center shadow-md bg-white border border-slate-200 z-20 rounded-sm overflow-hidden"
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
  <PDialog v-model="showDebugDialog" title="对话调试详情 (Debug View)" width="800px">
    <div v-if="currentDebugMsg" class="space-y-4">
      <!-- 顶部控制栏 -->
      <div class="flex justify-start mb-2">
        <div
          class="inline-flex p-1 bg-slate-100 border-[3px] border-slate-200 gap-1 focus:outline-none"
        >
          <button
            v-for="mode in [
              { label: '💬 解析视图', value: 'response' as const },
              { label: '📄 原始文本', value: 'raw' as const },
            ]"
            :key="mode.value"
            class="px-6 py-2 text-xs font-bold transition-all uppercase tracking-wider focus:outline-none"
            :class="
              debugViewMode === mode.value
                ? 'bg-sky-500 text-white shadow-md transform -translate-y-px'
                : 'text-slate-500 hover:bg-slate-200 border border-transparent'
            "
            @click="debugViewMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>

      <!-- 元信息 -->
      <div
        class="flex flex-wrap items-center gap-4 bg-sky-50/50 border border-sky-100 p-3 text-[11px] text-sky-700 font-pixel"
      >
        <div class="flex items-center gap-1.5">
          <span class="opacity-50 uppercase">Log ID:</span>
          <span class="font-bold border-b border-sky-200">{{ currentDebugMsg.id }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="opacity-50 uppercase">Role:</span>
          <span
            class="px-1.5 py-0.5 font-bold uppercase tracking-wider bg-white border"
            :class="
              currentDebugMsg.role === 'user'
                ? 'border-sky-200 text-sky-600'
                : 'border-purple-200 text-purple-600'
            "
          >
            {{ currentDebugMsg.role }}
          </span>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <span class="opacity-50 uppercase">Storage:</span>
          <span class="font-bold flex items-center gap-1">
            <template v-if="currentDebugMsg.rawContent">
              <PixelIcon name="check" size="xs" class="text-emerald-500" />
              已保存原始日志 ({{ currentDebugMsg.rawContent.length }} bytes)
            </template>
            <template v-else>
              <PixelIcon name="close" size="xs" class="text-rose-500" />
              无原始数据
            </template>
          </span>
        </div>
      </div>

      <!-- 模式 1: 回复解析 -->
      <div
        v-if="debugViewMode === 'response'"
        class="space-y-3 max-h-[50vh] overflow-y-auto pr-2 logs-scrollbar"
      >
        <div
          v-for="(segment, idx) in debugSegments"
          :key="idx"
          class="border overflow-hidden transition-colors duration-200"
          :class="{
            'bg-amber-50 border-amber-200': segment.type === 'thinking',
            'bg-sky-50 border-sky-200': segment.type === 'monologue',
            'bg-cyan-50 border-cyan-200': segment.type === 'nit',
            'bg-white border-slate-100 shadow-sm': segment.type === 'text',
          }"
        >
          <!-- 标签头 -->
          <div
            v-if="segment.type === 'thinking'"
            class="px-3 py-1.5 bg-amber-100/50 text-amber-700 text-xs font-bold border-b border-amber-200 flex items-center gap-2"
          >
            <PixelIcon name="brain" size="xs" />
            Thinking Chain (思维链)
          </div>
          <div
            v-else-if="segment.type === 'monologue'"
            class="px-3 py-1.5 bg-sky-100/50 text-sky-700 text-xs font-bold border-b border-sky-200 flex items-center gap-2"
          >
            <PixelIcon name="chat" size="xs" />
            Inner Monologue (内心独白)
          </div>
          <div
            v-else-if="segment.type === 'nit'"
            class="px-3 py-1.5 bg-cyan-100/50 text-cyan-700 text-xs font-bold border-b border-cyan-200 flex items-center gap-2"
          >
            <PixelIcon name="terminal" size="xs" />
            NIT Script (工具调用)
          </div>

          <!-- 内容 -->
          <div class="p-3 text-sm leading-relaxed overflow-x-auto">
            <div
              v-if="segment.type === 'thinking'"
              class="text-slate-600 font-mono text-xs whitespace-pre-wrap"
            >
              {{ segment.content }}
            </div>
            <div v-else-if="segment.type === 'monologue'" class="text-slate-600 italic">
              {{ segment.content }}
            </div>
            <div
              v-else-if="segment.type === 'nit'"
              class="text-cyan-800 font-mono text-xs whitespace-pre-wrap bg-cyan-50/50 p-2"
            >
              {{ segment.content }}
            </div>
            <div v-else class="text-slate-700 whitespace-pre-wrap">
              {{ segment.content }}
            </div>
          </div>
        </div>

        <div v-if="debugSegments.length === 0" class="text-center py-8 text-slate-400 text-sm">
          无可解析的调试信息
        </div>
      </div>

      <!-- 触发一次热更新 (HMR 强制重建 DOM 树) -->
      <!-- 模式 2: 原始内容 -->
      <div v-else class="max-h-[50vh] overflow-y-auto pr-2 logs-scrollbar">
        <pre
          class="p-4 bg-slate-50 border border-slate-200 text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto"
        >
        {{ currentDebugMsg.rawContent || currentDebugMsg.content }}</pre
        >
      </div>
    </div>

    <template #footer>
      <PButton variant="secondary" size="sm" @click="showDebugDialog = false">关闭</PButton>
    </template>
  </PDialog>
</template>

<style scoped>
/* 像素风滚动条 */
.logs-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.logs-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
