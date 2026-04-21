<script setup lang="ts">
/**
 * PToast — 全局 Toast 通知容器
 *
 * 从 useNotificationStore 读取 toasts 队列并逐个渲染。
 * 固定在右上角，从上到下堆叠。
 */
import { useNotificationStore } from '../../stores'

const store = useNotificationStore()

/** 图标映射 */
const iconMap: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          :class="['toast-item', `toast-${toast.type}`]"
          @click="store.removeToast(toast.id)"
        >
          <span class="toast-icon">{{ iconMap[toast.type] ?? 'ℹ️' }}</span>
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  min-width: 280px;
  max-width: 420px;
  border-radius: 0;
  cursor: pointer;
  pointer-events: auto;
  font-size: 14px;
  line-height: 1.4;
  /* 像素风边框 */
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  box-shadow:
    4px 4px 0 var(--color-shadow, rgba(0, 0, 0, 0.15)),
    inset -1px -1px 0 var(--color-shadow, rgba(0, 0, 0, 0.05));
}

.toast-info {
  border-color: var(--color-sky-500);
}
.toast-success {
  border-color: var(--color-emerald-face);
}
.toast-warning {
  border-color: var(--color-yellow-500);
}
.toast-error {
  border-color: var(--color-red-face);
}

.toast-icon {
  flex-shrink: 0;
  font-size: 16px;
}

.toast-message {
  flex: 1;
  word-break: break-word;
}

/* 动画 */
.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(80px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(80px) scale(0.95);
}
.toast-move {
  transition: transform 0.3s ease;
}
</style>
