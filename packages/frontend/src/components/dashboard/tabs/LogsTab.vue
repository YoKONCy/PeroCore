<script setup lang="ts">
/**
 * LogsTab — 对话日志 Tab (F1-3)
 *
 * 按日期分组展示会话日志，支持搜索、Agent 筛选、展开详情。
 * F3: 已对接 sessionsApi 真实后端。
 */
import { ref, computed, onMounted } from 'vue'
import { PixelIcon, PInput, PSelect, PButton, PEmpty } from '../../pixel'
import { sessionsApi } from '../../../api/modules/sessionsApi'
import type { SessionSummary } from '../../../api/modules/sessionsApi'

// ── 类型 ──

interface LogEntry {
  id: string
  sessionId: string
  agentId: string
  agentName: string
  summary: string
  messageCount: number
  createdAt: string
  /** 展开后加载的消息 */
  messages: Array<{ role: string; content: string }>
  /** 消息是否已加载 */
  messagesLoaded: boolean
}

// ── 状态 ──

const logs = ref<LogEntry[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const filterAgent = ref('all')
const expandedId = ref<string | null>(null)
const currentPage = ref(1)
const totalCount = ref(0)
const pageSize = 20

const agentOptions = [
  { label: '所有 Agent', value: 'all' },
  { label: 'Pero', value: 'pero' },
]

const filteredLogs = computed(() => {
  let list = logs.value
  if (filterAgent.value !== 'all') {
    list = list.filter((l) => l.agentId === filterAgent.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((l) => l.summary.toLowerCase().includes(q))
  }
  return list
})

// ── API 操作 ──

/** 从后端加载会话列表 */
async function fetchSessions(): Promise<void> {
  isLoading.value = true
  try {
    const agentId = filterAgent.value !== 'all' ? filterAgent.value : undefined
    const res = await sessionsApi.list({
      agentId,
      page: currentPage.value,
      pageSize,
    })
    const data = res.data
    if (data) {
      logs.value = data.items.map(toLogEntry)
      totalCount.value = data.total
    }
  } catch (e) {
    console.error('[LogsTab] 加载会话列表失败:', e)
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

  // 懒加载消息
  const log = logs.value.find((l) => l.id === id)
  if (log && !log.messagesLoaded) {
    try {
      const res = await sessionsApi.detail(log.sessionId, { agentId: log.agentId, limit: 20 })
      if (res.data) {
        log.messages = res.data.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
        log.messagesLoaded = true
      }
    } catch (e) {
      console.error('[LogsTab] 加载会话详情失败:', e)
    }
  }
}

/** SessionSummary → LogEntry */
function toLogEntry(s: SessionSummary): LogEntry {
  return {
    id: s.sessionId,
    sessionId: s.sessionId,
    agentId: s.agentId,
    agentName: s.agentId === 'pero' ? 'Pero' : s.agentId,
    summary: s.preview || `会话 ${s.sessionId.slice(0, 8)}...`,
    messageCount: s.messageCount,
    createdAt: s.lastMessageAt,
    messages: [],
    messagesLoaded: false,
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

onMounted(fetchSessions)
</script>

<template>
  <div class="tab-logs">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="chat" size="md" /><span>对话日志</span></h2>
      <p class="tab-subtitle">CONVERSATION LOGS</p>
    </div>

    <!-- 工具栏 -->
    <div class="logs-toolbar">
      <PInput v-model="searchQuery" placeholder="搜索对话摘要..." class="logs-search" />
      <PSelect v-model="filterAgent" :options="agentOptions" class="logs-filter" />
      <PButton variant="ghost">
        <PixelIcon name="download" size="xs" />
        导出
      </PButton>
    </div>

    <!-- 日志列表 -->
    <div v-if="filteredLogs.length === 0" class="logs-empty">
      <PEmpty description="没有匹配的对话日志" />
    </div>
    <div v-else class="logs-list">
      <div v-for="log in filteredLogs" :key="log.id" class="log-item" @click="toggleExpand(log.id)">
        <div class="log-header">
          <div class="log-header-left">
            <div class="log-agent-avatar">{{ log.agentName[0] }}</div>
            <div class="log-info">
              <h4 class="log-summary">{{ log.summary }}</h4>
              <div class="log-meta">
                <span class="log-meta-item">
                  <PixelIcon name="chat" size="xs" /> {{ log.messageCount }} 条
                </span>

                <span class="log-meta-item">{{ formatDate(log.createdAt) }}</span>
              </div>
            </div>
          </div>
          <PixelIcon
            :name="expandedId === log.id ? 'chevron-up' : 'chevron-down'"
            size="xs"
            class="log-expand-icon"
          />
        </div>

        <!-- 展开内容 -->
        <div v-if="expandedId === log.id" class="log-preview">
          <div v-for="(msg, i) in log.messages" :key="i" class="log-msg">
            <span
              :class="['log-msg-role', msg.role === 'user' ? 'log-msg-user' : 'log-msg-assistant']"
            >
              {{ msg.role === 'user' ? '你' : log.agentName }}
            </span>
            <span class="log-msg-content">{{ msg.content }}</span>
          </div>
          <p class="log-preview-hint">展示前 {{ log.messages.length }} 条消息 · 点击查看完整对话</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-logs {
  padding: 32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tab-header {
  margin-bottom: 24px;
  flex-shrink: 0;
}
.tab-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.tab-subtitle {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  margin-top: 4px;
  margin-left: 36px;
}

.logs-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
  flex-shrink: 0;
}
.logs-search {
  flex: 1;
  max-width: 300px;
}
.logs-filter {
  width: 140px;
}

.logs-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.logs-list::-webkit-scrollbar {
  width: 4px;
}
.logs-list::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
.logs-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.log-item {
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.log-item:hover {
  border-color: var(--color-sky-light);
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.log-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.log-agent-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-sky-hover), var(--color-sky-shadow));
  color: white;
  font-weight: 800;
  font-size: 14px;
  flex-shrink: 0;
}
.log-info {
  min-width: 0;
}
.log-summary {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}
.log-meta-item {
  font-size: 10px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 3px;
}
.log-expand-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.log-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.log-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.log-msg-role {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  flex-shrink: 0;
}
.log-msg-user {
  color: var(--color-sky-shadow);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
}
.log-msg-assistant {
  color: var(--color-pink-shadow, #db2777);
  background: rgba(236, 72, 153, 0.1);
}
.log-msg-content {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.log-preview-hint {
  font-size: 10px;
  color: var(--color-text-muted);
  text-align: center;
  font-style: italic;
}
</style>
