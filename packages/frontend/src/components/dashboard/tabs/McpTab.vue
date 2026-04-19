<script setup lang="ts">
/**
 * McpTab — MCP 配置 Tab
 *
 * 管理 MCP 服务器列表（stdio/sse）。
 * TODO: 接入 mcpApi
 */
import { PixelIcon, PButton } from '../../pixel'
</script>

<template>
  <div class="tab-mcp">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="terminal" size="md" /><span>MCP 配置</span></h2>
      <p class="tab-subtitle">MODEL CONTEXT PROTOCOL</p>
    </div>
    <div class="mcp-actions">
      <PButton variant="primary">添加 MCP</PButton>
    </div>
    <div class="tab-placeholder">
      <PixelIcon name="terminal" size="xl" />
      <p>MCP 服务列表将在接入 mcpApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-mcp { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.mcp-actions { display: flex; gap: 12px; margin-bottom: 24px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>
