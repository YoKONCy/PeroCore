<script setup lang="ts">
/**
 * OverviewTab — 总览 Tab (F1-5 增强版)
 *
 * 展示系统概况：统计卡片 + Agent 状态 + 最近对话时间线 + 系统健康。
 * Mock 数据，F3 替换为 systemApi + agentApi。
 */
import { ref, onMounted } from 'vue'
import { PixelIcon, PCard } from '../../pixel'

const isLoading = ref(true)

// ── Mock 数据 ──

const stats = ref({
  totalChats: 156,
  memoryNodes: 842,
  completedTasks: 37,
  activeModels: 4,
})

const currentAgent = ref({
  name: 'Pero',
  mode: '桌面聊天',
  uptime: '2h 30m',
  status: 'online' as const,
})

const recentChats = ref([
  { id: 1, summary: '前端 F1 Dashboard 实装', agent: 'Pero', time: '12:52', tokenCount: 8500 },
  { id: 2, summary: 'TriviumDB 0.5.1 发布', agent: 'Pero', time: '05:15', tokenCount: 5200 },
  { id: 3, summary: '后端迁移完成度对比分析', agent: 'Pero', time: '05:20', tokenCount: 12300 },
  { id: 4, summary: 'B6 集成 ReAct + NIT v3', agent: 'Pero', time: '昨天 20:30', tokenCount: 18500 },
  { id: 5, summary: 'Dashboard Tabs 组件迁移', agent: 'Pero', time: '昨天 14:00', tokenCount: 28000 },
])

const systemHealth = ref({
  cpu: 23,
  memoryUsed: 1.8,
  memoryTotal: 16,
  dbSize: '42 MB',
  vectorCount: 842,
})

onMounted(() => {
  // TODO: F3 替换为 systemApi.getStats()
  setTimeout(() => { isLoading.value = false }, 400)
})

function formatTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
}
</script>

