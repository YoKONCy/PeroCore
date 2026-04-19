<script setup lang="ts">
/**
 * FileSearchModal — 文件搜索结果对话框
 *
 * 展示工具调用中找到的文件列表，支持：
 * - 可拖拽头部
 * - 点击文件在资源管理器中打开
 * - Esc 关闭
 *
 * @props visible - 是否显示
 * @props files - 文件路径列表
 * @emits update:visible - 关闭
 */

import PixelIcon from '../pixel/PixelIcon.vue'
import { PButton } from '../pixel'
import { useEventListener } from '../../composables'

interface Props {
  visible?: boolean
  files?: string[]
}

withDefaults(defineProps<Props>(), {
  visible: false,
  files: () => [],
})

const emit = defineEmits<{
  'update:visible': [val: boolean]
}>()

/** 关闭弹窗 */
function close() {
  emit('update:visible', false)
}

/** 获取文件名 */
function getFileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 获取文件类型图标 */
function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const icons: Record<string, string> = {
    pdf: 'file', doc: 'file', docx: 'file',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
    txt: 'file', log: 'file', zip: 'folder',
  }
  return icons[ext] ?? 'file'
}

/** 打开文件 (TODO: 接入 systemApi) */
function openFile(path: string) {
  // TODO: 通过 systemApi.openPath(path) 打开
  void path
}

/** Esc 关闭 */
useEventListener(window, 'keydown', (e: Event) => {
  if ((e as KeyboardEvent).key === 'Escape') close()
})
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="fsm-overlay" @click.self="close">
      <div class="fsm-card">
        <!-- 头部 -->
        <div class="fsm-header">
          <div class="fsm-header-title">
            <PixelIcon name="search" size="sm" />
            <span>找到的文件 ({{ files.length }})</span>
          </div>
          <button class="fsm-close-btn" @click="close">
            <PixelIcon name="close" size="xs" />
          </button>
        </div>

        <!-- 文件列表 -->
        <div class="fsm-body">
          <div v-if="files.length > 0" class="fsm-list">
            <div
              v-for="(file, idx) in files"
              :key="idx"
              class="fsm-file-item"
              @click="openFile(file)"
            >
              <PixelIcon :name="getFileIcon(file)" size="sm" class="fsm-file-icon" />
              <div class="fsm-file-info">
                <span class="fsm-file-name">{{ getFileName(file) }}</span>
                <span class="fsm-file-path">{{ file }}</span>
              </div>
            </div>
          </div>
          <div v-else class="fsm-empty">
            <PixelIcon name="folder" size="xl" />
            <p>没有找到相关文件</p>
          </div>
        </div>

        <!-- 底部 -->
        <div class="fsm-footer">
          <span class="fsm-hint">点击文件可在资源管理器中定位</span>
          <PButton variant="primary" @click="close">确定</PButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fsm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
}

.fsm-card {
  width: 580px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  box-shadow: 8px 8px 0 var(--color-shadow);
}

.fsm-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--color-border);
  background: var(--color-blue-50);
}
.fsm-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.fsm-close-btn {
  padding: 4px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}
.fsm-close-btn:hover { color: var(--color-red-500); }

.fsm-body {
  flex: 1;
  overflow-y: auto;
  min-height: 200px;
  padding: 8px;
}

.fsm-list { display: flex; flex-direction: column; gap: 4px; }

.fsm-file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s;
}
.fsm-file-item:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-blue-200);
  transform: translateX(2px);
}
.fsm-file-icon { color: var(--color-blue-400); flex-shrink: 0; }
.fsm-file-info { flex: 1; min-width: 0; }
.fsm-file-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fsm-file-path {
  display: block;
  font-size: 11px;
  font-family: monospace;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fsm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-text-muted);
  font-weight: 700;
  gap: 8px;
}

.fsm-footer {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 2px solid var(--color-border);
  background: var(--color-blue-50);
}
.fsm-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* 过渡 */
.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 滚动条 */
.fsm-body::-webkit-scrollbar { width: 4px; }
.fsm-body::-webkit-scrollbar-track { background: transparent; }
.fsm-body::-webkit-scrollbar-thumb { background: var(--color-blue-200); }
</style>
