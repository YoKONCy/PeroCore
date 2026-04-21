<script setup lang="ts">
/**
 * CommandOverlay — 指令执行遮罩
 *
 * 当 Agent 执行终端指令时显示的全屏遮罩。
 * 展示正在执行的命令、PID，并提供"跳过等待"按钮。
 *
 * @props command - 正在执行的命令信息
 * @emits skip - 用户点击跳过等待
 */
import PixelIcon from '../pixel/PixelIcon.vue'

export interface ActiveCommand {
  /** 执行的命令文本 */
  command: string
  /** 进程 ID */
  pid?: number | string
}

interface Props {
  command: ActiveCommand | null
}

defineProps<Props>()
const emit = defineEmits<{ skip: [] }>()
</script>

<template>
  <Transition name="fade">
    <div v-if="command" class="cmd-overlay">
      <div class="cmd-card">
        <!-- 标题 -->
        <div class="cmd-header">
          <div class="cmd-header-icon">
            <PixelIcon name="terminal" size="sm" animation="spin" />
          </div>
          <div>
            <h3 class="cmd-title">正在执行指令...</h3>
            <p class="cmd-subtitle">请稍候，任务正在后台运行</p>
          </div>
        </div>

        <!-- 命令内容 -->
        <div class="cmd-body">
          <div class="cmd-code">
            <span class="cmd-code-text">{{ command.command }}</span>
            <div class="cmd-code-dots">
              <div class="cmd-dot" />
              <div class="cmd-dot cmd-dot-2" />
              <div class="cmd-dot cmd-dot-3" />
            </div>
          </div>
          <div class="cmd-footer">
            <span v-if="command.pid" class="cmd-pid">PID: {{ command.pid }}</span>
            <button class="cmd-skip-btn" @click="emit('skip')">跳过等待 (后台继续)</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cmd-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  padding: 24px;
}

.cmd-card {
  width: 100%;
  max-width: 448px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.cmd-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 2px solid var(--color-border);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.06));
}
.cmd-header-icon {
  padding: 8px;
  background: var(--color-sky-100, rgba(56, 189, 248, 0.12));
  color: var(--color-sky-500);
}
.cmd-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.cmd-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
}

.cmd-body {
  padding: 24px;
}
.cmd-code {
  position: relative;
  padding: 16px;
  background: var(--color-bg-secondary, #0f172a);
  border: 1px solid var(--color-border);
  font-family: monospace;
  font-size: 13px;
  color: var(--color-emerald-400, #4ade80);
  overflow-x: auto;
}
.cmd-code-text {
  user-select: text;
}
.cmd-code-dots {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 3px;
}
.cmd-dot {
  width: 6px;
  height: 6px;
  background: var(--color-emerald-face, #22c55e);
  animation: dot-pulse 1.5s infinite;
}
.cmd-dot-2 {
  animation-delay: 0.15s;
}
.cmd-dot-3 {
  animation-delay: 0.3s;
}

.cmd-footer {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cmd-pid {
  font-size: 12px;
  color: var(--color-text-muted);
}
.cmd-skip-btn {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-sky-500);
  text-decoration: underline;
  text-underline-offset: 4px;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.cmd-skip-btn:hover {
  color: var(--color-sky-hover);
}

@keyframes dot-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

/* 过渡动画 */
.fade-enter-active {
  transition: opacity 0.3s;
}
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
