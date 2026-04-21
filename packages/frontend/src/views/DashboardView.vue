<script setup lang="ts">
/**
 * DashboardView — 仪表盘页面
 *
 * 侧边栏菜单 + 异步 Tab 内容区。
 * 所有 Tab 使用 defineAsyncComponent 异步加载。
 *
 * @see DashboardView 拆分方案
 */
import { ref, defineAsyncComponent, computed, type Component } from 'vue'
import { PixelIcon, PTooltip } from '../components/pixel'

defineOptions({ name: 'DashboardView' })

// ── Tab 异步加载 (defineAsyncComponent) ──

const tabComponents: Record<string, Component> = {
  overview: defineAsyncComponent(() => import('../components/dashboard/tabs/OverviewTab.vue')),
  logs: defineAsyncComponent(() => import('../components/dashboard/tabs/LogsTab.vue')),
  memories: defineAsyncComponent(() => import('../components/dashboard/tabs/MemoriesTab.vue')),
  tasks: defineAsyncComponent(() => import('../components/dashboard/tabs/TasksTab.vue')),
  model_config: defineAsyncComponent(
    () => import('../components/dashboard/tabs/ModelConfigTab.vue'),
  ),
  voice_config: defineAsyncComponent(() => import('../components/dashboard/tabs/VoiceTab.vue')),
  mcp_config: defineAsyncComponent(() => import('../components/dashboard/tabs/McpTab.vue')),
  user_settings: defineAsyncComponent(
    () => import('../components/dashboard/tabs/UserSettingsTab.vue'),
  ),
  system_reset: defineAsyncComponent(() => import('../components/dashboard/tabs/ResetTab.vue')),
  terminal: defineAsyncComponent(() => import('../components/dashboard/tabs/TerminalTab.vue')),
  napcat: defineAsyncComponent(() => import('../components/dashboard/tabs/SocialTab.vue')),
}

// ── 菜单结构 ──

interface MenuItem {
  id: string
  label: string
  icon: string
  variant?: 'danger'
  /** 标记为延后/不可用 */
  disabled?: boolean
}

interface MenuGroup {
  title: string | null
  items: MenuItem[]
}

const menuGroups: MenuGroup[] = [
  {
    title: null,
    items: [
      { id: 'overview', label: '总览', icon: 'desktop' },
      { id: 'logs', label: '对话日志', icon: 'chat' },
      { id: 'memories', label: '核心记忆', icon: 'brain' },
      { id: 'tasks', label: '待办任务', icon: 'list' },
    ],
  },
  {
    title: 'CONFIGURATION',
    items: [
      { id: 'user_settings', label: '用户设定', icon: 'user' },
      { id: 'model_config', label: '模型配置', icon: 'settings' },
      { id: 'voice_config', label: '语音功能', icon: 'mic' },
      { id: 'mcp_config', label: 'MCP 配置', icon: 'terminal' },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { id: 'napcat', label: '社交适配器', icon: 'terminal' },
      { id: 'terminal', label: '系统终端', icon: 'desktop' },
      { id: 'system_reset', label: '危险区域', icon: 'alert', variant: 'danger' },
    ],
  },
]

// ── 状态 ──

const currentTab = ref('overview')
const isRefreshing = ref(false)

/** 当前活跃 Tab 组件 */
const activeTabComponent = computed(() => tabComponents[currentTab.value] ?? null)

/** 切换 Tab */
function selectTab(id: string) {
  // 被禁用的 Tab (Electron 延后项)
  const item = menuGroups.flatMap((g) => g.items).find((i) => i.id === id)
  if (item?.disabled) return
  currentTab.value = id
}

/** 刷新 (占位) */
async function handleRefresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  // TODO: 接入各 Tab 的数据刷新
  setTimeout(() => {
    isRefreshing.value = false
  }, 1000)
}
</script>

