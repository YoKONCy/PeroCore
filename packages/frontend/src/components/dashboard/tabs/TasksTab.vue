<script setup lang="ts">
/**
 * TasksTab — 任务中心（重构版）
 *
 * 三视图：
 * - 进行中：派发中的 BackgroundTask（活跃态）+ 待触发用户提醒
 * - 历史记录：completed/failed/cancelled 的归档（时间线样式条目）
 * - 定时与提醒：用户提醒列表 + 系统 cron 折叠区
 *
 * 视觉基线：soft-UI + ui 语义令牌（双主题安全），
 * 状态展示统一由 TaskStatusBadge / ReminderItem 承担。
 *
 * F3: 已对接 schedulerApi 真实后端。
 */
import {
  ref,
  shallowRef,
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  watch,
} from 'vue'
import { PixelIcon, PButton, PBadge, PEmpty } from '../../pixel'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import type {
  SchedulerTask,
  ReminderItem as ReminderItemData,
} from '../../../api/modules/schedulerApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { useTaskCenterStore } from '../../../stores/taskCenterStore'
import TaskCard from '../../taskCenter/TaskCard.vue'
import TaskDetailModal from '../../taskCenter/TaskDetailModal.vue'
import DispatchTaskModal from '../../taskCenter/DispatchTaskModal.vue'
import ReminderItem from '../../taskCenter/ReminderItem.vue'
import type { BackgroundTaskInfo } from '../../../api/modules/backgroundTasksApi'

import { useAgentStore, useThreadStore } from '../../../stores'
import { useNotificationStore } from '../../../stores/useNotificationStore'
import { getApiBaseUrl } from '../../../api/transport'
import { backgroundTasksApi } from '../../../api/modules/backgroundTasksApi'
import { agentApi, type CompanionStateResponse } from '../../../api/modules/agentApi'
import { logger } from '../../../lib/logger'

const ctx = useDashboardContext()
const taskCenter = useTaskCenterStore()
const agentStore = useAgentStore()
const threadStore = useThreadStore()
const notify = useNotificationStore()

/** 可用头像 URL（按 agentId 查 avatarUrl） */
function agentAvatarUrl(agentId: string): string | null {
  const url = agentStore.agents.find((a) => a.id === agentId)?.avatarUrl
  return url ? `${getApiBaseUrl()}${url}` : null
}

/** Agent 显示名 */
function agentDisplayName(agentId: string): string {
  return agentStore.agents.find((a) => a.id === agentId)?.name ?? agentId
}

// ── 三视图 ──
/** 当前激活的视图 */
const activeView = ref<'active' | 'history' | 'reminders'>('active')

/** 派发新任务弹窗 */
const isDispatchOpen = ref(false)
const dispatchTargetThreadId = ref<string | null>(null)

function openDispatch() {
  dispatchTargetThreadId.value = threadStore.threadId || null
  isDispatchOpen.value = true
}

/** 任务详情弹窗 */
const detailTask = ref<BackgroundTaskInfo | null>(null)

/** 关闭任务详情弹窗 */
function closeDetail() {
  detailTask.value = null
}

/** 恢复因服务重启中断的任务 */
async function resumeInterrupted(id: string) {
  try {
    await backgroundTasksApi.resumeInterrupted(id)
    await taskCenter.refreshActive()
    await taskCenter.refreshHistory()
    notify.toast('已恢复中断任务', { type: 'success', title: '任务中心' })
  } catch (err) {
    notify.toast(err instanceof Error ? err.message : '恢复失败', {
      type: 'error',
      title: '任务中心',
    })
    logger.error('TasksTab', '恢复中断任务失败', err)
  }
}

// ── 提醒 ──

const scheduledAgentTime = ref('')
const scheduledAgentInstruction = ref('')
const scheduledAgentId = ref('')
const creatingScheduledAgent = ref(false)

async function createScheduledAgentTask(): Promise<void> {
  if (
    !scheduledAgentId.value ||
    !scheduledAgentTime.value ||
    !scheduledAgentInstruction.value.trim()
  )
    return
  creatingScheduledAgent.value = true
  try {
    await schedulerApi.createAgentTask({
      agentId: scheduledAgentId.value,
      time: new Date(scheduledAgentTime.value).toISOString(),
      instruction: scheduledAgentInstruction.value.trim(),
    })
    scheduledAgentInstruction.value = ''
    await fetchReminders()
    notify.toast('定时 Agent 任务已创建', { type: 'success', title: '任务中心' })
  } finally {
    creatingScheduledAgent.value = false
  }
}

