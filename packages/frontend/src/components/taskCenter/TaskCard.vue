<script setup lang="ts">
/**
 * TaskCard — 后台任务卡片（任务中心重构版）
 *
 * 布局：单行信息流 ——
 *   [头像+状态点] [标题 + 元信息行 + (进度条)] [状态胶囊] [icon 操作]
 *
 * 视觉：soft-UI 圆角面板 + ui 语义令牌（双主题安全），
 * 状态色统一交给 TaskStatusBadge，不再内联实现。
 *
 * @props task — BackgroundTaskInfo
 * @props avatarUrl / agentName — Agent 展示信息（可选）
 * @emits detail / pause / resume / resumeInterrupted / cancel
 */
import { computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import TaskStatusBadge from './TaskStatusBadge.vue'
import type { BackgroundTaskInfo } from '../../api/modules/backgroundTasksApi'

const props = defineProps<{
  task: BackgroundTaskInfo
  /** Agent 头像 URL（可选） */
  avatarUrl?: string | null
  /** Agent 显示名（可选） */
  agentName?: string | null
  /** 历史记录卡片是否已读 */
  history?: boolean
  /** 历史记录卡片是否展开删除操作 */
  deleteOpen?: boolean
}>()

const emit = defineEmits<{
  detail: [task: BackgroundTaskInfo]
  pause: [task: BackgroundTaskInfo]
  resume: [task: BackgroundTaskInfo]
  cancel: [task: BackgroundTaskInfo]
  /** M05-篇3-1: 恢复因服务重启中断的任务 */
  resumeInterrupted: [task: BackgroundTaskInfo]
  retry: [task: BackgroundTaskInfo]
  read: [task: BackgroundTaskInfo]
  delete: [task: BackgroundTaskInfo]
}>()

/** 计算运行时间（从开始时间起；未完成则算到现在） */
const elapsed = computed(() => {
  const start = props.task.startedAt ?? props.task.createdAt
  if (!start) return ''
  // 后端返回 "YYYY-MM-DD HH:MM:SS" 本地时间字符串
  const end = props.task.completedAt ?? new Date().toISOString().replace('T', ' ').slice(0, 19)
  const ms = new Date(end.replace(' ', 'T')).getTime() - new Date(start.replace(' ', 'T')).getTime()
  if (ms < 0) return ''
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
})

/** 是否可暂停（排队或运行中） */
const canPause = computed(() => ['queued', 'running'].includes(props.task.status))
const waitReason = computed(() => {
  const reason = props.task.execution?.waitReason
  if (!reason) return ''
  const labels: Record<string, string> = {
    scheduler_capacity: '等待系统容量',
    class_capacity: '等待后台任务容量',
    resource_locked: '等待Agent资源',
    backpressure: '系统负载保护',
    io: '等待I/O',
    approval: '等待批准',
    paused: '已暂停',
  }
  return labels[reason] ?? reason
})
/** 是否可恢复（paused） */
const canResume = computed(() => props.task.status === 'paused')
/** 是否可取消（活跃态） */
const canCancel = computed(() =>
  ['queued', 'running', 'paused', 'waiting_input'].includes(props.task.status),
)
/** 是否可断点续跑（failed 且因服务重启中断，checkpoint 仍在） */
const canResumeInterrupted = computed(
  () => props.task.status === 'failed' && (props.task.errorMessage ?? '').includes('服务重启'),
)
</script>

<template>
  <article
    class="task-card"
    :class="[
      `task-card--${task.status}`,
      {
        'task-card--history': history,
        'task-card--read': history && task.readAt,
        'task-card--delete-open': deleteOpen,
      },
    ]"
    role="button"
    tabindex="0"
    @click="history ? emit('read', task) : emit('detail', task)"
    @keydown.enter="history ? emit('read', task) : emit('detail', task)"
  >
    <!-- 头像 + 状态点 -->
    <div class="task-card__avatar-wrap">
      <img
        v-if="avatarUrl"
        :src="avatarUrl"
        :alt="agentName ?? task.agentId"
        class="task-card__avatar"
      />
      <div v-else class="task-card__avatar-fallback">
        <PixelIcon name="bot" size="sm" />
      </div>
      <span class="task-card__status-dot" aria-hidden="true" />
    </div>

    <!-- 主体 -->
    <div class="task-card__body">
      <div class="task-card__title-row">
        <h4 class="task-card__title" :title="task.title">{{ task.title }}</h4>
        <TaskStatusBadge :status="task.status" :read="history && Boolean(task.readAt)" />
      </div>

      <p class="task-card__meta">
        <span v-if="agentName" class="task-card__agent">{{ agentName }}</span>
        <span v-if="task.currentStage" class="task-card__stage">{{ task.currentStage }}</span>
        <span v-if="waitReason" class="task-card__stage">{{ waitReason }}</span>
        <span v-if="elapsed">{{ elapsed }}</span>
        <span class="task-card__tools">工具 ×{{ task.toolCallCount }}</span>
      </p>

      <!-- 进度条 -->
      <div v-if="task.progress != null" class="task-card__progress">
        <div class="task-card__progress-track">
          <div class="task-card__progress-bar" :style="{ width: `${task.progress}%` }" />
        </div>
        <span class="task-card__progress-text">{{ task.progress }}%</span>
      </div>

      <!-- 失败提示 -->
      <p v-if="task.status === 'failed' && task.errorMessage" class="task-card__error">
        {{ task.errorMessage }}
      </p>
    </div>

    <!-- 控制操作（阻止冒泡，避免触发详情） -->
    <div class="task-card__actions" @click.stop @keydown.stop>
      <button
        v-if="canPause"
        type="button"
        class="task-card__action"
        title="暂停"
        @click="emit('pause', task)"
      >
        <PixelIcon name="square" size="xs" />
      </button>
      <button
        v-if="canResume"
        type="button"
        class="task-card__action"
        title="恢复"
        @click="emit('resume', task)"
      >
        <PixelIcon name="chevron-right" size="xs" />
      </button>
      <button
        v-if="canResumeInterrupted"
        type="button"
        class="task-card__action"
        title="从断点续跑（因服务重启中断）"
        @click="emit('resumeInterrupted', task)"
      >
        <PixelIcon name="refresh" size="xs" />
      </button>
      <button
        v-if="
          ['completed', 'failed', 'cancelled'].includes(task.status) && task.category !== 'resident'
        "
        type="button"
        class="task-card__action"
        title="重新派发"
        @click="emit('retry', task)"
      >
        <PixelIcon name="refresh" size="xs" />
      </button>
      <button
        v-if="history"
        type="button"
        class="task-card__action task-card__action--delete"
        title="删除记录"
        @click.stop="emit('delete', task)"
      >
        <PixelIcon name="trash" size="xs" />
      </button>
      <button
        v-if="canCancel"
        type="button"
        class="task-card__action task-card__action--danger"
        title="取消"
        @click="emit('cancel', task)"
      >
        <PixelIcon name="close" size="xs" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.task-card {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-3);
  padding: 12px 14px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  box-shadow: var(--ui-shadow-xs);
  cursor: pointer;
  transition:
    transform var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard),
    border-color var(--ui-duration-fast) var(--ui-ease-standard);
}

