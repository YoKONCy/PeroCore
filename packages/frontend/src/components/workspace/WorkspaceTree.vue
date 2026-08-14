<script setup lang="ts">
/** Agent 绑定的 Workspace 懒加载资源栏，提供文件浏览与全文搜索两种工作模式。 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { PDialog, PixelIcon } from '../pixel'
import WorkspaceTreeBranch, { type WorkspaceTreeNode } from './WorkspaceTreeBranch.vue'
import { workspaceApi, type WorkspaceFileNode } from '../../api/modules/approvalsApi'
import { useNotificationStore } from '../../stores'

const props = defineProps<{ agentId: string; agentName: string; threadId: string }>()
const emit = defineEmits<{
  select: [node: WorkspaceFileNode]
  renamed: [payload: { oldPath: string; newPath: string; name: string }]
  deleted: [path: string]
}>()
const notification = useNotificationStore()

const roots = ref<WorkspaceTreeNode[]>([])
const rootPath = ref('')
const loading = ref(false)
const search = ref('')
const mode = ref<'files' | 'search'>('files')
const searchResults = ref<Array<{ file: string; line: number; content: string }>>([])
const contextMenu = ref<{ x: number; y: number; node: WorkspaceTreeNode } | null>(null)
const pendingRename = ref<WorkspaceTreeNode | null>(null)
const pendingDelete = ref<WorkspaceTreeNode | null>(null)
const fileOperationPending = ref(false)

/** 收集已展开目录，以便自动刷新后恢复用户浏览状态。 */
function collectExpanded(nodes: WorkspaceTreeNode[], output = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === 'directory' && node.expanded) {
      output.add(node.path)
      if (node.children) collectExpanded(node.children, output)
    }
  }
  return output
}

/** 按路径递归恢复已展开目录内容。 */
async function restoreExpanded(nodes: WorkspaceTreeNode[], expanded: Set<string>): Promise<void> {
  for (const node of nodes) {
    if (node.type !== 'directory' || !expanded.has(node.path)) continue
    node.expanded = true
    const res = await workspaceApi.listDir(props, node.path)
    node.children = res.data?.nodes ?? []
    await restoreExpanded(node.children, expanded)
  }
}

async function loadRoot(): Promise<void> {
  if (!props.agentId || !props.threadId) return
  const expanded = collectExpanded(roots.value)
  loading.value = true
  try {
    const res = await workspaceApi.listDir(props, undefined)
    roots.value = res.data?.nodes ?? []
    rootPath.value = res.data?.root ?? ''
    await restoreExpanded(roots.value, expanded)
  } finally {
    loading.value = false
  }
}

async function toggle(node: WorkspaceTreeNode): Promise<void> {
  if (node.type === 'file') {
    emit('select', node)
    return
  }
  node.expanded = !node.expanded
  if (node.expanded && !node.children) {
    node.loading = true
    try {
      const res = await workspaceApi.listDir(props, node.path)
      node.children = res.data?.nodes ?? []
    } finally {
      node.loading = false
    }
  }
}

async function runSearch(): Promise<void> {
  const query = search.value.trim()
  if (!query) {
    searchResults.value = []
    return
  }
  const res = await workspaceApi.search(props, { query })
  searchResults.value = res.data?.matches ?? []
}

function selectMode(nextMode: 'files' | 'search'): void {
  mode.value = nextMode
  if (nextMode === 'files') searchResults.value = []
}

function openContextMenu(event: MouseEvent, node: WorkspaceTreeNode): void {
  if (node.type !== 'file') return
  contextMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 170),
    y: Math.min(event.clientY, window.innerHeight - 100),
    node,
  }
}

function closeContextMenu(): void {
  contextMenu.value = null
}

/** 打开应用内重命名对话框，避免 Electron 中不可靠的 window.prompt。 */
function renameSelected(): void {
  pendingRename.value = contextMenu.value?.node ?? null
  closeContextMenu()
}

/** 校验并提交重命名；后端仍会执行最终路径安全校验。 */
async function confirmRename(value?: string): Promise<void> {
  const node = pendingRename.value
  const newName = value?.trim() ?? ''
  if (!node || fileOperationPending.value) return
  if (!newName || newName === node.name) {
    pendingRename.value = null
    return
  }
  if (newName === '.' || newName === '..' || /[\\/:*?"<>|]/.test(newName)) {
    notification.toast('文件名不能包含 \\ / : * ? " < > | 等非法字符', { type: 'error' })
    return
  }
  fileOperationPending.value = true
  try {
    const res = await workspaceApi.renameFile(props, { path: node.path, newName })
    if (!res.data) throw new Error('重命名接口未返回文件信息')
    emit('renamed', res.data)
    await loadRoot()
    pendingRename.value = null
    notification.toast(`已重命名为 ${newName}`, { type: 'success' })
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : '重命名失败', { type: 'error' })
  } finally {
    fileOperationPending.value = false
  }
}