/** 用户提醒列表 */
const reminders = shallowRef<ReminderItemData[]>([])
const companionStates = shallowRef<CompanionStateResponse[]>([])
const isLoadingReminders = ref(false)

/** 加载陪伴调度只读状态。 */
async function fetchCompanionStates(): Promise<void> {
  try {
    const response = await agentApi.listCompanionStates()
    companionStates.value = response.data ?? []
  } catch (error) {
    logger.error('TasksTab', '加载陪伴调度状态失败', error)
  }
}

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

// ── 系统后台任务 ──

/** 系统后台任务列表，始终保持后端注册顺序 */
const cronTasks = shallowRef<SchedulerTask[]>([])
const showCronTasks = ref(false)
const cronLoading = ref(false)
const cronError = ref('')
const schedulerRunning = ref<boolean | null>(null)
const clockOffsetMs = ref(0)
const pageNow = ref(Date.now())
const triggeringTasks = ref(new Set<string>())
const expandedTasks = ref(new Set<string>())
const expandedHistoryTasks = ref(new Set<string>())
const markingHistoryRead = ref(false)

async function markHistoryRead(task: BackgroundTaskInfo): Promise<void> {
  if (task.readAt) {
    expandedHistoryTasks.value = new Set([...expandedHistoryTasks.value, task.id])
    detailTask.value = task
    return
  }
  try {
    await taskCenter.markRead(task.id)
    expandedHistoryTasks.value = new Set([...expandedHistoryTasks.value, task.id])
    detailTask.value = task
  } catch (error) {
    logger.warn('TasksTab', '标记历史记录已读失败', error)
  }
}

async function markAllHistoryRead(): Promise<void> {
  if (markingHistoryRead.value) return
  markingHistoryRead.value = true
  try {
    const count = await taskCenter.markAllRead()
    notify.toast(count > 0 ? `已读 ${count} 条历史记录` : '没有新的未读记录', {
      type: 'success',
      title: '任务中心',
    })
  } catch (error) {
    notify.toast(error instanceof Error ? error.message : '一键已读失败', {
      type: 'error',
      title: '任务中心',
    })
  } finally {
    markingHistoryRead.value = false
  }
}

async function deleteHistoryTask(task: BackgroundTaskInfo): Promise<void> {
  try {
    await taskCenter.remove(task.id)
    expandedHistoryTasks.value.delete(task.id)
    notify.toast('历史记录已删除', { type: 'success', title: '任务中心' })
  } catch (error) {
    notify.toast(error instanceof Error ? error.message : '删除记录失败', {
      type: 'error',
      title: '任务中心',
    })
  }
}

let cronTimer: ReturnType<typeof setInterval> | null = null
let componentActive = false

const runningCronTasks = computed(() => cronTasks.value.filter((task) => task.running).length)

/** 加载系统后台任务列表 */
async function fetchCronTasks(): Promise<void> {
  if (cronLoading.value) return
  cronLoading.value = true
  cronError.value = ''
  try {
    const res = await schedulerApi.tasks()
    if (!res.data) throw new Error('响应中缺少任务状态')
    cronTasks.value = res.data.items
    schedulerRunning.value = res.data.schedulerRunning
    clockOffsetMs.value = res.data.serverNow - Date.now()
    pageNow.value = Date.now()
  } catch (e) {
    schedulerRunning.value = null
    cronError.value = e instanceof Error ? e.message : '加载系统任务失败'
    logger.error('TasksTab', '加载系统任务列表失败', e)
  } finally {
    cronLoading.value = false
  }
}

function shouldPollCronTasks(): boolean {
  return componentActive && activeView.value === 'reminders' && showCronTasks.value
}

function stopCronPolling(): void {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
  }
}

function syncCronPolling(immediate = false): void {
  stopCronPolling()
  if (!shouldPollCronTasks()) return
  if (immediate) void fetchCronTasks()
  cronTimer = setInterval(() => {
    pageNow.value = Date.now()
    void fetchCronTasks()
  }, 30_000)
}

function toggleCronTasks(): void {
  showCronTasks.value = !showCronTasks.value
}

