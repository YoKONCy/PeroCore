<script setup lang="ts">
// noinspection JSUnusedGlobalSymbols
/**
 * DashboardView — 仪表盘页面
 *
 * 侧边栏菜单 + 异步 Tab 内容区。
 * 所有 Tab 使用 defineAsyncComponent 异步加载。
 * 通过 provide(DASHBOARD_CTX_KEY) 共享后端在线状态、活跃 Agent、全局刷新、确认弹窗。
 *
 * @module packages/frontend/src/views/DashboardView
 */
import { ref, provide, defineAsyncComponent, computed, onMounted, type Component } from 'vue'
import { PixelIcon, PTooltip, PDialog } from '../components/pixel'
import { createDashboardContext, DASHBOARD_CTX_KEY, useGateway } from '../composables/dashboard'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { isElectron } from '../utils/ipcAdapter'
import { logger } from '../lib/logger'
import logoImg from '../assets/logo.png'
import { useNotificationStore } from '../stores'

defineOptions({ name: 'DashboardView' })

/** 编译时注入的版本号 */
const appVersion = __APP_VERSION__

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

/** 需要全屏 overflow:hidden 的 Tab */
const FULL_HEIGHT_TABS = new Set(['logs', 'terminal', 'napcat'])

// ── 菜单结构 ──