/** 打开应用内危险操作确认框，避免 Electron 中不可靠的 window.confirm。 */
function deleteSelected(): void {
  pendingDelete.value = contextMenu.value?.node ?? null
  closeContextMenu()
}

async function confirmDelete(): Promise<void> {
  const node = pendingDelete.value
  if (!node || fileOperationPending.value) return
  fileOperationPending.value = true
  try {
    const res = await workspaceApi.deleteFile(props, { path: node.path })
    if (!res.data) throw new Error('删除接口未返回文件信息')
    emit('deleted', node.path)
    await loadRoot()
    pendingDelete.value = null
    notification.toast(`已删除 ${node.name}`, { type: 'success' })
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : '删除失败', { type: 'error' })
  } finally {
    fileOperationPending.value = false
  }
}

function closeRenameDialog(visible: boolean): void {
  if (!visible && !fileOperationPending.value) pendingRename.value = null
}

function closeDeleteDialog(visible: boolean): void {
  if (!visible && !fileOperationPending.value) pendingDelete.value = null
}

/** 供父级在 Agent 工具修改文件后主动刷新。 */
defineExpose({ refresh: loadRoot })

window.addEventListener('click', closeContextMenu)
window.addEventListener('blur', closeContextMenu)
onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('blur', closeContextMenu)
})

watch(() => [props.agentId, props.threadId], loadRoot, { immediate: true })
</script>

