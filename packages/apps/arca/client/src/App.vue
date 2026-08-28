<script setup lang="ts">
/**
 * App.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import ArcaTitleBar from './components/ArcaTitleBar.vue'
import { useWorkbenchStore } from './stores/workbench'

const store = useWorkbenchStore()
const media = window.matchMedia('(prefers-color-scheme: dark)')
const handleSystemTheme = () => {
  if (store.themePreference === 'system') store.applyTheme()
}
onMounted(() => {
  store.applyTheme()
  document.documentElement.dataset.motion = localStorage.getItem('arca-motion') ?? 'system'
  media.addEventListener('change', handleSystemTheme)
  void store.connect()
})
onBeforeUnmount(() => media.removeEventListener('change', handleSystemTheme))
</script>

<template>
  <div class="arca-app-shell">
    <ArcaTitleBar />
    <div class="arca-app-content">
      <RouterView v-slot="{ Component, route }">
        <Transition name="surface-route" mode="out-in">
          <component :is="Component" :key="route.name ?? route.path" class="route-work-surface" />
        </Transition>
      </RouterView>
      <span class="route-scanline" aria-hidden="true" />
    </div>
  </div>
</template>
