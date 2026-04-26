<script setup lang="ts">
/**
 * TerminalTab — Dashboard 系统终端 Tab
 *
 * 轻量包装壳，渲染 TerminalPanel 组件。
 *
 * @module packages/frontend/src/components/dashboard/tabs/TerminalTab
 */
import TerminalPanel from '../../terminal/TerminalPanel.vue'
</script>

<template>
  <div class="h-full overflow-hidden">
    <TerminalPanel />
  </div>
</template>
