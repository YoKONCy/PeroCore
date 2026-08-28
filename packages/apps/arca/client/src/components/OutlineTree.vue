<script setup lang="ts">
/**
 * OutlineTree.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import type { OutlineNode } from '@infos/document-engine'

defineProps<{ nodes: OutlineNode[] }>()
defineEmits<{ select: [nodeId: string] }>()
</script>

<template>
  <ul class="outline-tree">
    <li v-for="node in nodes" :key="node.nodeId">
      <button
        type="button"
        :style="{ paddingLeft: `${10 + (node.level - 1) * 14}px` }"
        @click="$emit('select', node.nodeId)"
      >
        <span class="outline-mark" />
        <span>{{ node.text || '未命名章节' }}</span>
      </button>
      <OutlineTree
        v-if="node.children.length"
        :nodes="node.children"
        @select="$emit('select', $event)"
      />
    </li>
  </ul>
</template>
