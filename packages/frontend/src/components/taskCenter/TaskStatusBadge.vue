<script setup lang="ts">
/**
 * TaskStatusBadge — 任务状态胶囊
 *
 * 统一任务中心（进行中 / 历史 / 详情弹窗）的状态视觉：
 * 软色底 + 状态色文字 + 状态圆点，全部走 ui 语义令牌（双主题安全）。
 *
 * 状态视觉语义：
 * - running        天蓝 + 呼吸脉冲
 * - queued         靛蓝
 * - paused         琥珀
 * - waiting_input  橙（需要人干预，最醒目）
 * - completed      翠绿
 * - failed         红
 * - cancelled      中性灰
 *
 * @props status — BackgroundTaskStatus 或任意字符串（未知状态降级为灰）
 */
import { computed } from 'vue'
import type { BackgroundTaskStatus } from '../../api/modules/backgroundTasksApi'

const props = defineProps<{
  status: BackgroundTaskStatus | string
  /** 历史记录已读后使用蓝色“已读”状态。 */
  read?: boolean
}>()

/** 状态文案表（与后端状态机对齐） */
const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  waiting_input: '等待输入',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

/** 展示文案（未知状态下回退为原文） */
const label = computed(() => (props.read ? '已读' : (STATUS_LABELS[props.status] ?? props.status)))

/** 是否运行中（圆点带呼吸脉冲） */
const isRunning = computed(() => props.status === 'running')
</script>

<template>
  <span class="ts-badge" :class="[`ts-badge--${status}`, { 'ts-badge--read': read }]">
    <span class="ts-badge__dot" :class="{ 'ts-badge__dot--pulse': isRunning }" />
    {{ label }}
  </span>
</template>

<style scoped>
.ts-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: var(--ui-radius-full);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  /* 未知状态降级为中性灰 */
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
  white-space: nowrap;
  user-select: none;
}

.ts-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

/* 运行中的呼吸脉冲（尊重系统减少动画偏好见 media 查询） */
.ts-badge__dot--pulse {
  animation: ts-dot-pulse 1.6s ease-in-out infinite;
}

@keyframes ts-dot-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 45%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px transparent;
  }
}

/* ── 各状态配色（软底 + 状态色文字） ── */
.ts-badge--queued {
  color: var(--ui-accent-purple);
  background: var(--ui-accent-purple-soft);
}

.ts-badge--running {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

.ts-badge--paused {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.ts-badge--waiting_input {
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
}

.ts-badge--completed {
  color: var(--ui-success);
  background: var(--ui-success-soft);
}

.ts-badge--failed {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.ts-badge--cancelled {
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
}

.ts-badge--completed.ts-badge--read,
.ts-badge--failed.ts-badge--read,
.ts-badge--cancelled.ts-badge--read {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

/* 减少动画偏好：关闭脉冲 */
@media (prefers-reduced-motion: reduce) {
  .ts-badge__dot--pulse {
    animation: none;
  }
}
</style>
