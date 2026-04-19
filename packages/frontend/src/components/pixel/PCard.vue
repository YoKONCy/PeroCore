<script setup lang="ts">
/**
 * PCard — 像素风卡片容器
 */

interface Props {
  /** 是否有阴影 */
  shadow?: boolean
  /** 是否可悬停 */
  hoverable?: boolean
  /** 内边距 */
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

withDefaults(defineProps<Props>(), {
  shadow: true,
  hoverable: false,
  padding: 'md',
})
</script>

<template>
  <div
    :class="[
      'p-card',
      `p-card-pad-${padding}`,
      { 'p-card-shadow': shadow, 'p-card-hoverable': hoverable },
    ]"
  >
    <slot />
  </div>
</template>

<style scoped>
.p-card {
  background: var(--color-bg-secondary);
  border: 2px solid var(--color-border);
  border-radius: 0;
  color: var(--color-text-primary);
}

.p-card-shadow {
  box-shadow: 4px 4px 0 var(--color-shadow, rgba(0, 0, 0, 0.12));
}

.p-card-hoverable {
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
.p-card-hoverable:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 var(--color-shadow, rgba(0, 0, 0, 0.15));
}

/* 内边距 */
.p-card-pad-none {
  padding: 0;
}
.p-card-pad-sm {
  padding: 8px;
}
.p-card-pad-md {
  padding: 16px;
}
.p-card-pad-lg {
  padding: 24px;
}
</style>
