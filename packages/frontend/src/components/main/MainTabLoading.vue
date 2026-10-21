<script setup lang="ts">
import { t as __t } from '../../i18n/index'

/**
 * MainTabLoading — MainView Tab 的稳定加载占位
 *
 * 用于异步 Tab 首次解析期间，避免动态组件只渲染注释节点而出现空白内容区。
 */
import SurfaceTransition from '../motion/SurfaceTransition.vue'

defineOptions({ name: 'MainTabLoading' })
</script>

<template>
  <SurfaceTransition
    class="main-tab-loading"
    identity="initial-page"
    pending
    fill
    :label="__t('ui.navigation', '正在加载')"
  />
</template>

<style scoped>
.main-tab-loading {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ui-text-tertiary);
  background: var(--ui-bg-canvas);
}
</style>