.task-card:hover {
  transform: translateY(-1px);
  border-color: var(--ui-border-default);
  box-shadow: var(--ui-shadow-sm);
}

.task-card:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  outline-offset: 2px;
}

/* 需要用户处理的任务左侧描边提示 */
.task-card--waiting_input {
  border-left: 3px solid var(--ui-accent-primary);
}
.task-card--failed {
  border-left: 3px solid var(--ui-danger);
}

/* ── 头像 ── */
.task-card__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.task-card__avatar,
.task-card__avatar-fallback {
  width: 38px;
  height: 38px;
  border-radius: var(--ui-radius-md);
  object-fit: cover;
}

.task-card__avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

.task-card__status-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--ui-bg-surface);
  background: var(--dot-color, var(--ui-text-disabled));
}

/* 状态点配色（与 TaskStatusBadge 同一语义） */
.task-card--queued .task-card__status-dot {
  --dot-color: var(--ui-accent-purple);
}
.task-card--running .task-card__status-dot {
  --dot-color: var(--ui-accent-sky);
  animation: task-dot-pulse 1.6s ease-in-out infinite;
}
.task-card--paused .task-card__status-dot {
  --dot-color: var(--ui-warning);
}
.task-card--waiting_input .task-card__status-dot {
  --dot-color: var(--ui-accent-primary);
}
.task-card--completed .task-card__status-dot {
  --dot-color: var(--ui-success);
}
.task-card--failed .task-card__status-dot {
  --dot-color: var(--ui-danger);
}
.task-card--cancelled .task-card__status-dot {
  --dot-color: var(--ui-text-disabled);
}

