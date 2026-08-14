<script setup lang="ts">
/**
 * PBadge — 像素风徽章/标签
 */

interface Props {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
  /** 是否为点标记（无内容） */
  dot?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'md',
  dot: false,
})
</script>

<template>
  <span :class="['p-badge', `p-badge-${variant}`, `p-badge-${size}`, { 'p-badge-dot': dot }]">
    <slot />
  </span>
</template>

<style scoped>
.p-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ui-font-pixel);
  font-weight: 600;
  border: 1px solid;
  border-radius: 0;
  white-space: nowrap;
  line-height: 1;
}

/* 尺寸 */
.p-badge-sm {
  padding: 2px 6px;
  font-size: 10px;
}
.p-badge-md {
  padding: 3px 8px;
  font-size: 12px;
}

/* 变体 */
.p-badge-default {
  background: var(--ui-bg-hover);
  color: var(--ui-text-secondary);
  border-color: var(--ui-border-default);
}
.p-badge-primary {
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  border-color: var(--ui-accent-sky);
}
.p-badge-success {
  background: var(--ui-success-soft);
  color: var(--ui-success);
  border-color: var(--ui-success);
}
.p-badge-warning {
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  border-color: var(--ui-warning);
}
.p-badge-danger {
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
  border-color: var(--ui-danger);
}

/* 点标记 */
.p-badge-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 0;
}
</style>
