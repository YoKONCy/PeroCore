<script setup lang="ts">
/**
 * MainTabLoading — MainView Tab 的稳定加载占位
 *
 * 用于异步 Tab 首次解析期间，避免动态组件只渲染注释节点而出现空白内容区。
 */
import { PixelIcon } from '../pixel'

defineOptions({ name: 'MainTabLoading' })
</script>

<template>
  <div class="main-tab-loading" role="status" aria-live="polite">
    <div class="main-tab-loading-icon">
      <PixelIcon name="sparkle" size="lg" animation="pulse" />
    </div>
    <span class="main-tab-loading-title font-pixel">正在加载工作区</span>
    <span class="main-tab-loading-subtitle">LOADING WORKSPACE</span>
  </div>
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

.main-tab-loading-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-md);
}

.main-tab-loading-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ui-text-secondary);
}

.main-tab-loading-subtitle {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
}
</style>
