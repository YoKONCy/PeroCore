<script setup lang="ts">
/**
 * TasksTab — 待办提醒 & 后台任务 Tab (F1-4)
 *
 * 上半区：用户通过 Agent 创建的提醒 (reminder/topic/reaction)
 * 下半区：系统后台定时任务 (cron scheduler)
 *
 * F3: 已对接 schedulerApi 真实后端。
 */
import { ref, shallowRef, computed, onMounted, watch } from 'vue'
import { PixelIcon, PButton, PCard, PEmpty } from '../../pixel'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import type { SchedulerTask, ReminderItem } from '../../../api/modules/schedulerApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { logger } from '../../../lib/logger'

const ctx = useDashboardContext()

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

/** 用户提醒列表 */
const reminders = shallowRef<ReminderItem[]>([])
const isLoadingReminders = ref(false)

/** 系统后台任务列表 */
const tasks = shallowRef<TaskItem[]>([])
const isLoadingTasks = ref(false)
const showCronTasks = ref(false)

const activeTasks = computed(() => tasks.value.filter((t) => t.status === 'running'))
const idleTasks = computed(() => tasks.value.filter((t) => t.status !== 'running'))

const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
  running: { label: '运行中', color: 'status-running' },
  idle: { label: '空闲', color: 'status-ready' },
  completed: { label: '就绪', color: 'status-ready' },
  error: { label: '有错误', color: 'status-error' },
}

/** 提醒类型元数据 */
const reminderTypeMeta: Record<string, { label: string; icon: string; color: string }> = {
  reminder: { label: '提醒', icon: 'bell', color: 'text-amber-500 bg-amber-50' },
  topic: { label: '话题', icon: 'chat', color: 'text-sky-500 bg-sky-50' },
  reaction: { label: '反应', icon: 'flash', color: 'text-rose-500 bg-rose-50' },
}

// ── API 操作 ──

/** 加载用户提醒列表 */
async function fetchReminders(): Promise<void> {
  isLoadingReminders.value = true
  try {
    const res = await schedulerApi.reminders()
    if (res.data) {
      reminders.value = res.data.items
    }
  } catch (e) {
    logger.error('TasksTab', '加载提醒列表失败', e)
  } finally {
    isLoadingReminders.value = false
  }
}

/** 加载系统后台任务列表 */
async function fetchTasks(): Promise<void> {
  isLoadingTasks.value = true
  try {
    const res = await schedulerApi.tasks()
    if (res.data) {
      tasks.value = res.data.items.map(toTaskItem)
    }
  } catch (e) {
    logger.error('TasksTab', '加载任务列表失败', e)
  } finally {
    isLoadingTasks.value = false
  }
}

