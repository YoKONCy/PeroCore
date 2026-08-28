<script setup lang="ts">
/**
 * ConnectionBadge.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed } from 'vue'
import { useWorkbenchStore } from '../stores/workbench'

const store = useWorkbenchStore()
const label = computed(() => {
  if (store.connection === 'ready') return 'Authority 在线'
  if (store.connection === 'connecting' || store.connection === 'reconnecting') return '正在连接'
  if (store.connection === 'error') return '连接异常'
  return '未发现 Host'
})
</script>

<template>
  <div class="connection-badge" :data-state="store.connection">
    <span class="status-light" />
    {{ label }}
  </div>
</template>