function toggleCronDetail(name: string): void {
  const next = new Set(expandedTasks.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedTasks.value = next
}

/** 手动触发系统任务 */
async function triggerCronTask(task: SchedulerTask): Promise<void> {
  if (triggeringTasks.value.has(task.name)) return
  triggeringTasks.value = new Set(triggeringTasks.value).add(task.name)
  try {
    await schedulerApi.trigger(task.name)
    await fetchCronTasks()
    notify.toast(`已触发 ${task.displayName}`, { type: 'success', title: '系统任务' })
  } catch (e) {
    logger.error('TasksTab', '触发系统任务失败', e)
    notify.toast('触发失败', { type: 'error', title: '系统任务' })
  } finally {
    const next = new Set(triggeringTasks.value)
    next.delete(task.name)
    triggeringTasks.value = next
  }
}

// ── 格式化工具 ──

function serverNow(): number {
  return pageNow.value + clockOffsetMs.value
}

function formatElapsed(ms: number | undefined): string {
  if (ms === undefined) return '-'
  if (ms < 1000) return `${ms} 毫秒`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
  return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`
}

function formatDateTime(timestamp: number | null): string {
  if (timestamp === null) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return '尚未执行'
  const elapsed = Math.max(0, serverNow() - timestamp)
  if (elapsed < 60_000) return '不足 1 分钟前'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return `${Math.floor(elapsed / 86_400_000)} 天前`
}

function formatCountdown(task: SchedulerTask): string {
  const remaining = Math.max(0, task.nextDueAt - serverNow())
  if (remaining === 0) return '等待调度'
  if (remaining < 60_000) return '不足 1 分钟'
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes ? `${hours} 小时 ${restMinutes} 分钟后` : `${hours} 小时后`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days} 天 ${restHours} 小时后` : `${days} 天后`
}

function progressPercent(task: SchedulerTask): number {
  if (task.running) return 100
  const cycleStartedAt = task.nextDueAt - task.intervalMs
  return Math.min(100, Math.max(0, ((serverNow() - cycleStartedAt) / task.intervalMs) * 100))
}

type CronVisualStatus = 'running' | 'error' | 'stopped' | 'unavailable' | 'due' | 'soon' | 'waiting'

function cronStatus(task: SchedulerTask): CronVisualStatus {
  if (schedulerRunning.value === null) return 'unavailable'
  if (!schedulerRunning.value) return 'stopped'
  if (task.running) return 'running'
  if (task.lastOutcome === 'error') return 'error'
  const remaining = task.nextDueAt - serverNow()
  if (remaining <= 0) return 'due'
  if (remaining <= Math.min(60_000, task.intervalMs * 0.1)) return 'soon'
  return 'waiting'
}

function statusText(task: SchedulerTask): string {
  const status = cronStatus(task)
  return {
    running: '运行中',
    error: '执行失败',
    stopped: '调度器已停止',
    unavailable: '状态不可用',
    due: '等待调度',
    soon: '即将执行',
    waiting: '等待中',
  }[status]
}

function statusVariant(
  task: SchedulerTask,
): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  const status = cronStatus(task)
  if (status === 'running') return 'success'
  if (status === 'error' || status === 'unavailable') return 'danger'
  if (status === 'soon' || status === 'due' || status === 'stopped') return 'warning'
  return 'primary'
}

function outcomeText(task: SchedulerTask): string {
  if (task.lastOutcome === 'success') return `成功 · ${formatRelative(task.lastFinishedAt)}`
  if (task.lastOutcome === 'error') return `失败 · ${formatRelative(task.lastFinishedAt)}`
  return '尚未执行'
}

