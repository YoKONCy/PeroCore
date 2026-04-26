<template>
  <div
    class="h-8 w-full flex items-center justify-between select-none z-[9999] fixed top-0 left-0 right-0 transition-all duration-300"
    :class="[
      transparent
        ? 'bg-transparent'
        : isWorkMode
          ? 'bg-[#0f172a] border-b-2 border-slate-700'
          : 'bg-sky-50 border-b-2 border-sky-100',
      isMaximized ? 'px-4' : '',
    ]"
    :style="isMaximized ? { paddingTop: '4px' } : {}"
    style="-webkit-app-region: drag"
  >
    <!-- 左侧：应用标题 / 图标 -->
    <div
      class="flex items-center gap-3 px-4 pointer-events-none"
      :class="isWorkMode ? 'text-slate-400' : 'text-sky-700'"
    >
      <div class="w-3 h-3" :class="isWorkMode ? 'bg-slate-600' : 'bg-pink-400 pixel-border-pink'" />
      <span class="text-xs font-bold tracking-wide font-mono opacity-90">{{ title }}</span>
    </div>

    <!-- 右侧：窗口控制 -->
    <div class="flex items-center h-full" style="-webkit-app-region: no-drag">
      <!-- 模式切换 -->
      <button
        v-if="showModeToggle"
        class="h-full px-3 flex items-center justify-center transition-all duration-200 gap-2 mr-1 group"
        :class="
          isWorkMode
            ? 'hover:bg-white/5 text-slate-400 hover:text-amber-500'
            : 'hover:bg-sky-100 text-sky-600/70 hover:text-sky-600'
        "
        :title="isWorkMode ? '切换至对话' : '切换至工作'"
        @click="emit('toggle-mode')"
      >
        <PixelIcon :name="isWorkMode ? 'chat' : 'briefcase'" size="xs" />
        <span class="text-[10px] font-bold tracking-wider uppercase opacity-80">
          {{ isWorkMode ? 'Chat' : 'Work' }}
        </span>
      </button>

      <!-- 最小化 -->
      <button
        class="h-full w-12 flex items-center justify-center transition-all duration-200 group"
        :class="
          isWorkMode
            ? 'hover:bg-white/5 text-slate-400 hover:text-sky-400'
            : 'hover:bg-sky-100 text-sky-600/70 hover:text-sky-600'
        "
        @click="minimize"
      >
        <PixelIcon name="minus" size="sm" />
      </button>

      <!-- 最大化 / 还原 -->
      <button
        class="h-full w-12 flex items-center justify-center transition-all duration-200 group"
        :class="
          isWorkMode
            ? 'hover:bg-white/5 text-slate-400 hover:text-sky-400'
            : 'hover:bg-sky-100 text-sky-600/70 hover:text-sky-600'
        "
        @click="toggleMaximize"
      >
        <PixelIcon :name="isMaximized ? 'copy' : 'square'" size="sm" />
      </button>

      <!-- 关闭 -->
      <button
        class="h-full w-12 flex items-center justify-center transition-all duration-200 group"
        :class="
          isWorkMode
            ? 'hover:bg-red-500/80 text-slate-400 hover:text-white'
            : 'hover:bg-red-500 text-sky-600/70 hover:text-white'
        "
        @click="close"
      >
        <PixelIcon name="close" size="sm" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CustomTitleBar — 自定义窗口标题栏 (还原 v1 原版)
 *
 * 仅在 Electron 模式下渲染 (使用方通过 v-if="isElectron()" 控制)。
 * 纯 Tailwind utility class，无 BEM/scoped CSS。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'
import { invoke, listen } from '../../utils/ipcAdapter'

interface Props {
  /** 标题文字 */
  title?: string
  /** 是否透明样式 (仅影响背景，标题文字仍可见) */
  transparent?: boolean
  /** 是否工作模式 (深色变体) */
  isWorkMode?: boolean
  /** 是否显示模式切换按钮 */
  showModeToggle?: boolean
}

withDefaults(defineProps<Props>(), {
  title: '萌动链接：PeroperoChat！',
  transparent: false,
  isWorkMode: false,
  showModeToggle: false,
})

const emit = defineEmits<{
  (e: 'toggle-mode'): void
}>()

const isMaximized = ref(false)
let unlistenState: (() => void) | null = null

async function minimize() {
  await invoke('window-minimize')
}

async function toggleMaximize() {
  isMaximized.value = !isMaximized.value
  try {
    const result = await invoke('window-maximize')
    if (result !== null && result !== undefined) {
      isMaximized.value = result as boolean
    }
  } catch {
    isMaximized.value = !isMaximized.value
  }
}

async function close() {
  await invoke('window-close')
}

onMounted(async () => {
  try {
    isMaximized.value = (await invoke('window-is-maximized')) as boolean
  } catch {
    // 非 Electron 环境
  }

  try {
    unlistenState = await listen('window-maximized-state-changed', (state) => {
      isMaximized.value = !!state
    })
  } catch {
    // 非 Electron 环境
  }
})

onUnmounted(() => {
  unlistenState?.()
})
</script>
