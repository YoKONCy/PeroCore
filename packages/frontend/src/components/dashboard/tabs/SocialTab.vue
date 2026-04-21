<script setup lang="ts">
/**
 * SocialTab — Dashboard 社交适配器 Tab
 *
 * 轻量包装壳，渲染 SocialAdapterTerminal 组件。
 * 社交适配器管理面板，平台无关。
 *
 * @module packages/frontend/src/components/dashboard/tabs/SocialTab
 */
import SocialAdapterTerminal from '../../terminal/SocialAdapterTerminal.vue'
</script>

<template>
  <div class="social-tab">
    <SocialAdapterTerminal />
  </div>
</template>

<style scoped>
.social-tab {
  height: 100%;
  overflow: hidden;
}
</style>
