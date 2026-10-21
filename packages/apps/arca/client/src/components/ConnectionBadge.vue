<script setup lang="ts">
import { t as __t } from '../i18n'

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
  if (store.connection === 'ready') return __t('apps.arca.ui', '已连接')
  if (store.connection === 'connecting' || store.connection === 'reconnecting')
    return __t('apps.arca.ui', '正在连接')
  if (store.connection === 'error') return __t('apps.arca.ui', '连接异常')
  return __t('apps.arca.ui', '离线')
})
</script>

<template>
  <div class="connection-badge" :data-state="store.connection">
    <span class="status-light" />
    {{ label }}
  </div>
</template>