/** 历史时间线条目结束时间（completedAt 优先，回退 updatedAt） */
function historyEndTime(task: BackgroundTaskInfo): string {
  const iso = task.completedAt ?? task.updatedAt
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── 生命周期 ──

watch(
  () => taskCenter.pendingOpenTask,
  (task) => {
    if (!task) return
    detailTask.value = task
    taskCenter.consumePendingOpenTask()
  },
  { immediate: true },
)

watch(
  () => ctx.refreshKey.value,
  () => {
    if (!scheduledAgentId.value)
      scheduledAgentId.value = agentStore.activeAgentId || agentStore.agents[0]?.id || ''
    fetchReminders()
    fetchCompanionStates()
    fetchCronTasks()
  },
)

watch([activeView, showCronTasks], () => syncCronPolling(true))

onMounted(() => {
  componentActive = true
  if (!scheduledAgentId.value)
    scheduledAgentId.value = agentStore.activeAgentId || agentStore.agents[0]?.id || ''
  fetchReminders()
  fetchCompanionStates()
  // M05: 历史任务首次进入时预加载（进行中已由 MainView 全局拉取）
  taskCenter.refreshHistory()
  syncCronPolling(true)
})

onActivated(() => {
  componentActive = true
  syncCronPolling(true)
})

onDeactivated(() => {
  componentActive = false
  stopCronPolling()
})

onUnmounted(() => {
  componentActive = false
  stopCronPolling()
})
</script>

<template>
  <div class="tasks-tab">
    <!-- ═══ 页头 ═══ -->
    <header class="tasks-tab__header">
      <div class="tasks-tab__header-left">
        <!-- 标题与其他 Tab 一致：像素字体 + 加粗大字号 -->
        <h2 class="tasks-tab__title flex items-center gap-3 text-2xl font-black font-pixel">
          <PixelIcon name="bell" size="md" class="tasks-tab__title-icon" />
          任务中心
        </h2>
        <div class="tasks-tab__stats">
          <span v-if="taskCenter.activeCount > 0" class="tasks-tab__stat tasks-tab__stat--active">
            {{ taskCenter.activeCount }} 进行中
          </span>
          <span v-if="reminders.length > 0" class="tasks-tab__stat tasks-tab__stat--reminder">
            {{ reminders.length }} 条待触发
          </span>
        </div>
      </div>
      <PButton variant="primary" size="sm" @click="openDispatch">
        <PixelIcon name="plus" size="xs" />
        派发新任务
      </PButton>
    </header>

    <!-- ═══ 三视图切换 ═══ -->
    <nav class="tasks-tab__nav" role="tablist">
      <button
        v-for="v in ['active', 'history', 'reminders'] as const"
        :key="v"
        type="button"
        role="tab"
        :aria-selected="activeView === v"
        class="tasks-tab__nav-item"
        :class="{ 'tasks-tab__nav-item--active': activeView === v }"
        @click="activeView = v"
      >
        {{ v === 'active' ? '进行中' : v === 'history' ? '历史记录' : '定时与提醒' }}
      </button>
    </nav>

    <!-- ═══ 进行中视图 ═══ -->
    <section v-if="activeView === 'active'" class="tasks-tab__section">
      <PEmpty
        v-if="taskCenter.activeTasks.length === 0 && reminders.length === 0"
        description="暂无进行中任务，点击右上角「派发新任务」让 Agent 帮你干活吧~"
      />

      <!-- 进行中后台任务 -->
      <div v-if="taskCenter.activeTasks.length > 0" class="tasks-tab__group">
        <h3 class="tasks-tab__group-title">
          <PixelIcon name="activity" size="xs" />
          后台任务 · {{ taskCenter.activeTasks.length }}
        </h3>
        <div class="tasks-tab__list">
          <TaskCard
            v-for="task in taskCenter.activeTasks"
            :key="task.id"
            :task="task"
            :avatar-url="agentAvatarUrl(task.agentId)"
            :agent-name="agentDisplayName(task.agentId)"
            @detail="detailTask = $event"
            @pause="(t) => taskCenter.pause(t.id)"
            @resume="(t) => taskCenter.resume(t.id)"
            @cancel="(t) => taskCenter.cancel(t.id)"
          />
        </div>
      </div>

      <!-- 待触发提醒（无后台任务时也展示） -->
      <div v-if="reminders.length > 0" class="tasks-tab__group">
        <h3 class="tasks-tab__group-title">
          <PixelIcon name="clock" size="xs" />
          待触发提醒 · {{ reminders.length }}
        </h3>
        <div class="tasks-tab__list">
          <ReminderItem v-for="item in reminders" :key="item.id" :item="item" />
        </div>
      </div>
    </section>

    <!-- ═══ 历史记录视图（时间线） ═══ -->
    <section v-if="activeView === 'history'" class="tasks-tab__section">
      <div v-if="taskCenter.historyTasks.length" class="history-toolbar">
        <div class="history-toolbar__info">
          <span class="history-toolbar__icon"><PixelIcon name="mail" size="xs" /></span>
          <div>
            <strong>历史消息</strong>
            <span>打开未读记录后将自动标记为已读</span>
          </div>
          <b v-if="taskCenter.historyTasks.some((task) => !task.readAt)">
            {{ taskCenter.historyTasks.filter((task) => !task.readAt).length }} 条未读
          </b>
          <b v-else class="history-toolbar__all-read">已全部读完</b>
        </div>
        <button
          type="button"
          class="history-toolbar__read-all"
          :disabled="markingHistoryRead || !taskCenter.historyTasks.some((task) => !task.readAt)"
          @click="markAllHistoryRead"
        >
          <PixelIcon
            :name="markingHistoryRead ? 'refresh' : 'check'"
            size="xs"
            :animation="markingHistoryRead ? 'spin' : undefined"
          />
          {{ markingHistoryRead ? '处理中…' : '一键已读' }}
        </button>
      </div>
      <PEmpty
        v-if="taskCenter.historyTasks.length === 0"
        description="任务完成、失败或取消后会归档在这里~"
      />
      <ol v-else class="tasks-tab__timeline">
        <li v-for="task in taskCenter.historyTasks" :key="task.id" class="tasks-tab__timeline-item">
          <!-- 时间线节点 -->
          <span class="tasks-tab__timeline-rail" aria-hidden="true">
            <span
              class="tasks-tab__timeline-node"
              :class="`tasks-tab__timeline-node--${task.status}`"
            />
          </span>
          <div class="tasks-tab__timeline-content">
            <TaskCard
              :task="task"
              :avatar-url="agentAvatarUrl(task.agentId)"
              :agent-name="agentDisplayName(task.agentId)"
              history
              :delete-open="expandedHistoryTasks.has(task.id)"
              @read="markHistoryRead"
              @delete="deleteHistoryTask"
              @detail="detailTask = $event"
              @resume-interrupted="(t) => resumeInterrupted(t.id)"
              @retry="(t) => taskCenter.retry(t.id)"
            />
            <span class="tasks-tab__timeline-time">{{ historyEndTime(task) }}</span>
          </div>
        </li>
      </ol>
    </section>

    <!-- ═══ 定时与提醒视图 ═══ -->
    <section v-if="activeView === 'reminders'" class="tasks-tab__section">
      <div class="tasks-tab__group">
        <h3 class="tasks-tab__group-title">
          <PixelIcon name="clock" size="xs" />
          创建定时 Agent 任务
        </h3>
        <div class="scheduled-agent-form">
          <select v-model="scheduledAgentId">
            <option v-for="agent in agentStore.agents" :key="agent.id" :value="agent.id">
              {{ agent.name ?? agent.id }}
            </option>
          </select>
          <input v-model="scheduledAgentTime" type="datetime-local" />
          <input
            v-model="scheduledAgentInstruction"
            type="text"
            maxlength="4000"
            placeholder="到期后交给 Agent 的明确指令"
          />
          <PButton
            variant="primary"
            size="sm"
            :loading="creatingScheduledAgent"
            @click="createScheduledAgentTask"
          >
            创建
          </PButton>
        </div>
      </div>

      <!-- 陪伴调度只读状态 -->
      <div class="tasks-tab__group">
        <h3 class="tasks-tab__group-title">
          <PixelIcon name="heart" size="xs" />
          陪伴调度 · {{ companionStates.filter((state) => state.enabled).length }} 个运行中
        </h3>
        <PEmpty v-if="companionStates.length === 0" description="暂无可用角色" />
        <div v-else class="companion-state-list">
          <article
            v-for="state in companionStates"
            :key="state.agentId"
            class="companion-state-card"
          >
            <div>
              <strong>{{ agentDisplayName(state.agentId) }}</strong>
              <p>主动陪伴与空闲关怀调度</p>
            </div>
            <PBadge :variant="state.enabled ? 'success' : 'default'" size="sm">
              {{ state.enabled ? '运行中' : '已停止' }}
            </PBadge>
          </article>
        </div>
      </div>

      <!-- 用户提醒 -->
      <div class="tasks-tab__group">
        <h3 class="tasks-tab__group-title">
          <PixelIcon name="bell" size="xs" />
          用户提醒 · {{ reminders.length }}
        </h3>
        <PEmpty
          v-if="!isLoadingReminders && reminders.length === 0"
          description="通过聊天让 Agent 帮你设置提醒吧~"
        />
        <div v-else class="tasks-tab__list">
          <ReminderItem v-for="item in reminders" :key="item.id" :item="item" />
        </div>
      </div>

      <!-- 系统后台任务（折叠） -->
      <div class="tasks-tab__cron">
        <button type="button" class="tasks-tab__cron-header" @click="toggleCronTasks">
          <span class="tasks-tab__cron-title">
            <PixelIcon name="desktop" size="xs" />
            系统后台任务 · {{ cronTasks.length }}
          </span>
          <span v-if="runningCronTasks > 0" class="tasks-tab__stat tasks-tab__stat--active">
            {{ runningCronTasks }} 运行中
          </span>
          <PixelIcon :name="showCronTasks ? 'chevron-up' : 'chevron-down'" size="xs" />
        </button>

        <div v-if="showCronTasks" class="tasks-tab__list">
          <div v-if="cronError" class="cron-feedback cron-feedback--error">
            <span>{{ cronError }}</span>
            <PButton variant="secondary" size="sm" :loading="cronLoading" @click="fetchCronTasks">
              重试
            </PButton>
          </div>
          <div v-else-if="cronLoading && cronTasks.length === 0" class="cron-feedback">
            正在加载任务状态…
          </div>

          <article
            v-for="task in cronTasks"
            :key="task.name"
            class="cron-card"
            :class="{
              'cron-card--running': task.running,
              'cron-card--error': task.lastOutcome === 'error',
            }"
          >
            <div class="cron-card__main">
              <div class="cron-card__heading">
                <div class="cron-card__heading-text">
                  <h4 class="cron-card__title">{{ task.displayName }}</h4>
                  <p class="cron-card__description">{{ task.description }}</p>
                </div>
                <PBadge :variant="statusVariant(task)" size="sm">{{ statusText(task) }}</PBadge>
              </div>

              <div class="cron-card__schedule">
                <span>周期 {{ task.intervalDesc }}</span>
                <span v-if="!task.running">
                  预计 {{ formatCountdown(task) }} · {{ formatDateTime(task.nextDueAt) }}
                </span>
                <span v-else>本次任务正在执行</span>
              </div>
              <div
                class="cron-card__progress"
                :class="{ 'cron-card__progress--running': task.running }"
                role="progressbar"
                :aria-valuenow="Math.round(progressPercent(task))"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: `${progressPercent(task)}%` }" />
              </div>

              <div class="cron-card__summary">
                <span :class="{ 'cron-card__outcome--error': task.lastOutcome === 'error' }">
                  最近结果：{{ outcomeText(task) }}
                </span>
                <span>最近耗时：{{ formatElapsed(task.stats.lastDurationMs) }}</span>
              </div>
            </div>

            <div class="cron-card__actions">
              <PButton
                variant="secondary"
                size="sm"
                :loading="triggeringTasks.has(task.name)"
                :disabled="task.running || triggeringTasks.has(task.name)"
                @click.stop="triggerCronTask(task)"
              >
                立即执行
              </PButton>
              <button
                type="button"
                class="cron-card__detail-toggle"
                @click="toggleCronDetail(task.name)"
              >
                {{ expandedTasks.has(task.name) ? '收起详情' : '展开详情' }}
                <PixelIcon
                  :name="expandedTasks.has(task.name) ? 'chevron-up' : 'chevron-down'"
                  size="xs"
                />
              </button>
            </div>

            <dl v-if="expandedTasks.has(task.name)" class="cron-card__details">
              <div>
                <dt>最近开始</dt>
                <dd>{{ formatDateTime(task.lastStartedAt) }}</dd>
              </div>
              <div>
                <dt>最近完成</dt>
                <dd>{{ formatDateTime(task.lastFinishedAt) }}</dd>
              </div>
              <div>
                <dt>最近成功</dt>
                <dd>{{ formatDateTime(task.lastSuccessAt) }}</dd>
              </div>
              <div>
                <dt>最近失败</dt>
                <dd>{{ formatDateTime(task.lastFailureAt) }}</dd>
              </div>
              <div>
                <dt>执行统计</dt>
                <dd>
                  共 {{ task.stats.totalRuns }} 次 · 成功 {{ task.stats.successCount }} · 失败
                  {{ task.stats.errorCount }}
                </dd>
              </div>
              <div>
                <dt>平均耗时</dt>
                <dd>{{ formatElapsed(task.stats.averageDurationMs) }}</dd>
              </div>
              <div class="cron-card__detail-wide">
                <dt>最近错误</dt>
                <dd>{{ task.stats.lastError || '-' }}</dd>
              </div>
              <div class="cron-card__detail-wide">
                <dt>内部任务标识</dt>
                <dd>
                  <code>{{ task.name }}</code>
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </div>
    </section>

    <!-- 派发新任务弹窗 -->
    <DispatchTaskModal
      :show="isDispatchOpen"
      :target-thread-id="dispatchTargetThreadId"
      @close="isDispatchOpen = false"
    />

    <!-- 任务详情弹窗 -->
    <TaskDetailModal
      v-if="detailTask"
      :task="detailTask"
      :avatar-url="agentAvatarUrl(detailTask.agentId)"
      :agent-name="agentDisplayName(detailTask.agentId)"
      @close="closeDetail"
    />
  </div>
