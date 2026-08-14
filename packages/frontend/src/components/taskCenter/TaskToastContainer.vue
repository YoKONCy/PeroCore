<script setup lang="ts">
/**
 * TaskToastContainer — 任务 toast 固定容器
 *
 * 挂载位置由使用方决定（默认不侵入 App.vue），
 * 位于屏幕右下角，固定定位，使用 transition-group 管理进出动画。
 */
import { useTaskToastStore } from '../../stores/taskToastStore'
import TaskToast from './TaskToast.vue'

const store = useTaskToastStore()
</script>

<template>
  <TransitionGroup
    v-if="store.toasts.length > 0"
    tag="div"
    name="task-toast"
    class="task-toast-container"
  >
    <TaskToast
      v-for="toast in store.toasts"
      :key="toast.id"
      :toast="toast"
      :on-dismiss="store.dismiss"
    />
  </TransitionGroup>
</template>

<style scoped>
.task-toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 最新的 toast 在最下方（数组尾部为最新） */
  align-items: flex-end;
  pointer-events: none; /* 容器本身不拦截点击 */
}

.task-toast-container :deep(.task-toast) {
  pointer-events: auto; /* toast 卡片恢复交互 */
}

/* ── TransitionGroup 过渡动画 ── */

/* 进入：从右侧滑入 + 淡入 */
.task-toast-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

/* 离开：向下滑出 + 淡出（旧 toast 被挤出时下移消失） */
.task-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.task-toast-enter-active {
  transition:
    opacity var(--ui-duration-normal) var(--ui-ease-standard),
    transform var(--ui-duration-normal) var(--ui-ease-bouncy);
}

.task-toast-leave-active {
  transition:
    opacity 0.2s ease-in,
    transform 0.2s ease-in;
  position: absolute; /* 离开时不占位，避免突兀的空间塌陷 */
  width: 320px; /* 与 TaskToast width 保持一致 */
}

/* 位置变化时的平滑过渡 */
.task-toast-move {
  transition: transform 0.2s ease;
}
</style>
