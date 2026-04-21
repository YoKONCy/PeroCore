<script setup lang="ts">
/**
 * @file 根组件
 * @description
 *
 * Electron 模式: 顶层 keep-alive 缓存 DashboardView
 * Docker 模式: keep-alive 由 WebShellView 自己管理，顶层不需要额外缓存
 */
import PToast from './components/notification/PToast.vue'
import PModal from './components/notification/PModal.vue'
import { isElectron } from './utils/ipcAdapter'

const keepAliveInclude = isElectron() ? ['DashboardView'] : ['WebShellView']
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