interface MenuItem {
  id: string
  label: string
  icon: string
  variant?: 'danger'
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
      { id: 'tasks', label: '待办提醒', icon: 'bell' },
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

/** 当前活跃 Tab 组件 */
const activeTabComponent = computed(() => tabComponents[currentTab.value] ?? null)

/** 当前 Tab 是否需要全屏高度 */
const isFullHeightTab = computed(() => FULL_HEIGHT_TABS.has(currentTab.value))

/** 切换 Tab */
function selectTab(id: string) {
  const item = menuGroups.flatMap((g) => g.items).find((i) => i.id === id)
  if (item?.disabled) return
  currentTab.value = id
}

// ── 环境光 (根据当前 Tab 变色的背景渐变，还原 v1 ambientLightStyle) ──

const TAB_AMBIENT: Record<string, { primary: string; secondary: string }> = {
  overview: { primary: 'rgba(125, 211, 252, 0.15)', secondary: 'rgba(153, 246, 228, 0.1)' },
  logs: { primary: 'rgba(125, 211, 252, 0.1)', secondary: 'rgba(125, 211, 252, 0.08)' },
  memories: { primary: 'rgba(192, 132, 252, 0.15)', secondary: 'rgba(240, 171, 252, 0.1)' },
  tasks: { primary: 'rgba(253, 224, 71, 0.12)', secondary: 'rgba(252, 165, 165, 0.08)' },
  model_config: { primary: 'rgba(56, 189, 248, 0.12)', secondary: 'rgba(14, 165, 233, 0.08)' },
  voice_config: { primary: 'rgba(244, 114, 182, 0.12)', secondary: 'rgba(251, 207, 232, 0.1)' },
  mcp_config: { primary: 'rgba(52, 211, 153, 0.12)', secondary: 'rgba(110, 231, 183, 0.08)' },
  user_settings: { primary: 'rgba(125, 211, 252, 0.1)', secondary: 'rgba(186, 230, 253, 0.1)' },
  system_reset: { primary: 'rgba(244, 63, 94, 0.1)', secondary: 'rgba(252, 165, 165, 0.08)' },
  terminal: { primary: 'rgba(30, 41, 59, 0.08)', secondary: 'rgba(71, 85, 105, 0.05)' },
  napcat: { primary: 'rgba(56, 189, 248, 0.1)', secondary: 'rgba(125, 211, 252, 0.08)' },
}

const DEFAULT_AMBIENT = {
  primary: 'rgba(125, 211, 252, 0.15)',
  secondary: 'rgba(153, 246, 228, 0.1)',
}

const ambientLightStyle = computed(() => {
  const c = TAB_AMBIENT[currentTab.value] ?? DEFAULT_AMBIENT
  return {
    background: `radial-gradient(circle at 20% 30%, ${c.primary} 0%, transparent 70%),
                 radial-gradient(circle at 80% 70%, ${c.secondary} 0%, transparent 70%)`,
    filter: 'blur(100px)',
    opacity: '0.8',
  }
})

// ── 动态粒子 (还原 v1: JS 随机生成 12 个) ──

interface ParticleItem {
  id: number
  icon: string
  size: 'xs' | 'sm'
  style: Record<string, string>
}

const PARTICLE_ICONS = ['sparkle', 'heart', 'star', 'thought', 'chat', 'flash']
const particles = ref<ParticleItem[]>([])

function initParticles() {
  particles.value = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    icon: PARTICLE_ICONS[i % PARTICLE_ICONS.length] ?? 'sparkle',
    size: (i % 3 === 0 ? 'sm' : 'xs') as 'xs' | 'sm',
    style: {
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 5}s`,
      animationDuration: `${10 + Math.random() * 15}s`,
      willChange: 'transform, opacity',
    },
  }))
}

// ── 移动端侧边栏 ──

// 移动端侧边栏展开状态 (TODO: 响应式完善时启用)
// const isSidebarOpen = ref(false)

// ── Dashboard 全局上下文 (provide 给所有 Tab) ──

const ctx = createDashboardContext(currentTab)
provide(DASHBOARD_CTX_KEY, ctx)

const {
  isBackendOnline,
  isRefreshing,
  triggerRefresh,
  showConfirm,
  confirmTitle,
  confirmContent,
  confirmType,
  confirmIsPrompt,
  confirmPromptValue,
  confirmPromptPlaceholder,
  handleConfirm,
  handleCancel,
  handleQuitApp,
} = ctx

/** 全局刷新 */
async function handleRefresh() {
  await triggerRefresh()
}

// ── Gateway WebSocket 接入 (Phase 3) ──

const { isConnected: isGatewayConnected, onPush } = useGateway()
const notifyStore = useNotificationStore()

// 监听通知推送
onPush('notification', (payload) => {
  logger.info('Dashboard', '收到通知', { title: payload.title, body: payload.body })
  const body = (payload.body as string) || (payload.title as string) || '系统通知'
  const level = (payload.level as 'info' | 'success' | 'warning' | 'error') || 'info'
  notifyStore.toast(body, level)
})

// 监听状态更新 → 触发全局刷新
onPush('state_update', () => {
  triggerRefresh()
})

// 监听 Agent 切换
onPush('agent_changed', (payload) => {
  const newId = payload.agentId as string
  if (newId) {
    ctx.activeAgentId.value = newId
    notifyStore.toast(`活跃智能体已切换为: ${newId}`, 'success')
  }
})

onMounted(() => {
  initParticles()
})
</script>

<template>
  <div
    class="min-h-screen bg-sky-50 text-slate-800 selection:bg-sky-500/20 font-sans overflow-hidden pixel-grid-overlay"
  >
    <!-- Electron 自定义标题栏 -->
    <CustomTitleBar v-if="isElectron()" title="Pero Dashboard" />

    <div class="flex h-screen overflow-hidden relative z-10" :class="{ 'pt-8': isElectron() }">
      <!-- 背景装饰层 (还原 v1: 双天蓝光球) -->
      <div v-once class="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div
          class="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-sky-300/20 blur-[150px] rounded-full animate-pulse"
          style="will-change: transform, opacity"
        />
        <div
          class="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-sky-300/20 blur-[150px] rounded-full animate-pulse"
          style="animation-delay: 2s; will-change: transform, opacity"
        />
      </div>

      <!-- 浮动粒子 -->
      <div v-once class="dash-particles">
        <PixelIcon
          name="sparkle"
          size="sm"
          class="dash-particle"
          style="top: 12%; left: 35%; animation-delay: 0s"
        />
        <PixelIcon
          name="heart"
          size="xs"
          class="dash-particle"
          style="top: 28%; left: 72%; animation-delay: 1.2s"
        />
        <PixelIcon
          name="star"
          size="sm"
          class="dash-particle"
          style="top: 55%; left: 48%; animation-delay: 2.4s"
        />
        <PixelIcon
          name="thought"
          size="xs"
          class="dash-particle"
          style="top: 75%; left: 82%; animation-delay: 0.8s"
        />
        <PixelIcon
          name="chat"
          size="xs"
          class="dash-particle"
          style="top: 40%; left: 20%; animation-delay: 3.2s"
        />
        <PixelIcon
          name="flash"
          size="sm"
          class="dash-particle"
          style="top: 88%; left: 58%; animation-delay: 1.8s"
        />
      </div>

      <!-- 侧边栏 -->
      <aside
        class="w-64 flex flex-col border-r-2 border-sky-100/50 bg-white/40 backdrop-blur-xl z-20 relative transition-all duration-300"
      >
        <!-- 右侧像素阴影线 -->
        <div
          class="absolute right-[-2px] top-0 bottom-0 w-[2px] bg-sky-200/30 pointer-events-none"
        />

        <!-- 品牌标识 -->
        <div class="p-6 pb-2 relative z-10">
          <div class="flex items-center gap-4 mb-6">
            <div
              class="relative w-12 h-12 pixel-border-sky overflow-hidden group cursor-pointer press-effect bg-sky-50 p-1.5"
            >
              <img
                :src="logoImg"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:rotate-12"
                alt="Logo"
              />
              <div
                class="absolute inset-0 bg-gradient-to-tr from-sky-300/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              />
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
                PeroperoChat
              </span>
              <h1
                class="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-sky-600 font-pixel"
              >
                萌动链接
              </h1>
              <span
                class="text-[9px] font-mono text-white bg-sky-400 px-1.5 py-[1px] pixel-border-sm press-effect mt-1 self-start cursor-default select-none"
              >
                v{{ appVersion }}
              </span>
            </div>
          </div>
        </div>

        <!-- 菜单 -->
        <nav class="flex-1 overflow-y-auto px-4 space-y-6 py-2 dash-scrollbar">
          <div v-for="(group, gIdx) in menuGroups" :key="gIdx">
            <div v-if="group.title" class="px-2 mb-3 mt-2 flex items-center gap-2">
              <div class="h-1 w-1 bg-slate-300 rounded-full" />
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                {{ group.title }}
              </span>
              <div class="flex-1 h-[1px] bg-slate-100" />
            </div>

            <div class="space-y-1.5">
              <button
                v-for="item in group.items"
                :key="item.id"
                :class="[
                  'dash-tab-btn w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold transition-all duration-300 group press-effect relative overflow-hidden',
                  currentTab === item.id
                    ? item.variant === 'danger'
                      ? 'bg-red-500 text-white pixel-border-red shadow-[4px_4px_0_0_#ef444440] hover:translate-x-1'
                      : 'bg-sky-400 text-white pixel-border-sky shadow-[4px_4px_0_0_#38bdf840] hover:translate-x-1'
                    : item.disabled
                      ? 'text-slate-300 cursor-not-allowed border-2 border-transparent'
                      : 'text-slate-500 hover:bg-sky-50 hover:text-sky-600 hover:translate-x-1 border-2 border-transparent',
                ]"
                :disabled="item.disabled"
                @click="selectTab(item.id)"
              >
                <!-- 像素活跃指示小光块 -->
                <div
                  v-if="currentTab === item.id"
                  class="absolute left-0 top-0 bottom-0 w-1.5 transition-all duration-500 opacity-60"
                  :class="item.variant === 'danger' ? 'bg-red-300' : 'bg-sky-200'"
                />

                <PixelIcon
                  :name="item.icon"
                  size="sm"
                  class="transition-colors relative z-10"
                  :class="[
                    currentTab === item.id
                      ? 'text-white'
                      : item.variant === 'danger'
                        ? 'text-slate-400 group-hover:text-red-500'
                        : 'text-slate-400 group-hover:text-sky-500',
                  ]"
                />
                <span class="relative z-10 font-pixel tracking-wider">
                  {{ item.label }}
                </span>

                <!-- P6 标签 -->
                <span
                  v-if="item.disabled"
                  class="ml-auto text-[9px] font-bold font-pixel text-slate-400 bg-slate-100 px-1.5 py-0.5 border-2 border-slate-200"
                >
                  P6
                </span>

                <!-- 活跃项右侧的像素爱心/光标 -->
                <div
                  v-if="currentTab === item.id"
                  class="ml-auto opacity-80 animate-pixel-float relative z-10"
                >
                  <PixelIcon
                    :name="item.variant === 'danger' ? 'alert' : 'heart'"
                    size="xs"
                    class="text-white/60"
                  />
                </div>
              </button>
            </div>
          </div>
        </nav>

        <!-- 底部 -->
        <div class="p-4 border-t-2 border-sky-100/50 bg-sky-50/30 relative">
          <!-- 像素装饰线 -->
          <div class="absolute top-[-2px] left-4 right-4 h-[2px] bg-white" />

          <!-- 退出系统按钮 -->
          <button
            class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-500 hover:text-rose-600 pixel-border-pink transition-all duration-200 group mb-4 press-effect shadow-sm"
            @click="handleQuitApp"
          >
            <PixelIcon
              name="logout"
              size="sm"
              class="group-hover:-translate-x-1 transition-transform"
            />
            <span class="text-xs font-black tracking-widest">退出系统</span>
          </button>

          <!-- 状态 -->
          <div
            class="flex items-center justify-between px-2 py-1 bg-white/50 border border-sky-100"
          >
            <div class="flex items-center gap-2.5">
              <span class="relative flex h-2.5 w-2.5">
                <span
                  v-if="isBackendOnline"
                  class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                />
                <span
                  class="relative inline-flex rounded-full h-2.5 w-2.5 border-2 border-white shadow-sm"
                  :class="isBackendOnline ? 'bg-emerald-500' : 'bg-rose-500'"
                />
              </span>
              <div class="flex flex-col">
                <span class="text-[10px] text-slate-400 font-bold uppercase leading-none">
                  STATUS
                </span>
                <span
                  class="text-[10px] font-bold"
                  :class="isBackendOnline ? 'text-emerald-600' : 'text-rose-600'"
                >
                  {{ isBackendOnline ? 'SYSTEM ONLINE' : 'OFFLINE' }}
                </span>
              </div>
            </div>
            <PTooltip
              :content="isGatewayConnected ? 'WebSocket 已连接' : 'WebSocket 未连接'"
              placement="top"
            >
              <span class="relative flex h-2 w-2">
                <span
                  v-if="isGatewayConnected"
                  class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"
                />
                <span
                  class="relative inline-flex rounded-full h-2 w-2"
                  :class="isGatewayConnected ? 'bg-sky-500' : 'bg-slate-300'"
                />
              </span>
            </PTooltip>
            <PTooltip content="刷新数据" placement="top">
              <button
                class="p-1.5 bg-white pixel-border-sm hover:bg-sky-50 text-slate-400 hover:text-sky-500 transition-all press-effect"
                @click="handleRefresh"
              >
                <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
              </button>
            </PTooltip>
          </div>
        </div>
      </aside>

      <!-- 主内容区 -->
      <main
        class="flex-1 overflow-hidden relative flex flex-col min-w-0 bg-transparent"
        :class="{ 'overflow-y-auto': !isFullHeightTab }"
      >
        <!-- 环境光层 (根据 Tab 渐变变色，还原 v1) -->
        <div
          class="absolute inset-0 pointer-events-none transition-all duration-1000 z-0"
          :style="ambientLightStyle"
        />

        <!-- 动态浮动粒子 (还原 v1: JS 随机 12 个) -->
        <div class="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div
            v-for="p in particles"
            :key="p.id"
            class="absolute dash-particle opacity-20"
            :style="p.style"
          >
            <PixelIcon :name="p.icon" :size="p.size" class="text-sky-300" />
          </div>
        </div>

        <Transition name="fade-slide" mode="out-in">
          <div v-if="activeTabComponent" :key="currentTab" class="h-full">
            <component :is="activeTabComponent" />
          </div>
          <div
            v-else
            key="empty"
            class="flex flex-col items-center justify-center h-full gap-4 text-slate-400 font-bold text-sm"
          >
            <PixelIcon name="alert" size="xl" />
            <p>此功能将在后续版本中提供</p>
          </div>
        </Transition>
      </main>
    </div>

    <!-- 确认弹窗 -->
    <PDialog
      v-model="showConfirm"
      :title="confirmTitle"
      :message="confirmIsPrompt ? '' : confirmContent"
      :mode="confirmIsPrompt ? 'prompt' : 'confirm'"
      :placeholder="confirmPromptPlaceholder"
      :default-value="confirmPromptValue"
      :confirm-variant="confirmType === 'error' ? 'danger' : 'primary'"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    >
      <!-- prompt 模式下额外显示说明文字 -->
      <p v-if="confirmIsPrompt && confirmContent" class="text-sm text-slate-500 mb-2">
        {{ confirmContent }}
      </p>
    </PDialog>
  </div>
</template>

<style scoped>
/* ── 浮动粒子 ── */

.dash-particle {
  position: absolute;
  color: var(--color-sky-light, #bae6fd);
  opacity: 0.15;
  animation: particle-float 12s ease-in-out infinite;
}

@keyframes particle-float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }

  25% {
    transform: translateY(-15px) rotate(5deg);
  }

  50% {
    transform: translateY(-8px) rotate(-3deg);
  }

  75% {
    transform: translateY(-20px) rotate(8deg);
  }
}

/* ── Tab 切换过渡动画 (fade-slide) ── */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

/* ── 自定义滚动条 (像素风) ── */
.dash-scrollbar::-webkit-scrollbar {
  display: none;
}

/* ── 侧边栏 Tab 按钮: hover 微倾斜 + 呼吸感 ── */
.dash-tab-btn {
  transform-origin: left center;
}
.dash-tab-btn:hover {
  animation: dash-tab-tilt 0.6s steps(4) forwards;
}
/* 选中态持续呼吸 */
.dash-tab-btn.bg-sky-500,
.dash-tab-btn.bg-red-500 {
  animation: dash-tab-breathe 3s steps(4) infinite;
}

@keyframes dash-tab-tilt {
  0% {
    transform: rotate(0deg) scale(1);
  }
  40% {
    transform: rotate(-1.5deg) scale(1.03);
  }
  100% {
    transform: rotate(-0.8deg) scale(1.02);
  }
}

@keyframes dash-tab-breathe {
  0%,
  100% {
    transform: scale(1) rotate(0deg);
  }
  50% {
    transform: scale(1.015) rotate(-0.3deg);
  }
}

/* ── 响应式：窄屏隐藏侧边栏 ── */
@media (max-width: 768px) {
  .dash-sidebar {
    position: fixed;
    left: -100%;
    top: 0;
    bottom: 0;
    z-index: 100;
    transition: left 0.3s;
  }
  .dash-sidebar.dash-sidebar-open {
    left: 0;
  }
}
</style>
