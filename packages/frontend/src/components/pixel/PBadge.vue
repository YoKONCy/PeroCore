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
  font-family: var(--font-pixel), monospace;
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
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}
.p-badge-primary {
  background: var(--color-blue-100);
  color: var(--color-blue-600);
  border-color: var(--color-blue-300);
}
.p-badge-success {
  background: var(--color-green-100);
  color: var(--color-green-600);
  border-color: var(--color-green-300);
}
.p-badge-warning {
  background: var(--color-yellow-100);
  color: var(--color-yellow-600);
  border-color: var(--color-yellow-300);
}
.p-badge-danger {
  background: var(--color-red-100);
  color: var(--color-red-600);
  border-color: var(--color-red-300);
}

/* 点标记 */
.p-badge-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 0;
}
</style>
