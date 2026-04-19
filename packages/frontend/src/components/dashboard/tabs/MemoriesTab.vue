<script setup lang="ts">
/**
 * MemoriesTab — 核心记忆 Tab
 *
 * 展示记忆节点列表，支持搜索和故事导入。
 * TODO: 接入 memoryApi 加载实际数据
 */
import { PixelIcon, PInput, PButton } from '../../pixel'
</script>

<template>
  <div class="tab-memories">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="brain" size="md" />
        <span>核心记忆</span>
      </h2>
      <p class="tab-subtitle">CORE MEMORIES</p>
    </div>

    <div class="mem-toolbar">
      <PInput placeholder="搜索记忆..." class="mem-search" />
      <PButton variant="primary">导入故事</PButton>
    </div>

    <div class="tab-placeholder">
      <PixelIcon name="brain" size="xl" />
      <p>记忆节点列表将在接入 memoryApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-memories { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.mem-toolbar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.mem-search { max-width: 300px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>
