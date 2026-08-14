<script setup lang="ts">
/**
 * @file 根组件
 * @description
 *
 * Electron 与 Docker/浏览器模式均由 MainView 承载综合面板，
 * 顶层缓存 MainView 以保留 Tab 状态和 Dashboard 上下文。
 */
import PToast from './components/notification/PToast.vue'
import PModal from './components/notification/PModal.vue'

const keepAliveInclude = ['MainView']
</script>

<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="keepAliveInclude" :max="2">
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
