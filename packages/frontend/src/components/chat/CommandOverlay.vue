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
    <div
      v-if="command"
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
    >
      <div
        class="w-full max-w-md border-2 border-slate-200 bg-white shadow-[8px_8px_0_rgba(0,0,0,0.15)] overflow-hidden"
      >
        <!-- 标题 -->
        <div class="flex items-center gap-3 px-6 py-4 border-b-2 border-slate-200 bg-sky-50">
          <div class="p-2 bg-sky-100 text-sky-500">
            <PixelIcon name="terminal" size="sm" animation="spin" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800">正在执行指令...</h3>
            <p class="text-xs text-slate-400">请稍候，任务正在后台运行</p>
          </div>
        </div>

        <!-- 命令内容 -->
        <div class="p-6">
          <div
            class="relative p-4 bg-slate-900 border border-slate-200 font-mono text-[13px] text-emerald-400 overflow-x-auto"
          >
            <span class="select-text">{{ command.command }}</span>
            <div class="absolute bottom-2 right-2 flex gap-[3px]">
              <div class="w-1.5 h-1.5 bg-emerald-500 cmd-dot" />
              <div class="w-1.5 h-1.5 bg-emerald-500 cmd-dot cmd-dot-2" />
              <div class="w-1.5 h-1.5 bg-emerald-500 cmd-dot cmd-dot-3" />
            </div>
          </div>
          <div class="mt-4 flex items-center justify-between">
            <span v-if="command.pid" class="text-xs text-slate-400">PID: {{ command.pid }}</span>
            <button
              class="text-xs font-bold text-sky-500 underline underline-offset-4 bg-none border-none cursor-pointer transition-colors hover:text-sky-400"
              @click="emit('skip')"
            >
              跳过等待 (后台继续)
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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

@keyframes cmd-dot-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.cmd-dot {
  animation: cmd-dot-pulse 1.5s infinite;
}
.cmd-dot-2 {
  animation-delay: 0.15s;
}
.cmd-dot-3 {
  animation-delay: 0.3s;
}
</style>
