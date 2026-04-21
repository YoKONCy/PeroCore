<script setup lang="ts">
/**
 * CustomTitleBar — 自定义窗口标题栏
 *
 * 仅在 Electron 模式下渲染 (使用方通过 v-if="isElectron()" 控制)。
 * 提供拖拽区域 + 最小化/最大化/关闭按钮。
 *
 * - 像素风格统一
 * - 通过 ipcAdapter 解耦，前端代码零 Electron 直接引用
 * - 亚克力/透明兼容
 *
 * @module packages/frontend/src/components/layout/CustomTitleBar
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'
import { invoke, listen } from '../../utils/ipcAdapter'

// ── Props ──

interface Props {
  /** 标题文字 */
  title?: string
  /** 是否透明样式 (Pet 窗口等) */
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

// ── 状态 ──

const isMaximized = ref(false)
let unlistenState: (() => void) | null = null

// ── 窗口操作 ──

async function minimize() {
  await invoke('window-minimize')
}

async function toggleMaximize() {
  // 乐观更新
  isMaximized.value = !isMaximized.value
  try {
    const result = await invoke('window-maximize')
    if (result !== null && result !== undefined) {
      isMaximized.value = result as boolean
    }
  } catch {
    // 回退
    isMaximized.value = !isMaximized.value
  }
}

async function close() {
  await invoke('window-close')
}

// ── 生命周期 ──

onMounted(async () => {
  // 获取初始状态
  try {
    isMaximized.value = (await invoke('window-is-maximized')) as boolean
  } catch {
    // 非 Electron 环境
  }

  // 监听主进程状态变更
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

<template>
  <div
    :class="[
      'titlebar',
      {
        'titlebar--transparent': transparent,
        'titlebar--work': isWorkMode && !transparent,
        'titlebar--maximized': isMaximized,
      },
    ]"
  >
    <!-- 左侧: 应用标识 -->
    <div class="titlebar__brand">
      <div class="titlebar__dot" />
      <span class="titlebar__title">{{ title }}</span>
    </div>

    <!-- 右侧: 窗口控制 -->
    <div class="titlebar__controls">
      <!-- 模式切换按钮 -->
      <button
        v-if="showModeToggle"
        class="titlebar__btn titlebar__btn--mode"
        :title="isWorkMode ? '切换至对话' : '切换至工作'"
        @click="emit('toggle-mode')"
      >
        <PixelIcon :name="isWorkMode ? 'chat' : 'settings'" size="xs" />
        <span class="titlebar__btn-label">{{ isWorkMode ? 'CHAT' : 'WORK' }}</span>
      </button>

      <!-- 最小化 -->
      <button class="titlebar__btn" title="最小化" @click="minimize">
        <PixelIcon name="minus" size="xs" />
      </button>

      <!-- 最大化/还原 -->
      <button
        class="titlebar__btn"
        :title="isMaximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <PixelIcon :name="isMaximized ? 'copy' : 'square'" size="xs" />
      </button>

      <!-- 关闭 -->
      <button class="titlebar__btn titlebar__btn--close" title="关闭" @click="close">
        <PixelIcon name="close" size="xs" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  width: 100%;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  user-select: none;
  -webkit-app-region: drag;
  transition:
    background-color 0.3s,
    border-color 0.3s;
  /* 默认: 浅色主题 */
  background: var(--color-bg-secondary, rgba(245, 248, 255, 0.85));
  border-bottom: 2px solid var(--color-border, rgba(56, 189, 248, 0.15));
}

.titlebar--transparent {
  background: transparent;
  border-bottom-color: transparent;
}

.titlebar--work {
  background: #0f172a;
  border-bottom-color: #1e293b;
}

.titlebar--maximized {
  padding-top: 4px;
}

/* 品牌区 */
.titlebar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 16px;
  pointer-events: none;
}

.titlebar__dot {
  width: 8px;
  height: 8px;
  background: var(--color-sky-500, #38bdf8);
  flex-shrink: 0;
}

.titlebar--work .titlebar__dot {
  background: #475569;
}

.titlebar__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #64748b);
  font-family: 'Consolas', 'Monaco', monospace;
}

.titlebar--work .titlebar__title {
  color: #475569;
}

.titlebar--transparent .titlebar__title {
  color: transparent;
}

/* 控制按钮 */
.titlebar__controls {
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: no-drag;
}

.titlebar__btn {
  height: 100%;
  width: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted, #94a3b8);
  transition:
    background-color 0.15s,
    color 0.15s;
}

.titlebar__btn:hover {
  background: var(--color-bg-primary, rgba(56, 189, 248, 0.06));
  color: var(--color-sky-500, #38bdf8);
}

.titlebar--work .titlebar__btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #38bdf8;
}

.titlebar__btn--close:hover {
  background: #ef4444 !important;
  color: white !important;
}

.titlebar__btn--mode {
  width: auto;
  padding: 0 12px;
  gap: 6px;
  margin-right: 4px;
}

.titlebar__btn-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
</style>