</template>

<style scoped>
.companion-state-list {
  display: grid;
  gap: 8px;
}

.companion-state-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-surface);
}

.companion-state-card strong {
  color: var(--ui-text-primary);
  font-size: 12px;
}

.companion-state-card p {
  margin: 3px 0 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}

.scheduled-agent-form {
  display: grid;
  grid-template-columns: 140px 190px minmax(180px, 1fr) auto;
  gap: 8px;
}

.scheduled-agent-form select,
.scheduled-agent-form input {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

/* ── 页面骨架 ── */
.tasks-tab {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  padding: var(--ui-space-6) var(--ui-space-8);
  height: 100%;
  overflow-y: auto;
  /* 正文统一现代字体，pixel 字体仅保留在小标签装饰上 */
  font-family: var(--ui-font-sans);
  color: var(--ui-text-primary);
}

/* ── 页头 ── */
.tasks-tab__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
}

.tasks-tab__header-left {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  min-width: 0;
  flex-wrap: wrap;
}

/* 尺寸/字重/字体由 Tailwind 类（text-2xl font-black font-pixel）控制，这里只保留布局与颜色 */
.tasks-tab__title {
  margin: 0;
  color: var(--ui-text-primary);
}

.tasks-tab__title-icon {
  color: var(--ui-warning);
}

