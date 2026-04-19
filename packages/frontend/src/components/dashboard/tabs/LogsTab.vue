<script setup lang="ts">
/**
 * LogsTab — 对话日志 Tab
 *
 * 展示对话历史日志，支持按会话/日期/来源筛选。
 * TODO: 接入 logApi 加载实际数据
 */
import { PixelIcon, PInput } from '../../pixel'

</script>

<template>
  <div class="tab-logs">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="chat" size="md" />
        <span>对话日志</span>
      </h2>
      <p class="tab-subtitle">CONVERSATION LOGS</p>
    </div>

    <!-- 筛选栏 -->
    <div class="logs-toolbar">
      <PInput placeholder="搜索日志..." class="logs-search" />
    </div>

    <!-- 占位 -->
    <div class="tab-placeholder">
      <PixelIcon name="chat" size="xl" />
      <p>日志列表将在接入 logApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-logs { padding: 32px; height: 100%; display: flex; flex-direction: column; }
.tab-header { margin-bottom: 24px; flex-shrink: 0; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.logs-toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-shrink: 0; }
.logs-search { max-width: 300px; }
.tab-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--color-text-muted); font-weight: 700; }
</style>
