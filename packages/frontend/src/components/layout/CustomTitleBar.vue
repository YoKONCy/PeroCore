<template>
  <div
    class="custom-title-bar h-8 w-full flex items-center justify-between select-none z-[9999] fixed top-0 left-0 right-0 transition-all duration-300"
    :class="[
      transparent ? 'ctb-transparent bg-transparent' : 'ctb-solid',
      !transparent &&
        (isWorkMode
          ? 'bg-[#0f172a] border-b-2 border-slate-700'
          : 'bg-sky-50 border-b-2 border-sky-100'),
      isMaximized ? 'px-4' : '',
    ]"
    :style="isMaximized ? { paddingTop: '4px' } : {}"
    style="-webkit-app-region: drag"
  >
    <!-- 左侧：应用标题 / 图标 -->
    <div
      class="ctb-title flex items-center gap-3 px-4 pointer-events-none"
      :class="isWorkMode ? 'text-slate-400' : 'text-sky-700'"
    >
      <div
        class="ctb-dot w-3 h-3"
        :class="isWorkMode ? 'bg-slate-600' : 'bg-pink-400 pixel-border-pink'"
      />
      <span class="text-xs font-bold tracking-wide font-mono opacity-90">{{ title }}</span>
    </div>

    <!-- 右侧：窗口控制 -->
    <div class="flex items-center h-full" style="-webkit-app-region: no-drag">
      <!-- 模式切换 -->
      <button
        v-if="showModeToggle"
        class="ctb-btn h-full px-3 flex items-center justify-center transition-all duration-200 gap-2 mr-1 group"
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
        class="ctb-btn h-full w-12 flex items-center justify-center transition-all duration-200 group"
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
        class="ctb-btn h-full w-12 flex items-center justify-center transition-all duration-200 group"
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
        class="ctb-btn ctb-close h-full w-12 flex items-center justify-center transition-all duration-200 group"
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
 * 深浅色适配跟随 document 根元素的 data-theme 属性，无需额外 JS 状态。
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

<style scoped>
/* ── 深浅色主题适配 ──
 * 跟随 document 根元素的 data-theme 属性（由 app 的深浅色切换逻辑维护）。
 * 非透明标题栏整体切换底色；透明标题栏（悬浮于页面内容上）仅调整文字与按钮色。
 */
[data-theme='dark'] .custom-title-bar.ctb-solid {
  background: #0f172a;
  border-bottom-color: #334155;
}

[data-theme='dark'] .custom-title-bar .ctb-title {
  color: #94a3b8;
}

[data-theme='dark'] .custom-title-bar .ctb-dot {
  background: #475569;
  border-color: transparent;
}

[data-theme='dark'] .custom-title-bar .ctb-btn {
  color: rgba(148, 163, 184, 0.82);
}

[data-theme='dark'] .custom-title-bar .ctb-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #38bdf8;
}

[data-theme='dark'] .custom-title-bar .ctb-close:hover {
  background: rgba(239, 68, 68, 0.85);
  color: #ffffff;
}
</style>
