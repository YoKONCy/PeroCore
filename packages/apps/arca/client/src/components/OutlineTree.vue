<script setup lang="ts">
/**
 * OutlineTree.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import type { OutlineNode } from '@infos/document-engine'
import { computed } from 'vue'

const props = defineProps<{ nodes: OutlineNode[]; activeId?: string }>()
const firstLevel = computed(() =>
  props.nodes.length ? Math.min(...props.nodes.map((node) => node.level)) : 1,
)
defineEmits<{ select: [nodeId: string] }>()
</script>

<template>
  <ul class="outline-tree">
    <li v-for="(node, index) in nodes" :key="node.nodeId">
      <button
        type="button"
        :class="{ active: activeId === node.nodeId }"
        :aria-current="activeId === node.nodeId ? 'location' : undefined"
        :style="{ paddingLeft: `${10 + (node.level - 1) * 14}px` }"
        @click="$emit('select', node.nodeId)"
      >
        <span v-if="node.level === firstLevel" class="outline-index">
          {{ String(index + 1).padStart(2, '0') }}
        </span>
        <span>{{ node.text || '未命名章节' }}</span>
      </button>
      <OutlineTree
        v-if="node.children.length"
        :nodes="node.children"
        :active-id="activeId"
        @select="$emit('select', $event)"
      />
    </li>
  </ul>
</template>
