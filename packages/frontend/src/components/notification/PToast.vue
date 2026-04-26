<script setup lang="ts">
/**
 * PToast — 全局 Toast 通知容器
 *
 * 从 useNotificationStore 读取 toasts 队列并逐个渲染。
 * 参考风格:
 * - 标题 + 消息体 + 进度条
 * - 类型色彩 (info/success/warning/error)
 * - 点击关闭 + 自动消失
 *
 * @module packages/frontend/src/components/notification/PToast
 */
import { useNotificationStore } from '../../stores'

const store = useNotificationStore()

/** 类型图标映射 */
const iconMap: Record<string, string> = {
  info: '💠',
  success: '✅',
  warning: '⚡',
  error: '🔴',
}

/** 默认标题 */
const defaultTitleMap: Record<string, string> = {
  info: '提示',
  success: '成功',
  warning: '警告',
  error: '错误',
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast-list">
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          :class="['toast-item', `toast-${toast.type}`]"
        >
          <!-- 标题栏 -->
          <div class="toast-header">
            <span class="toast-icon">{{ iconMap[toast.type] ?? '💠' }}</span>
            <span class="toast-title">
              {{ toast.title || defaultTitleMap[toast.type] || '提示' }}
            </span>
            <button class="toast-close" @click="store.removeToast(toast.id)">✕</button>
          </div>

          <!-- 消息体 -->
          <div class="toast-body">{{ toast.message }}</div>

          <!-- 倒计时进度条 -->
          <div v-if="toast.duration > 0" class="toast-progress">
            <div class="toast-progress-bar" :style="{ animationDuration: toast.duration + 'ms' }" />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
/* ═══ 容器 (右上角堆叠) ═══ */
.toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 14px;
  pointer-events: none;
  max-width: 420px;
  width: 100%;
}

/* ═══ 单条通知 (硬核心像素风) ═══ */
.toast-item {
  pointer-events: auto;
  /* 强制使用实心暗色背景，避免浅色透明变量导致白色字体不可见 */
  background: #1e1e24;
  border: 2px solid #0f172a;
  border-left-width: 6px;
  border-radius: 0;
  overflow: hidden;
  color: #eee;
  box-shadow: 4px 4px 0px 0px rgba(0, 0, 0, 0.4);
  transition:
    transform 0.15s steps(3),
    box-shadow 0.15s steps(3);
  transform-origin: top right;
}

.toast-item:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px 0px rgba(0, 0, 0, 0.5);
}

/* ── 类型色彩 (实色边框) ── */
.toast-info {
  border-left-color: var(--color-sky-500, #38bdf8);
}

.toast-success {
  border-left-color: var(--color-emerald-400, #34d399);
}

.toast-warning {
  border-left-color: var(--color-amber-400, #fbbf24);
}

.toast-error {
  border-left-color: var(--color-red-500, #ef4444);
}

/* ── 标题栏 ── */
.toast-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 2px solid #0f172a;
  gap: 12px;
}

.toast-icon {
  flex-shrink: 0;
  font-size: 20px;
}

.toast-title {
  flex: 1;
  font-family: var(--font-pixel, monospace);
  font-weight: 700;
  font-size: 16px;
  color: #fff;
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-close {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 4px;
  margin: -4px;
  border-radius: 4px;
  transition: all 0.15s;
}

.toast-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

/* ── 消息体 ── */
.toast-body {
  padding: 12px 16px;
  line-height: 1.6;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.toast-body::-webkit-scrollbar {
  width: 3px;
}

.toast-body::-webkit-scrollbar-thumb {
  background: #444;
}

/* ── 进度条 ── */
.toast-progress {
  height: 4px;
  background: #0f172a;
  width: 100%;
}

.toast-progress-bar {
  height: 100%;
  width: 100%;
  transform-origin: left;
  animation: toast-countdown linear forwards;
}

/* 按类型着色进度条，实心像素风 */
.toast-info .toast-progress-bar {
  background: var(--color-sky-500, #38bdf8);
}

.toast-success .toast-progress-bar {
  background: var(--color-emerald-400, #34d399);
}

.toast-warning .toast-progress-bar {
  background: var(--color-amber-400, #fbbf24);
}

.toast-error .toast-progress-bar {
  background: var(--color-red-500, #ef4444);
}

@keyframes toast-countdown {
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
}

/* ═══ 列表过渡动画 ═══ */
.toast-list-enter-active {
  transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.toast-list-leave-active {
  transition: all 0.25s ease-in;
}

.toast-list-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.92);
}

.toast-list-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}

.toast-list-move {
  transition: transform 0.3s ease;
}
</style>
