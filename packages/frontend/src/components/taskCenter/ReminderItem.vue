<script setup lang="ts">
/**
 * ReminderItem — 用户提醒条目
 *
 * 展示一条由 Agent 创建的提醒（reminder/topic/reaction）：
 * 类型色块 + 内容 + 相对时间，soft-UI 软底条目，全套 ui 语义令牌。
 *
 * @props item — ReminderItem
 */
import { computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ReminderItem as ReminderItemData } from '../../api/modules/schedulerApi'

const props = defineProps<{
  item: ReminderItemData
}>()

/** 类型元数据：标签 / 图标 / 修饰色类名 */
const TYPE_META: Record<string, { label: string; icon: string; mod: string }> = {
  reminder: { label: '提醒', icon: 'bell', mod: 'reminder' },
  topic: { label: '话题', icon: 'chat', mod: 'topic' },
  reaction: { label: '反应', icon: 'flash', mod: 'reaction' },
}

const meta = computed(
  () => TYPE_META[props.item.type] ?? { label: props.item.type, icon: 'list', mod: 'default' },
)

/** 相对时间格式化：`MM月DD日 HH:mm（N天后 / NhhNm后 / N分钟后 / 已过期）` */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()
  const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  if (diffMs < 0) return `${dateStr} ${timeStr} · 已过期`
  const hours = Math.floor(diffMs / 3600_000)
  const mins = Math.floor((diffMs % 3600_000) / 60_000)
  if (hours >= 24) return `${dateStr} ${timeStr} · ${Math.floor(hours / 24)}天后`
  if (hours > 0) return `${dateStr} ${timeStr} · ${hours}小时${mins}分后`
  return `${timeStr} · ${mins}分钟后`
}

const timeText = computed(() => formatTime(props.item.time))
const isExpired = computed(() => new Date(props.item.time).getTime() < Date.now())
</script>

<template>
  <div class="reminder-item" :class="{ 'reminder-item--expired': isExpired }">
    <!-- 类型色块图标 -->
    <div class="reminder-item__icon" :class="`reminder-item__icon--${meta.mod}`">
      <PixelIcon :name="meta.icon" size="sm" />
    </div>

    <!-- 内容 + 时间 -->
    <div class="reminder-item__body">
      <p class="reminder-item__content" :title="item.content">{{ item.content }}</p>
      <div class="reminder-item__meta">
        <span class="reminder-item__type" :class="`reminder-item__type--${meta.mod}`">
          {{ meta.label }}
        </span>
        <span class="reminder-item__time">
          <PixelIcon name="clock" size="xs" />
          {{ timeText }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reminder-item {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-3);
  padding: 12px 14px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-subtle);
  box-shadow: var(--ui-shadow-xs);
  transition:
    transform var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard),
    border-color var(--ui-duration-fast) var(--ui-ease-standard);
}

.reminder-item:hover {
  transform: translateY(-1px);
  border-color: var(--ui-border-default);
  box-shadow: var(--ui-shadow-sm);
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
  border-radius: var(--ui-radius-md);
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
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
  font-size: 13px;
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
  border-radius: var(--ui-radius-sm);
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-hover);
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
  font-size: 11px;
  color: var(--ui-text-tertiary);
}
</style>
