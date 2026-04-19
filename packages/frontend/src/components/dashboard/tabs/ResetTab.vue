<script setup lang="ts">
/**
 * ResetTab — 危险区域 Tab
 *
 * 系统重置、数据清理操作。
 * TODO: 接入 systemApi
 */
import { PixelIcon, PButton } from '../../pixel'
</script>

<template>
  <div class="tab-reset">
    <div class="tab-header">
      <h2 class="tab-title tab-title-danger">
        <PixelIcon name="alert" size="md" />
        <span>危险区域</span>
      </h2>
      <p class="tab-subtitle">DANGER ZONE</p>
    </div>

    <div class="reset-section">
      <div class="reset-card">
        <div class="reset-card-info">
          <h3 class="reset-card-title">清空对话记录</h3>
          <p class="reset-card-desc">删除所有对话日志。此操作不可撤销。</p>
        </div>
        <PButton variant="danger">清空</PButton>
      </div>
      <div class="reset-card">
        <div class="reset-card-info">
          <h3 class="reset-card-title">重置记忆数据</h3>
          <p class="reset-card-desc">清空所有核心记忆和图谱关系。此操作不可撤销。</p>
        </div>
        <PButton variant="danger">重置</PButton>
      </div>
      <div class="reset-card reset-card-critical">
        <div class="reset-card-info">
          <h3 class="reset-card-title">恢复出厂设置</h3>
          <p class="reset-card-desc">删除所有数据并恢复到初始状态。请三思而后行。</p>
        </div>
        <PButton variant="danger">恢复出厂</PButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-reset { padding: 32px; }
.tab-header { margin-bottom: 32px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-title-danger { color: var(--color-red-500, #ef4444); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }

.reset-section { display: flex; flex-direction: column; gap: 16px; max-width: 640px; }
.reset-card {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  padding: 20px 24px; border: 2px solid var(--color-border); background: var(--color-bg-primary);
}
.reset-card-critical { border-color: var(--color-red-200, #fecaca); background: rgba(239, 68, 68, 0.02); }
.reset-card-info { flex: 1; }
.reset-card-title { font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.reset-card-desc { font-size: 12px; color: var(--color-text-muted); }
</style>
