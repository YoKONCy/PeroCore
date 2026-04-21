<script setup lang="ts">
/**
 * WebShellView — Docker/浏览器模式的外壳布局
 *
 * 在 Docker 模式下，所有页面（对话、工作、据点、仪表盘设置）
 * 通过统一的侧边栏导航在单个浏览器标签页中切换。
 *
 * Electron 版不使用此组件（有自己的窗口管理体系）。
 *
 * UI 风格复用 DashboardView 的侧边栏设计语言。
 *
 * @see _docs_/07_DUAL_DEPLOYMENT.md
 */
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PixelIcon, PTooltip } from '../components/pixel'

defineOptions({ name: 'WebShellView' })

/** 应用版本号 (构建时由 vite.config.ts 注入) */
const appVersion = __APP_VERSION__

const router = useRouter()
const route = useRoute()

// ── 导航菜单 ──

interface ShellNavItem {
  id: string
  path: string
  label: string
  icon: string
}

interface ShellNavGroup {
  title: string | null
  items: ShellNavItem[]
}

const navGroups: ShellNavGroup[] = [
  {
    title: null,
    items: [
      { id: 'chat', path: '/app', label: '对话', icon: 'chat' },
      { id: 'work', path: '/app/work', label: '工作模式', icon: 'layout' },
      { id: 'stronghold', path: '/app/stronghold', label: '据点', icon: 'users' },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [{ id: 'dashboard', path: '/app/dashboard', label: '仪表盘', icon: 'settings' }],
  },
]

/** 当前活跃的导航项 */
const activeNavId = computed(() => {
  const path = route.path
  // 精确匹配子路由
  const matched = navGroups
    .flatMap((g) => g.items)
    .find((item) => path === item.path || (item.path !== '/app' && path.startsWith(item.path)))
  return matched?.id ?? 'chat'
})

/** 导航到目标页面 */
function navigateTo(item: ShellNavItem) {
  router.push(item.path)
}

// ── 状态 ──

const isRefreshing = ref(false)

async function handleRefresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  setTimeout(() => {
    isRefreshing.value = false
  }, 1000)
}
</script>

<template>
  <div class="web-shell">
    <!-- 侧边栏 -->
    <aside class="shell-sidebar">
      <!-- 品牌 (复用 Dashboard 设计语言) -->
      <div class="shell-brand">
        <div class="shell-brand-icon">
          <span class="shell-brand-letter">P</span>
        </div>
        <div class="shell-brand-text">
          <span class="shell-brand-sub">PeroperoChat</span>
          <span class="shell-brand-title">萌动链接</span>
        </div>
      </div>

      <!-- 导航菜单 -->
      <nav class="shell-nav">
        <div v-for="(group, gIdx) in navGroups" :key="gIdx" class="shell-nav-group">
          <div v-if="group.title" class="shell-nav-group-title">
            <span class="shell-nav-dot" />
            <span>{{ group.title }}</span>
            <div class="shell-nav-line" />
          </div>

          <button
            v-for="item in group.items"
            :key="item.id"
            :class="['shell-nav-item', { 'shell-nav-item-active': activeNavId === item.id }]"
            @click="navigateTo(item)"
          >
            <div v-if="activeNavId === item.id" class="shell-nav-indicator" />
            <PixelIcon :name="item.icon" size="sm" class="shell-nav-icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>

      <!-- 底部状态 -->
      <div class="shell-sidebar-footer">
        <div class="shell-status">
          <span class="shell-status-dot" />
          <div class="shell-status-text">
            <span class="shell-status-label">Docker</span>
            <span class="shell-status-value">SYSTEM ONLINE</span>
          </div>
          <PTooltip content="刷新" placement="top">
            <button class="shell-refresh-btn" @click="handleRefresh">
              <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
            </button>
          </PTooltip>
        </div>
        <div class="shell-version">v{{ appVersion }} · PeroCore-TS</div>
      </div>
    </aside>

    <!-- 主内容区：嵌套路由出口 -->
    <main class="shell-main">
      <router-view v-slot="{ Component }">
        <keep-alive :include="['DashboardView']" :max="3">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.web-shell {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-primary);
}

/* ── 侧边栏 (复用 DashboardView 设计语言) ── */

.shell-sidebar {
  width: 240px;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 2px solid var(--color-border);
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.4));
  flex-shrink: 0;
}

/* 品牌 */
.shell-brand {
  padding: 24px 20px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.shell-brand-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-sky-hover), var(--color-sky-shadow));
  border: 2px solid var(--color-sky-shadow);
  color: white;
  font-weight: 800;
  font-size: 18px;
  transition: transform 0.3s;
}
.shell-brand-icon:hover {
  transform: scale(1.05) rotate(3deg);
}
.shell-brand-letter {
  user-select: none;
}
.shell-brand-text {
  display: flex;
  flex-direction: column;
}
.shell-brand-sub {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}
.shell-brand-title {
  font-size: 16px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--color-text-primary), var(--color-sky-500));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 导航菜单 */
.shell-nav {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}
.shell-nav-group {
  margin-bottom: 16px;
}
.shell-nav-group-title {
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
.shell-nav-dot {
  width: 4px;
  height: 4px;
  background: var(--color-text-muted);
  flex-shrink: 0;
}
.shell-nav-line {
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.shell-nav-item {
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
.shell-nav-item:hover {
  background: var(--color-bg-primary);
  color: var(--color-sky-500);
  transform: translateX(2px);
}

.shell-nav-item-active {
  background: var(--color-bg-primary);
  color: var(--color-sky-shadow);
  border-color: var(--color-sky-100, rgba(56, 189, 248, 0.2));
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.08);
  transform: translateX(2px);
}

.shell-nav-indicator {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--color-sky-500);
}

.shell-nav-icon {
  transition: color 0.15s;
}

/* 底部 */
.shell-sidebar-footer {
  padding: 12px;
  border-top: 2px solid var(--color-border);
}
.shell-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}
.shell-status-dot {
  width: 10px;
  height: 10px;
  background: var(--color-emerald-face, #22c55e);
  flex-shrink: 0;
  animation: shell-pulse 2s infinite;
}
.shell-status-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.shell-status-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.shell-status-value {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-emerald-shadow, #16a34a);
}
.shell-refresh-btn {
  padding: 6px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.shell-refresh-btn:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
}
.shell-version {
  margin-top: 8px;
  text-align: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.6;
}

/* 主内容 */
.shell-main {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 滚动条 */
.shell-nav::-webkit-scrollbar {
  width: 4px;
}
.shell-nav::-webkit-scrollbar-track {
  background: transparent;
}
.shell-nav::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
.shell-main::-webkit-scrollbar {
  width: 4px;
}
.shell-main::-webkit-scrollbar-track {
  background: transparent;
}
.shell-main::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

@keyframes shell-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
