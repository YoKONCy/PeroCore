<script setup lang="ts">
/**
 * PButton — 像素风按钮
 *
 * pixel-btn 系列样式，支持变体和尺寸。
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  /** 变体：primary / secondary / danger / ghost */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  /** 尺寸：sm / md / lg */
  size?: 'sm' | 'md' | 'lg'
  /** 禁用 */
  disabled?: boolean
  /** 加载中 */
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
})
</script>

<template>
  <button
    :class="['p-btn', `p-btn-${variant}`, `p-btn-${size}`, { 'p-btn-loading': loading }]"
    :disabled="disabled || loading"
  >
    <PixelIcon v-if="loading" name="refresh" size="sm" animation="spin" />
    <slot />
  </button>
</template>

<style scoped>
.p-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-pixel), monospace;
  font-weight: 600;
  cursor: pointer;
  border: 2px solid var(--ui-border-default);
  transition:
    transform 0.1s,
    box-shadow 0.1s;
  box-shadow: 3px 3px 0 var(--color-shadow, rgba(0, 0, 0, 0.15));
  position: relative;
  user-select: none;
}

.p-btn:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--color-shadow, rgba(0, 0, 0, 0.15));
}

.p-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 变体 */
.p-btn-primary {
  background: var(--color-sky-500);
  color: white;
  border-color: var(--color-sky-shadow);
}
.p-btn-primary:hover:not(:disabled) {
  background: var(--color-sky-shadow);
}

.p-btn-secondary {
  background: var(--dash-panel-soft);
  color: var(--ui-text-primary);
  border-color: var(--ui-border-default);
}
.p-btn-secondary:hover:not(:disabled) {
  background: var(--ui-bg-hover);
}

.p-btn-danger {
  background: var(--color-red-face);
  color: white;
  border-color: var(--color-red-shadow);
}
.p-btn-danger:hover:not(:disabled) {
  background: var(--color-red-shadow);
}

.p-btn-ghost {
  background: transparent;
  color: var(--ui-text-primary);
  border-color: transparent;
  box-shadow: none;
}
.p-btn-ghost:hover:not(:disabled) {
  background: var(--ui-bg-hover);
}
.p-btn-ghost:active:not(:disabled) {
  transform: none;
}

/* 尺寸 */
.p-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.p-btn-md {
  padding: 6px 16px;
  font-size: 14px;
}
.p-btn-lg {
  padding: 10px 24px;
  font-size: 16px;
}

/* 加载 */
.p-btn-loading {
  pointer-events: none;
}
.p-btn-spinner {
  animation: pixel-spin 1s steps(4) infinite;
}

@keyframes pixel-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
