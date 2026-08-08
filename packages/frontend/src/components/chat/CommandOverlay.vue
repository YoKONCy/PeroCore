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
    <div v-if="command" class="command-overlay">
      <div class="command-dialog pixel-border-moe">
        <!-- 标题 -->
        <div class="command-header">
          <div class="command-icon pixel-border-moe">
            <PixelIcon name="terminal" size="sm" animation="spin" />
          </div>
          <div>
            <h3 class="command-title">正在执行指令...</h3>
            <p class="command-subtitle">请稍候，任务正在后台运行</p>
          </div>
        </div>

        <!-- 命令内容 -->
        <div class="command-body">
          <div class="command-code pixel-border-moe">
            <span class="select-text">{{ command.command }}</span>
            <div class="command-dots">
              <div class="command-dot" />
              <div class="command-dot command-dot-2" />
              <div class="command-dot command-dot-3" />
            </div>
          </div>
          <div class="command-footer">
            <span v-if="command.pid" class="command-pid">PID: {{ command.pid }}</span>
            <button class="command-skip" @click="emit('skip')">跳过等待 (后台继续)</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.command-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(45, 27, 30, 0.42);
  backdrop-filter: blur(6px);
}

.command-dialog {
  width: 100%;
  max-width: 448px;
  overflow: hidden;
  background: rgba(255, 252, 249, 0.96);
  box-shadow: 10px 10px 0 rgba(249, 168, 212, 0.24);
}

.command-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(45, 27, 30, 0.08);
  background: rgba(249, 168, 212, 0.1);
}

.command-icon {
  padding: 8px;
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.16);
}

.command-title {
  color: var(--color-moe-cocoa);
  font-size: 14px;
  font-weight: 900;
}

.command-subtitle {
  color: rgba(45, 27, 30, 0.44);
  font-size: 12px;
  font-weight: 700;
}

.command-body {
  padding: 24px;
}

.command-code {
  position: relative;
  overflow-x: auto;
  padding: 16px;
  background: rgba(45, 27, 30, 0.92);
  color: #86efac;
  font-family: monospace;
  font-size: 13px;
}

.command-dots {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 3px;
}

.command-dot {
  width: 6px;
  height: 6px;
  background: #86efac;
  animation: command-dot-pulse 1.5s infinite;
}

.command-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.command-pid {
  color: rgba(45, 27, 30, 0.42);
  font-size: 12px;
  font-weight: 700;
}

.command-skip {
  border: none;
  background: none;
  color: var(--color-moe-pink);
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  text-decoration: underline;
  text-underline-offset: 4px;
  transition: color 0.16s ease;
}

.command-skip:hover {
  color: #f472b6;
}

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

@keyframes command-dot-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.command-dot-2 {
  animation-delay: 0.15s;
}
.command-dot-3 {
  animation-delay: 0.3s;
}
</style>