.tasks-tab__stats {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
}

/* 小统计胶囊（像素字体留在这里做风格化点缀） */
.tasks-tab__stat {
  padding: 2px 10px;
  border-radius: var(--ui-radius-full);
  font-size: 11px;
  font-weight: 700;
  font-family: var(--ui-font-pixel);
  border: 1px solid var(--ui-border-default);
}

.tasks-tab__stat--active {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

.tasks-tab__stat--reminder {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

/* ── 三视图切换 ── */
.tasks-tab__nav {
  display: flex;
  gap: var(--ui-space-1);
  border-bottom: 1px solid var(--ui-border-default);
}

.tasks-tab__nav-item {
  padding: 8px 16px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  transition:
    color var(--ui-duration-fast) var(--ui-ease-standard),
    border-color var(--ui-duration-fast) var(--ui-ease-standard);
}

.tasks-tab__nav-item:hover {
  color: var(--ui-text-secondary);
}

.tasks-tab__nav-item--active {
  color: var(--ui-accent-sky);
  border-bottom-color: var(--ui-accent-sky);
}

.tasks-tab__nav-item:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  outline-offset: -2px;
}

/* ── 视图分区 ── */
.tasks-tab__section {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
}

.tasks-tab__group {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.tasks-tab__group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ui-text-tertiary);
  text-transform: uppercase;
}

