<script setup lang="ts">
/**
 * FileSearchModal — 文件搜索结果对话框
 *
 * 展示工具调用中找到的文件列表，支持：
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
import { systemApi } from '../../api/modules/systemApi'
import { logger } from '../../lib/logger'

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
    pdf: 'file',
    doc: 'file',
    docx: 'file',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    txt: 'file',
    log: 'file',
    zip: 'folder',
  }
  return icons[ext] ?? 'file'
}

/** 打开文件 (P2-13: 接入 systemApi) */
async function openFile(path: string) {
  try {
    await systemApi.openPath(path)
  } catch (err) {
    logger.error('FileSearch', '打开文件失败', err)
  }
}

/** Esc 关闭 */
useEventListener(window, 'keydown', (e: Event) => {
  if ((e as KeyboardEvent).key === 'Escape') close()
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        class="w-[580px] max-h-[80vh] flex flex-col border-2 border-slate-200 bg-white shadow-[8px_8px_0_rgba(0,0,0,0.1)]"
      >
        <!-- 头部 -->
        <div
          class="px-4 py-3 flex items-center justify-between border-b-2 border-slate-200 bg-sky-50"
        >
          <div class="flex items-center gap-2 text-sm font-bold text-slate-800">
            <PixelIcon name="search" size="sm" />
            <span>找到的文件 ({{ files.length }})</span>
          </div>
          <button
            class="p-1 bg-none border-none text-slate-400 cursor-pointer transition-colors hover:text-rose-500"
            @click="close"
          >
            <PixelIcon name="close" size="xs" />
          </button>
        </div>

        <!-- 文件列表 -->
        <div class="flex-1 overflow-y-auto min-h-[200px] p-2 fsm-scrollbar">
          <div v-if="files.length > 0" class="flex flex-col gap-1">
            <div
              v-for="(file, idx) in files"
              :key="idx"
              class="flex items-center gap-3 px-3 py-2.5 cursor-pointer border-2 border-transparent transition-all hover:bg-sky-50 hover:border-sky-200 hover:translate-x-0.5"
              @click="openFile(file)"
            >
              <PixelIcon :name="getFileIcon(file)" size="sm" class="text-sky-300 flex-shrink-0" />
              <div class="flex-1 min-w-0">
                <span class="block text-[13px] font-bold text-slate-800 truncate">
                  {{ getFileName(file) }}
                </span>
                <span class="block text-[11px] font-mono text-slate-400 truncate">{{ file }}</span>
              </div>
            </div>
          </div>
          <div
            v-else
            class="flex flex-col items-center justify-center h-[200px] text-slate-400 font-bold gap-2"
          >
            <PixelIcon name="folder" size="xl" />
            <p>没有找到相关文件</p>
          </div>
        </div>

        <!-- 底部 -->
        <div
          class="px-4 py-3 flex items-center justify-between border-t-2 border-slate-200 bg-sky-50"
        >
          <span class="text-[11px] text-slate-400">点击文件可在资源管理器中定位</span>
          <PButton variant="primary" @click="close">确定</PButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active {
  transition: opacity 0.2s;
}
.fade-leave-active {
  transition: opacity 0.15s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fsm-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.fsm-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
