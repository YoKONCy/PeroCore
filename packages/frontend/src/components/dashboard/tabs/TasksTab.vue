<script setup lang="ts">
/**
 * TasksTab — 任务管理 Tab (F1-4)
 *
 * 展示后台任务列表，支持手动触发。
 * F3: 已对接 schedulerApi 真实后端。
 */
import { ref, computed, onMounted } from 'vue'
import { PixelIcon, PButton } from '../../pixel'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import type { SchedulerTask } from '../../../api/modules/schedulerApi'

// ── 类型 ──

type TaskStatus = 'running' | 'idle' | 'completed' | 'error'

interface TaskItem {
  id: string
  name: string
  description: string
  status: TaskStatus
  intervalDesc: string
  lastRunAt: string
  nextRunAt: number
  totalRuns: number
  successCount: number
  errorCount: number
  lastError?: string
  lastDurationMs?: number
}

// ── 状态 ──

const tasks = ref<TaskItem[]>([])
const isLoading = ref(false)
const showHistory = ref(false)

const activeTasks = computed(() => tasks.value.filter((t) => t.status === 'running'))
const idleTasks = computed(() => tasks.value.filter((t) => t.status !== 'running'))

const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
  running: { label: '运行中', color: 'status-running' },
  idle: { label: '空闲', color: 'status-completed' },
  completed: { label: '就绪', color: 'status-completed' },
  error: { label: '有错误', color: 'status-failed' },
}

// ── API 操作 ──

/** 从后端加载任务列表 */
async function fetchTasks(): Promise<void> {
  isLoading.value = true
  try {
    const res = await schedulerApi.tasks()
    if (res.data) {
      tasks.value = res.data.items.map(toTaskItem)
    }
  } catch (e) {
    console.error('[TasksTab] 加载任务列表失败:', e)
  } finally {
    isLoading.value = false
  }
}

/** 手动触发任务 */
async function triggerTask(name: string): Promise<void> {
  try {
    await schedulerApi.trigger(name)
    // 刷新列表
    await fetchTasks()
  } catch (e) {
    console.error('[TasksTab] 触发任务失败:', e)
  }
}

/** SchedulerTask → TaskItem */
function toTaskItem(t: SchedulerTask): TaskItem {
  let status: TaskStatus = 'idle'
  if (t.running) status = 'running'
  else if (t.stats.errorCount > 0 && t.stats.lastError) status = 'error'

  return {
    id: t.name,
    name: t.name,
    description: `${t.name} (间隔: ${t.intervalDesc})`,
    status,
    intervalDesc: t.intervalDesc,
    lastRunAt: t.lastRunAtIso,
    nextRunAt: t.nextRunAt,
    totalRuns: t.stats.totalRuns,
    successCount: t.stats.successCount,
    errorCount: t.stats.errorCount,
    lastError: t.stats.lastError,
    lastDurationMs: t.stats.lastDurationMs,
  }
}

function formatElapsed(ms: number | undefined): string {
  if (!ms) return '-'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

onMounted(fetchTasks)
</script>

<template>
  <div class="tab-tasks">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="list" size="md" />
        <span>后台任务</span>
        <span v-if="activeTasks.length > 0" class="task-active-count"
          >{{ activeTasks.length }} 运行中</span
        >
      </h2>
      <p class="tab-subtitle">SCHEDULER TASKS</p>
    </div>

    <!-- 运行中的任务 -->
    <h3 class="section-label">
      <span class="section-dot section-dot-active" />
      运行中 ({{ activeTasks.length }})
    </h3>

    <div v-if="activeTasks.length === 0" class="task-empty-hint">
      <PixelIcon name="check" size="sm" />
      <span>当前没有运行中的任务</span>
    </div>
    <div v-else class="task-list">
      <div v-for="task in activeTasks" :key="task.id" class="task-item task-item-active">
        <div class="task-item-main">
          <div class="task-agent-dot" />
          <div class="task-info">
            <h4 class="task-desc">{{ task.description }}</h4>
            <div class="task-meta">
              <span :class="['task-status', statusMeta[task.status].color]">
                {{ statusMeta[task.status].label }}
              </span>
              <span class="task-meta-item">{{ task.totalRuns }} 次执行</span>
              <span class="task-meta-item">{{ formatElapsed(task.lastDurationMs) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 已注册的任务列表 -->
    <h3
      class="section-label"
      style="margin-top: 24px; cursor: pointer"
      @click="showHistory = !showHistory"
    >
      <span class="section-dot" />
      全部任务 ({{ idleTasks.length }})
      <PixelIcon :name="showHistory ? 'chevron-up' : 'chevron-down'" size="xs" />
    </h3>

    <div v-if="showHistory" class="task-list">
      <div v-for="task in idleTasks" :key="task.id" class="task-item">
        <div class="task-item-main">
          <div class="task-info">
            <h4 class="task-desc task-desc-muted">{{ task.description }}</h4>
            <div class="task-meta">
              <span :class="['task-status', statusMeta[task.status].color]">
                {{ statusMeta[task.status].label }}
              </span>
              <span class="task-meta-item">共 {{ task.totalRuns }} 次</span>
              <span class="task-meta-item">成功 {{ task.successCount }}</span>
              <span
                v-if="task.errorCount > 0"
                class="task-meta-item"
                style="color: var(--color-red-face, #ef4444)"
              >
                失败 {{ task.errorCount }}
              </span>
              <span class="task-meta-item">{{ formatTime(task.lastRunAt) }}</span>
            </div>
            <div v-if="task.lastError" class="task-error-hint">最近错误: {{ task.lastError }}</div>
          </div>
        </div>
        <div class="task-actions">
          <PButton variant="ghost" size="sm" @click.stop="triggerTask(task.name)">
            手动触发
          </PButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-tasks {
  padding: 32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.tab-header {
  margin-bottom: 24px;
}
.tab-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.task-active-count {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 10px;
  background: var(--color-green-50, rgba(34, 197, 94, 0.1));
  color: var(--color-emerald-shadow, #16a34a);
  border: 1px solid rgba(34, 197, 94, 0.3);
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

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 12px;
}
.section-dot {
  width: 6px;
  height: 6px;
  background: var(--color-text-muted);
}
.section-dot-active {
  background: var(--color-emerald-face, #22c55e);
  animation: pulse 2s infinite;
}

.task-empty-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 700;
  border: 1px dashed var(--color-border);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  transition: all 0.2s;
}
.task-item:hover {
  border-color: var(--color-sky-light);
}
.task-item-active {
  border-left: 3px solid var(--color-emerald-face, #22c55e);
}
.task-item-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.task-agent-dot {
  width: 8px;
  height: 8px;
  background: var(--color-emerald-face, #22c55e);
  flex-shrink: 0;
  animation: pulse 2s infinite;
}
.task-info {
  min-width: 0;
}
.task-desc {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-desc-muted {
  color: var(--color-text-secondary);
}
.task-meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.task-meta-item {
  font-size: 10px;
  color: var(--color-text-muted);
}
.task-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
}
.status-running {
  color: var(--color-emerald-shadow, #16a34a);
  background: rgba(34, 197, 94, 0.1);
}
.status-paused {
  color: var(--color-yellow-600, #d97706);
  background: rgba(234, 179, 8, 0.1);
}
.status-completed {
  color: var(--color-sky-shadow);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
}
.status-cancelled {
  color: var(--color-text-muted);
  background: var(--color-bg-secondary);
}
.status-failed {
  color: var(--color-red-face, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}
.task-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.task-error-hint {
  font-size: 10px;
  color: var(--color-red-face, #ef4444);
  margin-top: 4px;
  opacity: 0.8;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