.tasks-tab__list {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

/* ── 历史记录工具条 ── */
.history-toolbar {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
  padding: 8px 10px 8px 12px;
  overflow: hidden;
  border: 1px solid var(--ui-border-default);
  border-left: 4px solid var(--ui-accent-sky);
  border-radius: var(--ui-radius-lg);
  background: linear-gradient(90deg, var(--ui-accent-sky-soft), var(--ui-bg-surface) 48%);
  box-shadow: 3px 3px 0 var(--ui-border-subtle);
}

.history-toolbar__info {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.history-toolbar__icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-accent-sky);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg-surface);
  color: var(--ui-accent-sky);
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-accent-sky) 18%, transparent);
}

.history-toolbar__info > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.history-toolbar__info strong {
  color: var(--ui-text-primary);
  font-size: 11px;
  font-weight: 800;
}

.history-toolbar__info > div > span {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-toolbar__info > b {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid var(--ui-accent-primary);
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent-primary-soft);
  color: var(--ui-accent-primary);
  font: 800 8px var(--ui-font-mono);
}

.history-toolbar__info > b.history-toolbar__all-read {
  border-color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}

.history-toolbar__read-all {
  display: inline-flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 11px;
  border: 1px solid var(--ui-accent-sky);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-accent-sky);
  color: #fff;
  font: 800 9px var(--ui-font-mono);
  cursor: pointer;
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-accent-sky) 30%, var(--ui-border-strong));
  transition:
    transform var(--ui-duration-fast),
    box-shadow var(--ui-duration-fast),
    opacity var(--ui-duration-fast);
}

.history-toolbar__read-all:hover:not(:disabled) {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ui-accent-sky) 30%, var(--ui-border-strong));
}

.history-toolbar__read-all:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: none;
}

.history-toolbar__read-all:disabled {
  cursor: default;
  opacity: 0.45;
  box-shadow: none;
}

:global([data-theme='dark']) .history-toolbar {
  border-color: var(--ui-border-default);
  border-left-color: var(--ui-accent-sky);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ui-accent-sky) 11%, var(--ui-bg-surface)),
    var(--ui-bg-surface) 55%
  );
  box-shadow: 3px 3px 0 color-mix(in srgb, #000 38%, transparent);
}

:global([data-theme='dark']) .history-toolbar__icon {
  background: color-mix(in srgb, var(--ui-accent-sky) 9%, var(--ui-bg-elevated));
}

@media (max-width: 680px) {
  .history-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .history-toolbar__read-all {
    width: 100%;
  }
  .history-toolbar__info > b {
    margin-left: auto;
  }
}

