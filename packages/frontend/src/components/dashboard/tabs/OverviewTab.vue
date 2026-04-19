<script setup lang="ts">
/**
 * OverviewTab — 总览 Tab
 *
 * 展示系统概况：Agent 状态、消息统计、模型信息、NIT 状态等。
 * TODO: 接入 systemApi + agentApi 加载实际数据
 */
import { ref, onMounted } from 'vue'
import { PixelIcon } from '../../pixel'

const isLoading = ref(true)

onMounted(() => {
  // TODO: 接入 systemApi.getStats()
  setTimeout(() => { isLoading.value = false }, 500)
})
</script>

<template>
  <div class="tab-overview">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="desktop" size="md" />
        <span>系统总览</span>
      </h2>
      <p class="tab-subtitle">SYSTEM OVERVIEW</p>
    </div>

    <div v-if="isLoading" class="tab-loading">
      <PixelIcon name="refresh" size="lg" animation="spin" />
      <span>加载中...</span>
    </div>

    <div v-else class="tab-grid">
      <!-- 统计卡片 -->
      <div class="stat-card">
        <div class="stat-icon stat-icon-blue">
          <PixelIcon name="chat" size="sm" />
        </div>
        <div class="stat-info">
          <span class="stat-value">--</span>
          <span class="stat-label">总对话数</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-pink">
          <PixelIcon name="brain" size="sm" />
        </div>
        <div class="stat-info">
          <span class="stat-value">--</span>
          <span class="stat-label">记忆节点</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-green">
          <PixelIcon name="check" size="sm" />
        </div>
        <div class="stat-info">
          <span class="stat-value">--</span>
          <span class="stat-label">完成任务</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-amber">
          <PixelIcon name="settings" size="sm" />
        </div>
        <div class="stat-info">
          <span class="stat-value">--</span>
          <span class="stat-label">活跃模型</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-overview { padding: 32px; }
.tab-header { margin-bottom: 32px; }
.tab-title {
  display: flex; align-items: center; gap: 12px;
  font-size: 24px; font-weight: 800; color: var(--color-text-primary);
}
.tab-subtitle {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px;
}

.tab-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700;
}

.tab-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.stat-card {
  display: flex; align-items: center; gap: 16px;
  padding: 20px 24px; border: 2px solid var(--color-border);
  background: var(--color-bg-primary); transition: all 0.2s;
}
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); }

.stat-icon {
  width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
  color: white; flex-shrink: 0;
}
.stat-icon-blue { background: var(--color-blue-500); }
.stat-icon-pink { background: var(--color-pink-500, #ec4899); }
.stat-icon-green { background: var(--color-green-500, #22c55e); }
.stat-icon-amber { background: var(--color-yellow-500, #eab308); }

.stat-info { display: flex; flex-direction: column; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--color-text-primary); line-height: 1; }
.stat-label { font-size: 12px; font-weight: 700; color: var(--color-text-muted); margin-top: 4px; }
</style>