<template>
  <div class="workspace-tree">
    <header class="workspace-tree__header">
      <div class="workspace-tree__identity">
        <span class="workspace-tree__eyebrow">RESOURCE RAIL</span>
        <strong>{{ agentName }} 的工作区</strong>
      </div>
      <button class="workspace-tree__icon-button" title="刷新资源" @click="loadRoot">
        <PixelIcon name="refresh" size="xs" :animation="loading ? 'spin' : ''" />
      </button>
    </header>

    <nav class="workspace-tree__modes" aria-label="资源栏模式">
      <button :class="{ active: mode === 'files' }" @click="selectMode('files')">
        <PixelIcon name="folder" size="xs" />
        文件
      </button>
      <button :class="{ active: mode === 'search' }" @click="selectMode('search')">
        <PixelIcon name="search" size="xs" />
        搜索
      </button>
    </nav>

    <div v-if="mode === 'files'" class="workspace-tree__root" :title="rootPath">
      <PixelIcon name="folder" size="xs" />
      <span>{{ rootPath || '正在解析工作区…' }}</span>
    </div>

    <form v-else class="workspace-tree__search" @submit.prevent="runSearch">
      <PixelIcon name="search" size="xs" />
      <input
        v-model="search"
        autofocus
        placeholder="搜索工作区内容…"
        @input="!search && (searchResults = [])"
      />
      <button type="submit" title="执行搜索"><PixelIcon name="chevron-right" size="xs" /></button>
    </form>

    <div class="workspace-tree__body workspace-tree__scrollbar">
      <template v-if="mode === 'search'">
        <div class="workspace-tree__section-title">
          <span>搜索结果</span>
          <i>{{ searchResults.length }}</i>
        </div>
        <button
          v-for="item in searchResults"
          :key="`${item.file}:${item.line}`"
          class="search-result"
          @click="
            emit('select', {
              name: item.file.split('/').pop() || item.file,
              path: item.file,
              type: 'file',
            })
          "
        >
          <span class="search-result__file">
            <PixelIcon name="code" size="xs" />
            {{ item.file }}
          </span>
          <small>第 {{ item.line }} 行 · {{ item.content }}</small>
        </button>
        <div v-if="!searchResults.length" class="workspace-tree__empty">
          <PixelIcon name="search" size="lg" />
          <span>{{ search ? '没有找到匹配内容' : '输入关键词搜索文件内容' }}</span>
        </div>
      </template>

      <template v-else>
        <div class="workspace-tree__section-title">
          <span>WORKSPACE</span>
          <i>{{ roots.length }}</i>
        </div>
        <WorkspaceTreeBranch
          :nodes="roots"
          :depth="0"
          @toggle="toggle"
          @contextmenu="openContextMenu"
        />
        <div v-if="!loading && !roots.length" class="workspace-tree__empty">
          <PixelIcon name="folder" size="lg" />
          <span>工作区当前为空</span>
        </div>
      </template>
    </div>

    <PDialog
      :model-value="Boolean(pendingRename)"
      mode="prompt"
      title="重命名文件"
      message="输入新的文件名。文件会保留在当前目录中。"
      placeholder="文件名"
      :default-value="pendingRename?.name || ''"
      confirm-text="重命名"
      @update:model-value="closeRenameDialog"
      @confirm="confirmRename"
    />

    <PDialog
      :model-value="Boolean(pendingDelete)"
      title="永久删除文件"
      :message="`确定永久删除“${pendingDelete?.name || ''}”吗？此操作无法撤销。`"
      confirm-text="永久删除"
      confirm-variant="danger"
      @update:model-value="closeDeleteDialog"
      @confirm="confirmDelete"
    />

    <!-- 文件右键菜单：Teleport 避免被资源栏滚动容器裁切。 -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="workspace-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button @click.stop="renameSelected">
          <PixelIcon name="edit" size="xs" />
          重命名
        </button>
        <button class="danger" @click.stop="deleteSelected">
          <PixelIcon name="trash" size="xs" />
          删除
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.workspace-tree {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
}
.workspace-tree__header {
  display: flex;
  min-height: 64px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.workspace-tree__identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.workspace-tree__identity strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-tree__eyebrow {
  color: var(--ui-accent-sky);
  font: 700 8px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.workspace-tree__icon-button {
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
}
.workspace-tree__icon-button:hover {
  border-color: var(--ui-border-default);
  border-bottom-color: var(--ui-accent-sky);
  background: var(--ui-bg-hover);
  color: var(--ui-accent-sky);
}
.workspace-tree__modes {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0;
  border-bottom: 1px solid var(--ui-border-default);
}
.workspace-tree__modes button {
  position: relative;
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-right: 1px solid var(--ui-border-subtle);
  border-radius: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  font-size: 9px;
  cursor: pointer;
}
.workspace-tree__modes button::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: transparent;
}
.workspace-tree__modes button:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.workspace-tree__modes button.active {
  background: var(--ui-bg-surface);
  color: var(--ui-accent-sky);
  font-weight: 700;
}
.workspace-tree__modes button.active::after {
  background: var(--ui-accent-sky);
}
.workspace-tree__root {
  display: flex;
  min-height: 34px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border-bottom: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.workspace-tree__root span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-tree__search {
  display: flex;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  margin: 8px;
  padding: 0 5px 0 9px;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg-surface);
  color: var(--ui-text-tertiary);
}
.workspace-tree__search:focus-within {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 2px var(--ui-accent-sky-soft);
}
.workspace-tree__search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-primary);
  font-size: 11px;
}
.workspace-tree__search input::placeholder {
  color: var(--ui-text-tertiary);
}
.workspace-tree__search button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: var(--ui-radius-xs);
  background: transparent;
  color: var(--ui-accent-sky);
  cursor: pointer;
}
.workspace-tree__search button:hover {
  background: var(--ui-accent-sky-soft);
}
.workspace-tree__body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 4px 0 8px;
}
.workspace-tree__section-title {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  color: var(--ui-text-tertiary);
  font: 700 8px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.workspace-tree__section-title i {
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 9px;
  background: var(--ui-bg-hover);
  color: var(--ui-text-secondary);
  font-style: normal;
  letter-spacing: 0;
}
.search-result {
  display: flex;
  width: calc(100% - 8px);
  min-height: 48px;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  margin: 1px 4px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.search-result:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-hover);
}
.search-result__file {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--ui-accent-sky);
  font: 10px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result small {
  overflow: hidden;
  color: var(--ui-text-secondary);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-tree__empty {
  display: flex;
  min-height: 160px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  padding: 16px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  text-align: center;
}
.workspace-tree__scrollbar::-webkit-scrollbar {
  width: 5px;
}
.workspace-tree__scrollbar::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--ui-scrollbar-thumb);
}

:deep(.tree-row) {
  display: flex;
  width: calc(100% - 8px);
  min-height: 30px;
  align-items: center;
  gap: 7px;
  margin: 1px 4px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-xs);
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
:deep(.tree-row:hover) {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
:deep(.tree-icon) {
  display: grid;
  width: 15px;
  flex-shrink: 0;
  place-items: center;
  color: var(--ui-accent-sky);
}
:deep(.tree-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-context-menu {
  position: fixed;
  z-index: 10050;
  display: flex;
  width: 156px;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-elevated);
  box-shadow: var(--ui-shadow-lg);
}
.workspace-context-menu button {
  display: flex;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.workspace-context-menu button:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.workspace-context-menu button.danger {
  color: var(--ui-danger);
}
.workspace-context-menu button.danger:hover {
  background: var(--ui-danger-soft);
}

[data-theme='dark'] .workspace-tree {
  background: color-mix(in srgb, var(--ui-bg-surface-soft) 88%, black);
}
[data-theme='dark'] .workspace-tree__modes button.active {
  color: var(--ui-accent-purple);
  background: var(--ui-bg-surface);
}
[data-theme='dark'] .workspace-tree__modes button.active::after {
  background: var(--ui-accent-purple);
}
[data-theme='dark'] :deep(.tree-icon) {
  color: var(--ui-accent-purple);
}
</style>