<template>
  <div class="dashboard">
    <!-- 侧边栏 -->
    <aside class="dash-sidebar">
      <!-- 品牌 -->
      <div class="dash-brand">
        <div class="dash-brand-icon">
          <span class="dash-brand-letter">P</span>
        </div>
        <div class="dash-brand-text">
          <span class="dash-brand-sub">PeroperoChat</span>
          <span class="dash-brand-title">萌动链接</span>
        </div>
      </div>

      <!-- 菜单 -->
      <nav class="dash-nav">
        <div v-for="(group, gIdx) in menuGroups" :key="gIdx" class="dash-nav-group">
          <div v-if="group.title" class="dash-nav-group-title">
            <span class="dash-nav-dot" />
            <span>{{ group.title }}</span>
            <div class="dash-nav-line" />
          </div>

          <button
            v-for="item in group.items"
            :key="item.id"
            :class="[
              'dash-nav-item',
              {
                'dash-nav-item-active': currentTab === item.id,
                'dash-nav-item-danger': item.variant === 'danger' && currentTab === item.id,
                'dash-nav-item-disabled': item.disabled,
              },
            ]"
            @click="selectTab(item.id)"
          >
            <div v-if="currentTab === item.id" class="dash-nav-indicator" />
            <PixelIcon :name="item.icon" size="sm" class="dash-nav-icon" />
            <span>{{ item.label }}</span>
            <span v-if="item.disabled" class="dash-nav-badge-p6">P6</span>
          </button>
        </div>
      </nav>

      <!-- 底部状态 -->
      <div class="dash-sidebar-footer">
        <div class="dash-status">
          <span class="dash-status-dot" />
          <div class="dash-status-text">
            <span class="dash-status-label">STATUS</span>
            <span class="dash-status-value">SYSTEM ONLINE</span>
          </div>
          <PTooltip content="刷新数据" placement="top">
            <button class="dash-refresh-btn" @click="handleRefresh">
              <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
            </button>
          </PTooltip>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="dash-main">
      <component :is="activeTabComponent" v-if="activeTabComponent" />
      <div v-else class="dash-empty">
        <PixelIcon name="alert" size="xl" />
        <p>此功能将在后续版本中提供 (P6 Electron)</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-primary);
}

/* ── 侧边栏 ── */

.dash-sidebar {
  width: 256px;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 2px solid var(--color-border);
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.4));
}

.dash-brand {
  padding: 24px 24px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.dash-brand-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-sky-hover), var(--color-sky-shadow));
  border: 2px solid var(--color-sky-shadow);
  color: white;
  font-weight: 800;
  font-size: 20px;
  transition: transform 0.3s;
}
.dash-brand-icon:hover {
  transform: scale(1.05) rotate(3deg);
}
.dash-brand-letter {
  user-select: none;
}
.dash-brand-text {
  display: flex;
  flex-direction: column;
}
.dash-brand-sub {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}
.dash-brand-title {
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--color-text-primary), var(--color-sky-500));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 菜单 */
.dash-nav {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}
.dash-nav-group {
  margin-bottom: 16px;
}
.dash-nav-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
.dash-nav-dot {
  width: 4px;
  height: 4px;
  background: var(--color-text-muted);
  flex-shrink: 0;
}
.dash-nav-line {
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.dash-nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: none;
  border: 2px solid transparent;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  margin-bottom: 4px;
}
.dash-nav-item:hover:not(.dash-nav-item-disabled) {
  background: var(--color-bg-primary);
  color: var(--color-sky-500);
  transform: translateX(2px);
}

.dash-nav-item-active {
  background: var(--color-bg-primary);
  color: var(--color-sky-shadow);
  border-color: var(--color-sky-100, rgba(56, 189, 248, 0.2));
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.08);
  transform: translateX(2px);
}
.dash-nav-item-danger {
  color: var(--color-red-face, #ef4444);
  border-color: rgba(239, 68, 68, 0.2);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.05);
}

.dash-nav-item-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dash-nav-indicator {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--color-sky-500);
}
.dash-nav-item-danger .dash-nav-indicator {
  background: var(--color-red-face, #ef4444);
}

.dash-nav-icon {
  transition: color 0.15s;
}

.dash-nav-badge-p6 {
  margin-left: auto;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 700;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

/* 底部 */
.dash-sidebar-footer {
  padding: 12px;
  border-top: 2px solid var(--color-border);
}
.dash-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}
.dash-status-dot {
  width: 10px;
  height: 10px;
  background: var(--color-emerald-face, #22c55e);
  flex-shrink: 0;
  animation: pulse 2s infinite;
}
.dash-status-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dash-status-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.dash-status-value {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-emerald-shadow, #16a34a);
}
.dash-refresh-btn {
  padding: 6px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.dash-refresh-btn:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
}

/* ── 主内容区 ── */

.dash-main {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.dash-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 700;
}

/* 滚动条 */
.dash-nav::-webkit-scrollbar {
  width: 4px;
}
.dash-nav::-webkit-scrollbar-track {
  background: transparent;
}
.dash-nav::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
.dash-main::-webkit-scrollbar {
  width: 4px;
}
.dash-main::-webkit-scrollbar-track {
  background: transparent;
}
.dash-main::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