/** 手动触发任务 */
async function triggerTask(name: string): Promise<void> {
  try {
    await schedulerApi.trigger(name)
    await fetchTasks()
  } catch (e) {
    logger.error('TasksTab', '触发任务失败', e)
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

function formatReminderTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()

  // 格式化日期 + 时间
  const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  // 计算相对时间
  if (diffMs < 0) return `${dateStr} ${timeStr} (已过期)`
  const hours = Math.floor(diffMs / 3600_000)
  const mins = Math.floor((diffMs % 3600_000) / 60_000)
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${dateStr} ${timeStr} (${days}天后)`
  }
  if (hours > 0) return `${dateStr} ${timeStr} (${hours}h${mins}m后)`
  return `${timeStr} (${mins}分钟后)`
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => {
    fetchReminders()
    fetchTasks()
  },
)

onMounted(() => {
  fetchReminders()
  fetchTasks()
})
</script>

<template>
  <div class="p-8 h-full flex flex-col overflow-y-auto">
    <!-- ═══ 标题区 ═══ -->
    <div class="mb-6 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-amber-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-amber-400/15 transition-all duration-1000"
      />
      <h2 class="flex items-center gap-3 text-2xl font-black text-slate-800 font-pixel">
        <span
          class="group-hover/header:scale-110 group-hover/header:rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="bell" size="md" />
        </span>
        <span>待办提醒</span>
        <span
          v-if="reminders.length > 0"
          class="text-[11px] font-bold px-2.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-300/30"
        >
          {{ reminders.length }} 条待触发
        </span>
        <span class="opacity-0 group-hover/header:opacity-100 transition-opacity duration-500">
          <PixelIcon name="sparkle" size="xs" />
        </span>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        REMINDERS & TOPICS
      </p>
    </div>

    <!-- ═══ 用户提醒列表 ═══ -->
    <div class="mb-8">
      <!-- 空状态 -->
      <PEmpty
        v-if="!isLoadingReminders && reminders.length === 0"
        icon="bell"
        title="暂无待办提醒"
        description="通过聊天让 Agent 帮你设置提醒吧~"
      />

      <!-- 提醒卡片列表 -->
      <div v-else class="flex flex-col gap-2.5">
        <PCard v-for="item in reminders" :key="item.id" pixel hoverable class="group/reminder">
          <div class="flex items-start gap-3.5">
            <!-- 类型图标 -->
            <div
              class="flex-shrink-0 mt-0.5 p-2.5 pixel-border-sm group-hover/reminder:scale-110 transition-transform"
              :class="reminderTypeMeta[item.type]?.color ?? 'text-slate-400 bg-slate-50'"
            >
              <PixelIcon :name="reminderTypeMeta[item.type]?.icon ?? 'list'" size="sm" />
            </div>

            <!-- 内容 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="text-[10px] font-bold px-1.5 py-0.5 font-pixel"
                  :class="reminderTypeMeta[item.type]?.color ?? 'text-slate-400 bg-slate-50'"
                >
                  {{ reminderTypeMeta[item.type]?.label ?? item.type }}
                </span>
                <span class="text-[10px] text-slate-400 font-pixel">#{{ item.id }}</span>
              </div>
              <h4 class="text-[13px] font-bold text-slate-700 leading-relaxed">
                {{ item.content }}
              </h4>
              <div class="flex items-center gap-2 mt-1.5">
                <PixelIcon name="clock" size="xs" class="text-slate-400" />
                <span class="text-[11px] text-slate-400 font-pixel">
                  {{ formatReminderTime(item.time) }}
                </span>
              </div>
            </div>
          </div>
        </PCard>
      </div>
    </div>

    <!-- ═══ 系统后台任务 (折叠区) ═══ -->
    <div class="border-t border-slate-100 pt-6">
      <h3
        class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 cursor-pointer hover:text-slate-500 transition-colors select-none"
        @click="showCronTasks = !showCronTasks"
      >
        <PixelIcon name="desktop" size="xs" />
        系统后台任务 ({{ tasks.length }})
        <PixelIcon :name="showCronTasks ? 'chevron-up' : 'chevron-down'" size="xs" />
        <span
          v-if="activeTasks.length > 0"
          class="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-600 ml-1"
        >
          {{ activeTasks.length }} 运行中
        </span>
      </h3>

      <div v-if="showCronTasks" class="flex flex-col gap-2">
        <!-- 运行中 -->
        <div
          v-for="task in activeTasks"
          :key="task.id"
          class="flex justify-between items-center gap-3 px-4 py-3 bg-white pixel-border-emerald border-l-[3px] border-l-emerald-500 transition-all hover:translate-x-0.5"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-2 h-2 bg-emerald-500 flex-shrink-0 active-pulse" />
            <div class="min-w-0">
              <h4 class="text-[13px] font-bold text-slate-800 truncate">{{ task.description }}</h4>
              <div class="flex gap-2.5 mt-1">
                <span
                  :class="['text-[10px] font-bold px-1.5 py-0.5', statusMeta[task.status].color]"
                >
                  {{ statusMeta[task.status].label }}
                </span>
                <span class="text-[10px] text-slate-400">{{ task.totalRuns }} 次执行</span>
                <span class="text-[10px] text-slate-400 font-pixel">
                  {{ formatElapsed(task.lastDurationMs) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 空闲 -->
        <PCard
          v-for="task in idleTasks"
          :key="task.id"
          pixel
          class="flex justify-between items-center gap-3"
        >
          <div class="min-w-0">
            <h4 class="text-[13px] font-bold text-slate-500 truncate">{{ task.description }}</h4>
            <div class="flex gap-2.5 mt-1">
              <span :class="['text-[10px] font-bold px-1.5 py-0.5', statusMeta[task.status].color]">
                {{ statusMeta[task.status].label }}
              </span>
              <span class="text-[10px] text-slate-400">共 {{ task.totalRuns }} 次</span>
              <span class="text-[10px] text-slate-400">成功 {{ task.successCount }}</span>
              <span v-if="task.errorCount > 0" class="text-[10px] text-rose-500">
                失败 {{ task.errorCount }}
              </span>
              <span class="text-[10px] text-slate-400 font-pixel">
                {{ formatTime(task.lastRunAt) }}
              </span>
            </div>
            <div v-if="task.lastError" class="text-[10px] text-rose-500/80 mt-1">
              最近错误: {{ task.lastError }}
            </div>
          </div>
          <div class="flex gap-1.5 flex-shrink-0">
            <PButton variant="ghost" size="sm" @click.stop="triggerTask(task.name)">
              手动触发
            </PButton>
          </div>
        </PCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 状态标签颜色 */
.status-running {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.1);
}

.status-ready {
  color: #0284c7;
  background: rgba(56, 189, 248, 0.1);
}

.status-error {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

/* 运行中脉冲 */
@keyframes active-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.active-pulse {
  animation: active-pulse 2s infinite;
}
</style>