/* ── 历史时间线 ── */
.tasks-tab__timeline {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tasks-tab__timeline-item {
  display: flex;
  gap: var(--ui-space-3);
}

.tasks-tab__timeline-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
  padding-top: 18px;
}

.tasks-tab__timeline-node {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--ui-bg-surface);
  background: var(--node-color, var(--ui-text-disabled));
  box-shadow: 0 0 0 2px var(--ui-border-subtle);
}

/* 节点竖线（除最后一个外向下延伸） */
.tasks-tab__timeline-rail::after {
  content: '';
  flex: 1;
  width: 2px;
  margin-top: 4px;
  background: var(--ui-border-subtle);
}

.tasks-tab__timeline-item:last-child .tasks-tab__timeline-rail::after {
  display: none;
}

.tasks-tab__timeline-node--completed {
  --node-color: var(--ui-success);
}
.tasks-tab__timeline-node--failed {
  --node-color: var(--ui-danger);
}
.tasks-tab__timeline-node--cancelled {
  --node-color: var(--ui-text-disabled);
}

.tasks-tab__timeline-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: var(--ui-space-4);
}

.tasks-tab__timeline-time {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
  padding-left: 2px;
}

/* ── 系统 cron 折叠区 ── */
.tasks-tab__cron {
  border-top: 1px solid var(--ui-border-subtle);
  padding-top: var(--ui-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.tasks-tab__cron-header {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  padding: 4px 0;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ui-text-tertiary);
  text-transform: uppercase;
  cursor: pointer;
  transition: color var(--ui-duration-fast) var(--ui-ease-standard);
}

.tasks-tab__cron-header:hover {
  color: var(--ui-text-secondary);
}

.tasks-tab__cron-header:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  border-radius: var(--ui-radius-sm);
}

.tasks-tab__cron-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* ── 系统任务卡片 ── */
.cron-feedback {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding: 12px 14px;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-surface);
  border: 1px dashed var(--ui-border-default);
  border-radius: var(--ui-radius-lg);
  font-size: 12px;
}

.cron-feedback--error {
  color: var(--ui-danger);
  border-color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.cron-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--ui-space-3) var(--ui-space-4);
  padding: 14px 16px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  box-shadow: var(--ui-shadow-xs);
}

.cron-card--running {
  border-left: 3px solid var(--ui-success);
}

.cron-card--error {
  border-left: 3px solid var(--ui-danger);
}

.cron-card__main,
.cron-card__heading-text {
  min-width: 0;
}

.cron-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ui-space-3);
}

.cron-card__title {
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.cron-card__description {
  margin: 3px 0 0;
  color: var(--ui-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.cron-card__schedule,
.cron-card__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 9px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.cron-card__progress {
  height: 6px;
  margin-top: 7px;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-hover);
}

.cron-card__progress > span {
  display: block;
  height: 100%;
  background: var(--ui-accent-sky);
  transition: width var(--ui-duration-normal) var(--ui-ease-standard);
}

.cron-card__progress--running > span {
  background: var(--ui-success);
  animation: cron-progress-pulse 1.8s ease-in-out infinite;
}

.cron-card__outcome--error {
  color: var(--ui-danger);
}

.cron-card__actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 8px;
}

.cron-card__detail-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  cursor: pointer;
}

.cron-card__detail-toggle:hover {
  color: var(--ui-accent-sky);
}

.cron-card__details {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
  margin: 0;
  padding: 12px;
  border-top: 1px dashed var(--ui-border-default);
  background: var(--ui-bg-hover);
  font-size: 11px;
}

.cron-card__details > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
}

.cron-card__details dt {
  color: var(--ui-text-tertiary);
}

.cron-card__details dd {
  min-width: 0;
  margin: 0;
  color: var(--ui-text-secondary);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}

.cron-card__detail-wide {
  grid-column: 1 / -1;
}

.cron-card__details code {
  font-family: var(--ui-font-mono);
}

@keyframes cron-progress-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (max-width: 700px) {
  .cron-card {
    grid-template-columns: 1fr;
  }

  .cron-card__actions {
    flex-direction: row;
    justify-content: flex-end;
  }

  .cron-card__details {
    grid-template-columns: 1fr;
  }

  .cron-card__detail-wide {
    grid-column: auto;
  }
}

/* 减少动画偏好：关闭运行态动画 */
@media (prefers-reduced-motion: reduce) {
  .cron-card__progress > span {
    transition: none;
  }

  .cron-card__progress--running > span {
    animation: none;
  }
}
</style>
