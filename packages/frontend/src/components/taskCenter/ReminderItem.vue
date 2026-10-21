<script setup lang="ts">
import { getDisplayLocale } from '../../i18n/index'

import { t as __t } from '../../i18n/index'

import './task-pixel.css'
/**
 * ReminderItem — 用户提醒条目
 *
 * 展示一条由 Agent 创建的提醒（reminder/topic/reaction）：
 * 类型色块 + 内容 + 相对时间，细边框像素条目，全套 ui 语义令牌。
 *
 * @props item — ReminderItem
 */
import { computed, ref } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ReminderItem as ReminderItemData } from '../../api/modules/schedulerApi'
import { schedulerApi } from '../../api/modules/schedulerApi'

const props = defineProps<{
  item: ReminderItemData
}>()
const emit = defineEmits<{ changed: [] }>()
const busy = ref(false)
const error = ref('')
async function act(action: 'cancel' | 'retry' | 'pause' | 'resume') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (action === 'cancel') await schedulerApi.cancelReminder(props.item.id, props.item.agentId)
    else if (action === 'retry') await schedulerApi.retryReminder(props.item.id, props.item.agentId)
    else await schedulerApi.pauseReminder(props.item.id, props.item.agentId, action === 'pause')
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  } finally {
    busy.value = false
  }
}

/** 类型元数据：标签 / 图标 / 修饰色类名 */
const TYPE_META: Record<string, { label: string; icon: string; mod: string }> = {
  reminder: {
    get label() {
      return __t('ui.taskCenter', '提醒')
    },
    icon: 'bell',
    mod: 'reminder',
  },
  topic: {
    get label() {
      return __t('ui.taskCenter', '话题')
    },
    icon: 'chat',
    mod: 'topic',
  },
  reaction: {
    get label() {
      return __t('ui.taskCenter', '反应')
    },
    icon: 'flash',
    mod: 'reaction',
  },
  follow_up: {
    get label() {
      return __t('ui.taskCenter', '跟进')
    },
    icon: 'clock',
    mod: 'topic',
  },
  agent_task: {
    get label() {
      return __t('ui.taskCenter', '定时任务')
    },
    icon: 'clock',
    mod: 'reaction',
  },
}

const meta = computed(
  () => TYPE_META[props.item.type] ?? { label: props.item.type, icon: 'list', mod: 'default' },
)

