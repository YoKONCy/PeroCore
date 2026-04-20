<script setup lang="ts">
/**
 * TasksTab — 待办任务 Tab (F1-4)
 *
 * 展示活跃/历史任务列表，支持暂停/恢复/取消操作。
 */
import { ref, computed } from 'vue'
import { PixelIcon, PButton, PEmpty, PBadge } from '../../pixel'

// ── 类型 ──

type TaskStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'

interface TaskItem {
  id: string
  sessionId: string
  agentName: string
  description: string
  status: TaskStatus
  rounds: number
  startedAt: string
  elapsedMs: number
}

// ── Mock ──

const mockTasks: TaskItem[] = [
  { id: 't1', sessionId: 's001', agentName: 'Pero', description: '前端 Dashboard Tabs 实装', status: 'running', rounds: 3, startedAt: '2026-04-20T12:50:00Z', elapsedMs: 120000 },
  { id: 't2', sessionId: 's002', agentName: 'Pero', description: '分析后端迁移完成度', status: 'completed', rounds: 8, startedAt: '2026-04-20T05:20:00Z', elapsedMs: 480000 },
  { id: 't3', sessionId: 's003', agentName: 'Pero', description: 'B6 集成 — ReAct + NIT v3', status: 'completed', rounds: 15, startedAt: '2026-04-19T20:30:00Z', elapsedMs: 1800000 },
  { id: 't4', sessionId: 's004', agentName: 'Pero', description: 'TriviumDB 0.5.1 tag 推送', status: 'failed', rounds: 2, startedAt: '2026-04-20T05:08:00Z', elapsedMs: 30000 },
]

const tasks = ref<TaskItem[]>(mockTasks)
const showHistory = ref(false)

const activeTasks = computed(() => tasks.value.filter((t) => t.status === 'running' || t.status === 'paused'))
const historyTasks = computed(() => tasks.value.filter((t) => t.status !== 'running' && t.status !== 'paused'))

const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
  running: { label: '运行中', color: 'status-running' },
  paused: { label: '已暂停', color: 'status-paused' },
  completed: { label: '已完成', color: 'status-completed' },
  cancelled: { label: '已取消', color: 'status-cancelled' },
  failed: { label: '失败', color: 'status-failed' },
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function pauseTask(id: string) {
  const t = tasks.value.find((t) => t.id === id)
  if (t) t.status = 'paused'
}
function resumeTask(id: string) {
  const t = tasks.value.find((t) => t.id === id)
  if (t) t.status = 'running'
}
function cancelTask(id: string) {
  const t = tasks.value.find((t) => t.id === id)
  if (t) t.status = 'cancelled'
}
</script>

<template>
  <div class="tab-tasks">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="list" size="md" />
        <span>待办任务</span>
        <span v-if="activeTasks.length > 0" class="task-active-count">{{ activeTasks.length }} 活跃</span>
      </h2>
      <p class="tab-subtitle">TASK MANAGER</p>
    </div>

    <!-- 活跃任务 -->
    <h3 class="section-label">
      <span class="section-dot section-dot-active" />
      活跃任务 ({{ activeTasks.length }})
    </h3>

    <div v-if="activeTasks.length === 0" class="task-empty-hint">
      <PixelIcon name="check" size="sm" />
      <span>当前没有活跃的任务</span>
    </div>
    <div v-else class="task-list">
      <div v-for="task in activeTasks" :key="task.id" class="task-item task-item-active">
        <div class="task-item-main">
          <div class="task-agent-dot" />
          <div class="task-info">
            <h4 class="task-desc">{{ task.description }}</h4>
            <div class="task-meta">
              <span :class="['task-status', statusMeta[task.status].color]">{{ statusMeta[task.status].label }}</span>
              <span class="task-meta-item">{{ task.agentName }}</span>
              <span class="task-meta-item">{{ task.rounds }} 轮</span>
              <span class="task-meta-item">{{ formatElapsed(task.elapsedMs) }}</span>
            </div>
          </div>
        </div>
        <div class="task-actions">
          <PButton v-if="task.status === 'running'" variant="ghost" size="sm" @click.stop="pauseTask(task.id)">暂停</PButton>
          <PButton v-if="task.status === 'paused'" variant="ghost" size="sm" @click.stop="resumeTask(task.id)">恢复</PButton>
          <PButton variant="danger" size="sm" @click.stop="cancelTask(task.id)">取消</PButton>
        </div>
      </div>
    </div>

    <!-- 历史任务 -->
    <h3 class="section-label" style="margin-top: 24px; cursor: pointer;" @click="showHistory = !showHistory">
      <span class="section-dot" />
      历史任务 ({{ historyTasks.length }})
      <PixelIcon :name="showHistory ? 'chevron-up' : 'chevron-down'" size="xs" />
    </h3>

    <div v-if="showHistory" class="task-list">
      <div v-for="task in historyTasks" :key="task.id" class="task-item">
        <div class="task-item-main">
          <div class="task-info">
            <h4 class="task-desc task-desc-muted">{{ task.description }}</h4>
            <div class="task-meta">
              <span :class="['task-status', statusMeta[task.status].color]">{{ statusMeta[task.status].label }}</span>
              <span class="task-meta-item">{{ task.rounds }} 轮</span>
              <span class="task-meta-item">{{ formatElapsed(task.elapsedMs) }}</span>
              <span class="task-meta-item">{{ formatTime(task.startedAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-tasks { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.task-active-count { font-size: 11px; font-weight: 700; padding: 2px 10px; background: var(--color-green-50, rgba(34,197,94,0.1)); color: var(--color-green-600, #16a34a); border: 1px solid rgba(34,197,94,0.3); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }

.section-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
.section-dot { width: 6px; height: 6px; background: var(--color-text-muted); }
.section-dot-active { background: var(--color-green-500, #22c55e); animation: pulse 2s infinite; }

.task-empty-hint { display: flex; align-items: center; gap: 8px; padding: 16px; color: var(--color-text-muted); font-size: 13px; font-weight: 700; border: 1px dashed var(--color-border); }

.task-list { display: flex; flex-direction: column; gap: 8px; }
.task-item {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 14px 16px; border: 2px solid var(--color-border); background: var(--color-bg-primary); transition: all 0.2s;
}
.task-item:hover { border-color: var(--color-blue-200); }
.task-item-active { border-left: 3px solid var(--color-green-500, #22c55e); }
.task-item-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.task-agent-dot { width: 8px; height: 8px; background: var(--color-green-500, #22c55e); flex-shrink: 0; animation: pulse 2s infinite; }
.task-info { min-width: 0; }
.task-desc { font-size: 13px; font-weight: 700; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-desc-muted { color: var(--color-text-secondary); }
.task-meta { display: flex; gap: 10px; margin-top: 4px; }
.task-meta-item { font-size: 10px; color: var(--color-text-muted); }
.task-status { font-size: 10px; font-weight: 700; padding: 1px 6px; }
.status-running { color: var(--color-green-600, #16a34a); background: rgba(34,197,94,0.1); }
.status-paused { color: var(--color-yellow-600, #d97706); background: rgba(234,179,8,0.1); }
.status-completed { color: var(--color-blue-600); background: var(--color-blue-50, rgba(56,189,248,0.1)); }
.status-cancelled { color: var(--color-text-muted); background: var(--color-bg-secondary); }
.status-failed { color: var(--color-red-500, #ef4444); background: rgba(239,68,68,0.1); }
.task-actions { display: flex; gap: 6px; flex-shrink: 0; }

@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
</style>
