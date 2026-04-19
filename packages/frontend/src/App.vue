<script setup lang="ts">
/**
 * @file 根组件
 * @description 遵循 12_FRONTEND_PERFORMANCE.md §3.1 — keep-alive 白名单控制
 */
import PToast from './components/notification/PToast.vue'
import PModal from './components/notification/PModal.vue'
</script>

<template>
  <router-view v-slot="{ Component }">
    <!-- 只缓存 DashboardView，Pet3DView 离开时必须释放 GPU 资源 -->
    <keep-alive :include="['DashboardView']" :max="2">
      <component :is="Component" />
    </keep-alive>
  </router-view>

  <!-- 全局通知 -->
  <PToast />
  <PModal />
</template>

<style>
/* 全局样式将在后续迁移时完善 */
</style>
