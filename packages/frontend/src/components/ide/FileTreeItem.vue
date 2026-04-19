<script setup lang="ts">
/**
 * FileTreeItem — 文件树节点 (递归组件)
 *
 * 展示单个文件/文件夹，文件夹可展开/折叠。
 *
 * @props item - 文件节点
 * @emits select - 选中文件
 */
import { ref } from 'vue'
import { PixelIcon } from '../pixel'
import type { FileNode } from './FileExplorer.vue'

interface Props {
  item: FileNode
  depth?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0,
})

const emit = defineEmits<{
  select: [node: FileNode]
}>()

const isExpanded = ref(false)
const isDir = props.item.type === 'directory'

function toggle() {
  if (isDir) {
    isExpanded.value = !isExpanded.value
  } else {
    emit('select', props.item)
  }
}

/** 获取文件图标 */
function getIcon(): string {
  if (isDir) return isExpanded.value ? 'folder-open' : 'folder'
  const ext = props.item.name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    ts: 'code', js: 'code', vue: 'code', py: 'code',
    md: 'document', json: 'settings', css: 'palette',
    html: 'globe', rs: 'code', go: 'code',
  }
  return iconMap[ext ?? ''] ?? 'document'
}
</script>

<template>
  <div class="fti">
    <div
      :class="['fti-row', { 'fti-row-dir': isDir }]"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="toggle"
    >
      <!-- 展开箭头 -->
      <span v-if="isDir" :class="['fti-arrow', { 'fti-arrow-open': isExpanded }]">▶</span>
      <span v-else class="fti-arrow-placeholder" />

      <!-- 图标 -->
      <PixelIcon :name="getIcon()" size="xs" class="fti-icon" />

      <!-- 名称 -->
      <span class="fti-name">{{ item.name }}</span>
    </div>

    <!-- 子节点 (递归) -->
    <div v-if="isDir && isExpanded && item.children?.length" class="fti-children">
      <FileTreeItem
        v-for="child in item.children"
        :key="child.path"
        :item="child"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.fti-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-secondary);
  transition: all 0.15s;
  user-select: none;
}
.fti-row:hover {
  background: var(--color-bg-secondary);
  color: var(--color-blue-500);
}

.fti-arrow {
  font-size: 8px;
  width: 12px;
  text-align: center;
  transition: transform 0.15s;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.fti-arrow-open {
  transform: rotate(90deg);
}
.fti-arrow-placeholder {
  width: 12px;
  flex-shrink: 0;
}

.fti-icon {
  flex-shrink: 0;
}

.fti-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fti-children {
  /* 子节点无额外缩进 — 由 depth prop 控制 */
}
</style>
