<script setup lang="ts">
/** Workspace 文件树递归分支，使用统一的资源栏行高与语义色。 */
import { PixelIcon } from '../pixel'
import type { WorkspaceFileNode } from '../../api/modules/approvalsApi'

export interface WorkspaceTreeNode extends WorkspaceFileNode {
  expanded?: boolean
  loading?: boolean
  children?: WorkspaceTreeNode[]
}

defineProps<{ nodes: WorkspaceTreeNode[]; depth: number }>()
const emit = defineEmits<{
  toggle: [node: WorkspaceTreeNode]
  contextmenu: [event: MouseEvent, node: WorkspaceTreeNode]
}>()

/** 递归分支向根组件透传右键事件。 */
function forwardContextMenu(event: MouseEvent, node: WorkspaceTreeNode): void {
  emit('contextmenu', event, node)
}
</script>

<template>
  <div class="tree-branch">
    <div v-for="node in nodes" :key="node.path">
      <button
        class="tree-row"
        :style="{ paddingLeft: `${8 + depth * 14}px` }"
        :title="node.path"
        @click="emit('toggle', node)"
        @contextmenu.prevent.stop="emit('contextmenu', $event, node)"
      >
        <PixelIcon
          :name="
            node.type === 'directory' ? (node.expanded ? 'chevron-down' : 'chevron-right') : 'code'
          "
          size="xs"
          class="tree-icon"
        />
        <span class="tree-name">{{ node.name }}</span>
        <PixelIcon
          v-if="node.loading"
          name="refresh"
          size="xs"
          animation="spin"
          class="tree-loading"
        />
      </button>
      <WorkspaceTreeBranch
        v-if="node.expanded && node.children"
        :nodes="node.children"
        :depth="depth + 1"
        @toggle="emit('toggle', $event)"
        @contextmenu="forwardContextMenu"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  width: 100%;
  min-height: 29px;
  align-items: center;
  gap: 7px;
  margin: 0;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 10px;
  text-align: left;
  cursor: pointer;
}
.tree-row:hover {
  border-left-color: var(--ui-accent-sky);
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.tree-icon {
  width: 15px;
  flex-shrink: 0;
  color: var(--ui-accent-sky);
}
.tree-name {
  overflow: hidden;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-loading {
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
}
[data-theme='dark'] .tree-icon {
  color: var(--ui-accent-purple);
}
</style>
