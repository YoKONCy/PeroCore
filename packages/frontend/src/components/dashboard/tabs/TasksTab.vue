<script setup lang="ts">
/**
 * TasksTab — 待办任务 Tab
 *
 * TODO: 接入 taskApi
 */
import { PixelIcon } from '../../pixel'
</script>

<template>
  <div class="tab-tasks">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="list" size="md" /><span>待办任务</span></h2>
      <p class="tab-subtitle">TASKS</p>
    </div>
    <div class="tab-placeholder">
      <PixelIcon name="list" size="xl" />
      <p>任务列表将在接入 taskApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-tasks { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>
