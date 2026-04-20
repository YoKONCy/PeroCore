<script setup lang="ts">
/**
 * LogsTab — 对话日志 Tab (F1-3)
 *
 * 按日期分组展示会话日志，支持搜索、Agent 筛选、展开详情。
 */
import { ref, computed } from 'vue'
import { PixelIcon, PInput, PSelect, PButton, PEmpty } from '../../pixel'

// ── 类型 ──

interface LogEntry {
  id: string
  sessionId: string
  agentId: string
  agentName: string
  summary: string
  messageCount: number
  tokenCount: number
  createdAt: string
  /** 消息片段预览 */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ── Mock 数据 ──

const mockLogs: LogEntry[] = [
  {
    id: 'log1', sessionId: 'sess-001', agentId: 'pero', agentName: 'Pero',
    summary: '完成了 PeroCore-TS 后端 B6 集成工作',
    messageCount: 24, tokenCount: 18500, createdAt: '2026-04-20T04:30:00Z',
    messages: [
      { role: 'user', content: '我们来做 B6-2 到 B6-5 吧' },
      { role: 'assistant', content: '好的主人！让我先重读一遍规范文档...' },
    ],
  },
  {
    id: 'log2', sessionId: 'sess-002', agentId: 'pero', agentName: 'Pero',
    summary: '讨论了 TriviumDB 0.5.1 版本发布',
    messageCount: 8, tokenCount: 5200, createdAt: '2026-04-20T05:00:00Z',
    messages: [
      { role: 'user', content: '更新一下 TriviumDB 的依赖到 0.5.1 版本吧' },
      { role: 'assistant', content: '好的主人！让我检查 package.json...' },
    ],
  },
  {
    id: 'log3', sessionId: 'sess-003', agentId: 'pero', agentName: 'Pero',
    summary: '分析了前端迁移状态',
    messageCount: 6, tokenCount: 12300, createdAt: '2026-04-20T05:20:00Z',
    messages: [
      { role: 'user', content: '深入对比分析一下整个 PeroCore-TS 和 PeroCore 的后端' },
      { role: 'assistant', content: '好的主人，让我仔仔细细地对比分析两个后端...' },
    ],
  },
  {
    id: 'log4', sessionId: 'sess-004', agentId: 'pero', agentName: 'Pero',
    summary: '迁移了 Dashboard 的 11 个 Tab 组件',
    messageCount: 32, tokenCount: 28000, createdAt: '2026-04-19T14:00:00Z',
    messages: [
      { role: 'user', content: '开始迁移 DashboardView' },
      { role: 'assistant', content: '了解！先分析 v1 的 DashboardView 结构...' },
    ],
  },
]

// ── 状态 ──

const logs = ref<LogEntry[]>(mockLogs)
const searchQuery = ref('')
const filterAgent = ref('all')
const expandedId = ref<string | null>(null)

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
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
}
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
                <span class="log-meta-item">
                  <PixelIcon name="sparkle" size="xs" /> {{ formatTokens(log.tokenCount) }} tokens
                </span>
                <span class="log-meta-item">{{ formatDate(log.createdAt) }}</span>
              </div>
            </div>
          </div>
          <PixelIcon :name="expandedId === log.id ? 'chevron-up' : 'chevron-down'" size="xs" class="log-expand-icon" />
        </div>

        <!-- 展开内容 -->
        <div v-if="expandedId === log.id" class="log-preview">
          <div v-for="(msg, i) in log.messages" :key="i" class="log-msg">
            <span :class="['log-msg-role', msg.role === 'user' ? 'log-msg-user' : 'log-msg-assistant']">
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
.tab-logs { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tab-header { margin-bottom: 24px; flex-shrink: 0; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }

.logs-toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-shrink: 0; }
.logs-search { flex: 1; max-width: 300px; }
.logs-filter { width: 140px; }

.logs-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.logs-list::-webkit-scrollbar { width: 4px; }
.logs-list::-webkit-scrollbar-thumb { background: var(--color-blue-200); }
.logs-empty { flex: 1; display: flex; align-items: center; justify-content: center; }

.log-item {
  border: 2px solid var(--color-border); background: var(--color-bg-primary);
  padding: 16px; cursor: pointer; transition: all 0.2s;
}
.log-item:hover { border-color: var(--color-blue-200); }

.log-header { display: flex; justify-content: space-between; align-items: center; }
.log-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.log-agent-avatar {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--color-blue-400), var(--color-blue-600));
  color: white; font-weight: 800; font-size: 14px; flex-shrink: 0;
}
.log-info { min-width: 0; }
.log-summary { font-size: 13px; font-weight: 700; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-meta { display: flex; gap: 12px; margin-top: 4px; }
.log-meta-item { font-size: 10px; color: var(--color-text-muted); display: flex; align-items: center; gap: 3px; }
.log-expand-icon { color: var(--color-text-muted); flex-shrink: 0; }

.log-preview { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; }
.log-msg { display: flex; gap: 8px; align-items: flex-start; }
.log-msg-role { font-size: 10px; font-weight: 700; padding: 1px 6px; flex-shrink: 0; }
.log-msg-user { color: var(--color-blue-600); background: var(--color-blue-50, rgba(56,189,248,0.1)); }
.log-msg-assistant { color: var(--color-pink-600, #db2777); background: rgba(236,72,153,0.1); }
.log-msg-content { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; }
.log-preview-hint { font-size: 10px; color: var(--color-text-muted); text-align: center; font-style: italic; }
</style>