<template>
  <div class="tab-overview">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="desktop" size="md" /><span>系统总览</span></h2>
      <p class="tab-subtitle">SYSTEM OVERVIEW</p>
    </div>

    <div v-if="isLoading" class="tab-loading">
      <PixelIcon name="refresh" size="lg" animation="spin" />
      <span>加载中...</span>
    </div>

    <div v-else class="overview-scroll">
      <!-- 统计卡片 -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon stat-icon-blue"><PixelIcon name="chat" size="sm" /></div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.totalChats }}</span>
            <span class="stat-label">总对话数</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-pink"><PixelIcon name="brain" size="sm" /></div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.memoryNodes }}</span>
            <span class="stat-label">记忆节点</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-green"><PixelIcon name="check" size="sm" /></div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.completedTasks }}</span>
            <span class="stat-label">完成任务</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-amber"><PixelIcon name="settings" size="sm" /></div>
          <div class="stat-info">
            <span class="stat-value">{{ stats.activeModels }}</span>
            <span class="stat-label">活跃模型</span>
          </div>
        </div>
      </div>

      <!-- Agent 状态 + 系统健康 -->
      <div class="overview-dual">
        <!-- 活跃 Agent -->
        <div class="overview-panel">
          <h3 class="panel-title"><PixelIcon name="user" size="xs" /> 活跃 Agent</h3>
          <div class="agent-card">
            <div class="agent-avatar">{{ currentAgent.name[0] }}</div>
            <div class="agent-info">
              <h4 class="agent-name">{{ currentAgent.name }}</h4>
              <div class="agent-meta">
                <span class="agent-status-dot" />
                <span>{{ currentAgent.mode }}</span>
                <span>· {{ currentAgent.uptime }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 系统健康 -->
        <div class="overview-panel">
          <h3 class="panel-title"><PixelIcon name="desktop" size="xs" /> 系统健康</h3>
          <div class="health-grid">
            <div class="health-item">
              <span class="health-label">CPU</span>
              <div class="health-bar"><div class="health-fill health-fill-blue" :style="{ width: systemHealth.cpu + '%' }" /></div>
              <span class="health-value">{{ systemHealth.cpu }}%</span>
            </div>
            <div class="health-item">
              <span class="health-label">内存</span>
              <div class="health-bar"><div class="health-fill health-fill-pink" :style="{ width: (systemHealth.memoryUsed / systemHealth.memoryTotal * 100) + '%' }" /></div>
              <span class="health-value">{{ systemHealth.memoryUsed }}/{{ systemHealth.memoryTotal }}G</span>
            </div>
            <div class="health-item">
              <span class="health-label">DB</span>
              <span class="health-value" style="margin-left: auto;">{{ systemHealth.dbSize }}</span>
            </div>
            <div class="health-item">
              <span class="health-label">向量</span>
              <span class="health-value" style="margin-left: auto;">{{ systemHealth.vectorCount }} 条</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 最近对话 -->
      <div class="overview-panel">
        <h3 class="panel-title"><PixelIcon name="chat" size="xs" /> 最近对话</h3>
        <div class="timeline">
          <div v-for="chat in recentChats" :key="chat.id" class="timeline-item">
            <div class="timeline-dot" />
            <div class="timeline-content">
              <span class="timeline-summary">{{ chat.summary }}</span>
              <div class="timeline-meta">
                <span>{{ chat.agent }}</span>
                <span>{{ formatTokens(chat.tokenCount) }} tokens</span>
                <span>{{ chat.time }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-overview { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tab-header { margin-bottom: 24px; flex-shrink: 0; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.tab-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }

.overview-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
.overview-scroll::-webkit-scrollbar { width: 4px; }
.overview-scroll::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

/* 统计网格 */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.stat-card { display: flex; align-items: center; gap: 16px; padding: 20px; border: 2px solid var(--color-border); background: var(--color-bg-primary); transition: all 0.2s; }
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
.stat-icon { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
.stat-icon-blue { background: var(--color-blue-500); }
.stat-icon-pink { background: var(--color-pink-500, #ec4899); }
.stat-icon-green { background: var(--color-green-500, #22c55e); }
.stat-icon-amber { background: var(--color-yellow-500, #eab308); }
.stat-info { display: flex; flex-direction: column; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--color-text-primary); line-height: 1; }
.stat-label { font-size: 11px; font-weight: 700; color: var(--color-text-muted); margin-top: 4px; }

/* 双面板 */
.overview-dual { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.overview-panel { border: 2px solid var(--color-border); background: var(--color-bg-primary); padding: 20px; }
.panel-title { font-size: 12px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.1em; display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }

/* Agent 卡片 */
.agent-card { display: flex; align-items: center; gap: 12px; }
.agent-avatar { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--color-blue-400), var(--color-blue-600)); color: white; font-weight: 800; font-size: 18px; }
.agent-info { display: flex; flex-direction: column; gap: 4px; }
.agent-name { font-size: 16px; font-weight: 800; color: var(--color-text-primary); }
.agent-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-muted); }
.agent-status-dot { width: 6px; height: 6px; background: var(--color-green-500, #22c55e); animation: pulse 2s infinite; }

/* 系统健康 */
.health-grid { display: flex; flex-direction: column; gap: 10px; }
.health-item { display: flex; align-items: center; gap: 8px; }
.health-label { font-size: 10px; font-weight: 700; color: var(--color-text-muted); min-width: 32px; }
.health-bar { flex: 1; height: 6px; background: var(--color-bg-secondary); overflow: hidden; }
.health-fill { height: 100%; transition: width 0.6s ease; }
.health-fill-blue { background: var(--color-blue-500); }
.health-fill-pink { background: var(--color-pink-500, #ec4899); }
.health-value { font-size: 10px; font-weight: 700; color: var(--color-text-secondary); min-width: 60px; text-align: right; }

/* 时间线 */
.timeline { display: flex; flex-direction: column; gap: 0; }
.timeline-item { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
.timeline-item:last-child { border-bottom: none; }
.timeline-dot { width: 6px; height: 6px; background: var(--color-blue-400); margin-top: 6px; flex-shrink: 0; }
.timeline-content { min-width: 0; }
.timeline-summary { font-size: 13px; font-weight: 700; color: var(--color-text-primary); display: block; }
.timeline-meta { display: flex; gap: 10px; margin-top: 2px; font-size: 10px; color: var(--color-text-muted); }

@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
</style>
