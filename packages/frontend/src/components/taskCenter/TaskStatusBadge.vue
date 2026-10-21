<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import './task-pixel.css'
/**
 * TaskStatusBadge — 任务状态方块
 *
 * 统一任务中心（进行中 / 历史 / 详情弹窗）的状态视觉：
 * 细边框 + 状态色文字 + 像素状态块，全部走 ui 语义令牌（双主题安全）。
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
  get queued() {
    return __t('ui.taskCenter', '排队中')
  },
  get running() {
    return __t('ui.taskCenter', '运行中')
  },
  get paused() {
    return __t('ui.taskCenter', '已暂停')
  },
  get waiting_input() {
    return __t('ui.taskCenter', '等待输入')
  },
  get waiting() {
    return __t('ui.taskCenter', '等待条件')
  },
  get blocked() {
    return __t('ui.taskCenter', '需要处理')
  },
  get completed() {
    return __t('ui.taskCenter', '已完成')
  },
  get failed() {
    return __t('ui.taskCenter', '失败')
  },
  get cancelled() {
    return __t('ui.taskCenter', '已取消')
  },
}

/** 展示文案（未知状态下回退为原文） */
const label = computed(() =>
  props.read ? __t('ui.taskCenter', '已读') : (STATUS_LABELS[props.status] ?? props.status),
)

/** 是否运行中（方块带离散脉冲） */
const isRunning = computed(() => props.status === 'running')
</script>

<template>
  <span
    class="ts-badge task-pixel-surface"
    :class="[`ts-badge--${status}`, { 'ts-badge--read': read }]"
  >
    <span class="ts-badge__dot" :class="{ 'ts-badge__dot--pulse': isRunning }" />
    {{ label }}
  </span>
</template>

<style scoped>
.ts-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border-radius: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  /* 未知状态降级为中性灰 */
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
  white-space: nowrap;
  user-select: none;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  box-shadow:
    inset 1px 1px 0 var(--task-highlight),
    inset -1px -1px 0 var(--task-shade);
  font-family: var(--ui-font-pixel);
}

.ts-badge__dot {
  width: 5px;
  height: 5px;
  border-radius: 0;
  background: currentColor;
  flex-shrink: 0;
}

/* 运行中的呼吸脉冲（尊重系统减少动画偏好见 media 查询） */
.ts-badge__dot--pulse {
  animation: ts-dot-pulse 1.6s steps(2, end) infinite;
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

.ts-badge--paused,
.ts-badge--waiting {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.ts-badge--waiting_input,
.ts-badge--blocked {
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
