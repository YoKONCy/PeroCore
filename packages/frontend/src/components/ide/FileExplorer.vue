<script setup lang="ts">
/**
 * FileExplorer — 文件资源管理器
 *
 * 递归展示文件树，支持搜索、新建/重命名/删除、右键菜单。
 * 通过 ideApi 与后端交互。
 *
 * @emits file-selected - 选中文件时触发
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { PixelIcon } from '../pixel'
import FileTreeItem from './FileTreeItem.vue'
import { ideApi } from '../../api/modules/ideApi'
import { useNotificationStore } from '../../stores'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

const emit = defineEmits<{
  'file-selected': [node: FileNode]
}>()

const files = shallowRef<FileNode[]>([])
const isLoading = ref(true)
const searchQuery = ref('')
const notif = useNotificationStore()

/** 递归过滤文件树 */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes
  const q = query.toLowerCase()
  return nodes.reduce<FileNode[]>((acc, node) => {
    const matches = node.name.toLowerCase().includes(q)
    if (node.type === 'directory' && node.children) {
      const filtered = filterTree(node.children, query)
      if (matches || filtered.length > 0) {
        acc.push({ ...node, children: filtered })
      }
    } else if (matches) {
      acc.push(node)
    }
    return acc
  }, [])
}

const filteredFiles = computed(() => filterTree(files.value, searchQuery.value))

/** 加载文件树 */
async function refresh() {
  isLoading.value = true
  try {
    const res = await ideApi.listFiles()
    files.value = res.data ?? []
  } catch {
    // ideApi 内部已通知
  } finally {
    isLoading.value = false
  }
}

/** 选中文件 */
function onSelect(node: FileNode) {
  if (node.type === 'file') {
    emit('file-selected', node)
  }
}

/** 新建文件 */
async function createFile(parent: FileNode | null) {
  const name = prompt('请输入文件名:')
  if (!name) return
  const parentPath = parent?.path ?? ''
  const path = parentPath ? `${parentPath}/${name}` : name
  try {
    await ideApi.createFile(path, false)
    await refresh()
    notif.toast(`文件 ${name} 已创建`, { type: 'success' })
  } catch {
    notif.toast('创建文件失败', { type: 'error' })
  }
}

/** 新建文件夹 */
async function createFolder(parent: FileNode | null) {
  const name = prompt('请输入文件夹名:')
  if (!name) return
  const parentPath = parent?.path ?? ''
  const path = parentPath ? `${parentPath}/${name}` : name
  try {
    await ideApi.createFile(path, true)
    await refresh()
    notif.toast(`文件夹 ${name} 已创建`, { type: 'success' })
  } catch {
    notif.toast('创建文件夹失败', { type: 'error' })
  }
}

onMounted(refresh)

defineExpose({ refresh })
</script>

<template>
  <div class="file-explorer">
    <!-- 工具栏 -->
    <div class="fe-toolbar">
      <div class="fe-toolbar-actions">
        <button class="fe-action-btn" title="新建文件" @click="createFile(null)">
          <PixelIcon name="plus" size="xs" />
        </button>
        <button class="fe-action-btn" title="新建文件夹" @click="createFolder(null)">
          <PixelIcon name="folder-plus" size="xs" />
        </button>
        <button class="fe-action-btn" title="刷新" @click="refresh">
          <PixelIcon name="refresh" size="xs" :animation="isLoading ? 'spin' : ''" />
        </button>
      </div>
      <div class="fe-search">
        <PixelIcon name="search" size="xs" class="fe-search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索文件..."
          class="fe-search-input"
        />
      </div>
    </div>

    <!-- 文件树 -->
    <div class="fe-tree">
      <div v-if="isLoading" class="fe-loading">
        <PixelIcon name="refresh" size="sm" animation="spin" />
        <span>加载中...</span>
      </div>
      <div v-else-if="filteredFiles.length === 0" class="fe-empty">
        <span>{{ searchQuery ? '无搜索结果' : '工作区为空' }}</span>
      </div>
      <div v-else class="fe-tree-list">
        <FileTreeItem
          v-for="item in filteredFiles"
          :key="item.path"
          :item="item"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-explorer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.fe-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  padding: 8px 12px;
}
.fe-toolbar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 8px;
}
.fe-action-btn {
  padding: 6px;
  background: none;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.fe-action-btn:hover {
  color: var(--color-sky-500);
  border-color: var(--color-border);
  background: var(--color-bg-secondary);
}

.fe-search {
  position: relative;
}
.fe-search-icon {
  position: absolute;
  left: 8px;
  top: 8px;
  color: var(--color-text-muted);
}
.fe-search-input {
  width: 100%;
  padding: 6px 8px 6px 28px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.2s;
}
.fe-search-input:focus {
  border-color: var(--color-sky-hover);
}
.fe-search-input::placeholder {
  color: var(--color-text-muted);
}

.fe-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.fe-tree::-webkit-scrollbar {
  width: 4px;
}
.fe-tree::-webkit-scrollbar-track {
  background: transparent;
}
.fe-tree::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.fe-loading,
.fe-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 80px;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.fe-tree-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