/** 相对时间格式化：`MM月DD日 HH:mm（N天后 / NhhNm后 / N分钟后 / 已过期）` */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()
  const dateStr = d.toLocaleDateString(getDisplayLocale(), { month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString(getDisplayLocale(), { hour: '2-digit', minute: '2-digit' })

  if (diffMs < 0) return __t('ui.taskCenter', '{0} {1} · 等待处理', [dateStr, timeStr])
  const hours = Math.floor(diffMs / 3600_000)
  const mins = Math.floor((diffMs % 3600_000) / 60_000)
  if (hours >= 24)
    return __t('ui.taskCenter', '{0} {1} · {2}天后', [dateStr, timeStr, Math.floor(hours / 24)])
  if (hours > 0)
    return __t('ui.taskCenter', '{0} {1} · {2}小时{3}分后', [dateStr, timeStr, hours, mins])
  return __t('ui.taskCenter', '{0} · {1}分钟后', [timeStr, mins])
}

const timeText = computed(() => formatTime(props.item.time))
const isExpired = computed(() => new Date(props.item.time).getTime() < Date.now())
</script>

<template>
  <div class="reminder-item task-pixel-surface" :class="{ 'reminder-item--expired': isExpired }">
    <!-- 类型色块图标 -->
    <div class="reminder-item__icon" :class="`reminder-item__icon--${meta.mod}`">
      <PixelIcon :name="meta.icon" size="sm" />
    </div>

    <!-- 内容 + 时间 -->
    <div class="reminder-item__body">
      <p class="reminder-item__content" :title="item.content">{{ item.reason || item.content }}</p>
      <p v-if="item.lastError" role="alert" class="reminder-item__error">{{ item.lastError }}</p>
      <p v-if="error" role="alert" class="reminder-item__error">{{ error }}</p>
      <div class="reminder-item__meta">
        <span class="reminder-item__type" :class="`reminder-item__type--${meta.mod}`">
          {{ meta.label }}
        </span>
        <span class="reminder-item__time">
          <PixelIcon name="clock" size="xs" />
          {{ timeText }}
        </span>
        <span v-if="item.status === 'failed'" class="reminder-item__failed">
          {{ __t('ui.taskCenter', '未能派发') }}
        </span>
        <span v-if="item.repeatIntervalMinutes">
          {{ __t('ui.taskCenter', '每') }} {{ item.repeatIntervalMinutes }}
          {{ __t('ui.taskCenter', '分钟 ·') }}
          {{
            item.status === 'paused'
              ? __t('ui.taskCenter', '已暂停')
              : __t('ui.taskCenter', '周期计划')
          }}
        </span>
      </div>
    </div>
    <div class="reminder-actions">
      <button
        v-if="item.repeatIntervalMinutes"
        type="button"
        :disabled="busy"
        @click="act(item.status === 'paused' ? 'resume' : 'pause')"
      >
        {{ item.status === 'paused' ? __t('ui.taskCenter', '恢复') : __t('ui.taskCenter', '暂停') }}
      </button>
      <button
        v-if="item.status === 'failed'"
        type="button"
        class="reminder-actions__retry"
        :disabled="busy"
        :title="__t('ui.taskCenter', '重试派发')"
        @click="act('retry')"
      >
        <PixelIcon name="refresh" size="xs" />
        {{ __t('ui.taskCenter', '重试') }}
      </button>
      <span v-if="item.status === 'dispatching'">{{ __t('ui.taskCenter', '派发中') }}</span>
      <button
        v-else
        type="button"
        :disabled="busy"
        :title="__t('ui.taskCenter', '取消这项计划')"
        :aria-label="__t('ui.taskCenter', '取消这项计划')"
        @click="act('cancel')"
      >
        <PixelIcon name="close" size="xs" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.reminder-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.reminder-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 26px;
  color: var(--ui-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  padding: 3px 7px;
  cursor: pointer;
}
.reminder-actions button:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.reminder-actions button.reminder-actions__retry {
  color: var(--ui-accent-purple);
  border-color: var(--ui-border-subtle);
}
.reminder-item__error {
  margin: 2px 0 0;
  color: var(--ui-danger);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.reminder-item__failed {
  color: var(--ui-danger);
  font-size: 10px;
}
.reminder-actions button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.reminder-item {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-3);
  padding: 12px 14px;
  border-radius: 0;
  background: var(--task-fill);
  border: 1px solid var(--ui-border-subtle);
  box-shadow: var(--task-raised);
  transition:
    transform var(--ui-duration-fast) steps(3, end),
    box-shadow var(--ui-duration-fast) steps(3, end),
    border-color var(--ui-duration-fast) steps(3, end);
  border-color: var(--ui-border-default);
}

.reminder-item:hover {
  transform: none;
  border-color: var(--ui-border-strong);
  box-shadow: var(--task-raised);
}

/* 已过期：整体降饱和提示 */
.reminder-item--expired {
  opacity: 0.62;
}

/* ── 类型色块图标 ── */
.reminder-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 0;
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  box-shadow: var(--task-control);
  box-sizing: border-box;
}

.reminder-item__icon--reminder {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.reminder-item__icon--topic {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

.reminder-item__icon--reaction {
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
}

/* ── 主体 ── */
.reminder-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reminder-item__content {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--ui-text-primary);
  /* 两行截断，悬浮 title 看全文 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.reminder-item__meta {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  flex-wrap: wrap;
}

.reminder-item__type {
  padding: 1px 7px;
  border-radius: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}

.reminder-item__type--reminder {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
}

.reminder-item__type--topic {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}

.reminder-item__type--reaction {
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
}

.reminder-item__time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ui-text-tertiary);
}
</style>