@keyframes task-dot-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent-sky) 45%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px transparent;
  }
}

/* ── 主体 ── */
.task-card__body {
  flex: 1;
  min-width: 0;
}

.task-card__title-row {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  justify-content: space-between;
}

.task-card__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--ui-text-tertiary);
}

.task-card__agent {
  color: var(--ui-text-secondary);
  font-weight: 600;
}

.task-card__stage {
  color: var(--ui-accent-sky);
}

.task-card__tools {
  color: var(--ui-text-disabled);
}

/* 进度条 */
.task-card__progress {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  margin-top: 8px;
}

.task-card__progress-track {
  flex: 1;
  height: 5px;
  border-radius: var(--ui-radius-full);
  background: var(--ui-bg-hover);
  overflow: hidden;
}

.task-card__progress-bar {
  height: 100%;
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent-sky);
  transition: width var(--ui-duration-normal) var(--ui-ease-standard);
}

.task-card--completed .task-card__progress-bar {
  background: var(--ui-success);
}
.task-card--failed .task-card__progress-bar {
  background: var(--ui-danger);
}

.task-card__progress-text {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.task-card__error {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--ui-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 历史记录：未读更醒目，已读统一为安静的蓝色完成态。 */
.task-card--history:not(.task-card--read) {
  border-left: 3px solid var(--ui-accent-primary);
  background: color-mix(in srgb, var(--ui-accent-primary-soft) 52%, var(--ui-bg-surface));
}
.task-card--history.task-card--read,
.task-card--history.task-card--read.task-card--failed {
  border-left: 3px solid var(--ui-accent-sky);
  background: color-mix(in srgb, var(--ui-accent-sky-soft) 42%, var(--ui-bg-surface));
}
.task-card--history.task-card--read .task-card__status-dot,
.task-card--history.task-card--read.task-card--failed .task-card__status-dot {
  --dot-color: var(--ui-accent-sky);
}
.task-card--history.task-card--read .task-card__error {
  color: var(--ui-accent-sky);
}
.task-card--history .task-card__action--delete {
  opacity: 0;
  transform: translateX(8px);
  pointer-events: none;
}
.task-card--history.task-card--delete-open .task-card__action--delete {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.task-card--history.task-card--delete-open .task-card__action--delete:hover {
  background: var(--ui-danger);
  color: var(--ui-text-inverse, #fff);
}

/* ── 操作（icon ghost 按钮，悬浮才显眼） ── */
.task-card__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.task-card__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  transition:
    background var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard);
}

.task-card__action:hover {
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}

.task-card__action--danger:hover {
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
}

.task-card__action:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  outline-offset: 1px;
}

/* 减少动画偏好：关闭状态点脉冲 */
@media (prefers-reduced-motion: reduce) {
  .task-card--running .task-card__status-dot {
    animation: none;
  }
}
</style>
