<script setup lang="ts">
/**
 * ModelConfigTab — 模型配置 Tab
 *
 * 管理 LLM 模型列表（添加/编辑/删除）、全局 Provider 配置。
 * TODO: 接入 modelApi
 */
import { PixelIcon, PButton } from '../../pixel'
</script>

<template>
  <div class="tab-model">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="settings" size="md" /><span>模型配置</span></h2>
      <p class="tab-subtitle">MODEL CONFIGURATION</p>
    </div>
    <div class="model-actions">
      <PButton variant="primary">添加模型</PButton>
      <PButton variant="ghost">全局配置</PButton>
    </div>
    <div class="tab-placeholder">
      <PixelIcon name="settings" size="xl" />
      <p>模型列表将在接入 modelApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-model { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.model-actions { display: flex; gap: 12px; margin-bottom: 24px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>
