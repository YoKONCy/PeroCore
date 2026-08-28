<script setup lang="ts">
/**
 * MainView — AIOS 综合面板
 *
 * 统一 Chat/Dashboard/Stronghold 等所有功能到单一 View。
 * 布局: CustomTitleBar(仅Electron) + 左侧导航 + 右侧内容区 + 底部状态栏。
 *
 * 设计规范: .docs/S06_UI_UX_DESIGN_SPEC.md
 * - Arc 式空间层级 + 像素萌系品牌资产
 * - 三层导航分组: 日常(平铺) / 设置(可折叠) / 高级(可折叠)
 * - 对话 Tab 自动收起导航,其他 Tab 自动展开
 * - 环境光仅在总览页显示
 *
 * @module packages/frontend/src/views/MainView
 */
import {
  ref,
  provide,
  defineAsyncComponent,
  computed,
  onMounted,
  onUnmounted,
  watch,
  type Component,
} from 'vue'
import { getTabLoader } from '../composables/main/tabRegistry'
import { applicationSurfaceRegistry } from '../applications'
import MainTabLoading from '../components/main/MainTabLoading.vue'
import { PixelIcon, PDialog } from '../components/pixel'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import MainNav from '../components/main/MainNav.vue'
import UpdateCenterDialog from '../components/main/UpdateCenterDialog.vue'
import { TaskToastContainer } from '../components/taskCenter'
import { createDashboardContext, DASHBOARD_CTX_KEY, useGateway } from '../composables/dashboard'
import { useMainNav } from '../composables/main/useMainNav'
import { useChatBackground } from '../composables/ui/useChatBackground'
import { useNotificationStore, useAgentStore, useApprovalStore, useThreadStore } from '../stores'
import { useTaskCenterStore } from '../stores/taskCenterStore'
import { isElectron } from '../utils/ipcAdapter'
import type { ApprovalRequest } from '../api/modules/approvalsApi'
import { agentInputsApi } from '../api/modules/agentInputsApi'
import { logger } from '../lib/logger'

defineOptions({ name: 'MainView' })

/** 编译时注入的版本号 */
const appVersion = __APP_VERSION__
const showUpdateCenter = ref(false)

// ── Tab 组件异步加载 ──

/**
 * 所有 Tab 共用稳定的加载占位。
 *
 * delay 为 0，确保首次按需加载时立即显示占位；配合 KeepAlive，已访问的 Tab
 * 不会再次卸载/请求，避免快速切换时出现空白内容区与重复初始化。
 */
const createTabComponent = (id: string): Component => {
  const loader = getTabLoader(id)
  if (!loader) throw new Error(`未注册 Tab: ${id}`)
  return defineAsyncComponent({
    loader,
    loadingComponent: MainTabLoading,
    delay: 80,
    timeout: 30_000,
    suspensible: false,
  })
}

const tabComponents: Record<string, Component> = Object.fromEntries(
  [
    'chat',
    'workspace',
    'overview',
    'logs',
    'memories',
    'knowledge',
    'tasks',
    'stronghold',
    'agent_config',
    'user_settings',
    'model_config',
    'voice_config',
    'mcp_config',
    'distributed',
    'social',
    'arca',
    'terminal',
    'system_reset',
  ].map((id) => [id, createTabComponent(id)]),
)

const applicationTabIds = applicationSurfaceRegistry
  .list('main.tab')
  .map((surface) =>
    surface.appId === 'infos.arca' ? 'arca' : `${surface.appId}:${surface.declaration.surfaceId}`,
  )
const applicationComponentNames = applicationTabIds.map((id) =>
  id === 'arca' ? 'ArcaTab' : `ApplicationSurface:${id}`,
)

/** 不属于 Dashboard 主题作用域的独立页面。 */
const STANDALONE_TABS = new Set(['chat', 'workspace', 'stronghold'])
/** 仅高成本重建且需要保持交互现场的页面进入缓存。 */
const CACHED_TABS = new Set(['chat', 'workspace', 'stronghold', 'social', ...applicationTabIds])
const cachedTabNames = [
  'ChatTab',
  'WorkspaceTab',
  'StrongholdTab',
  'SocialTab',
  ...applicationComponentNames,
]

/** 当前页面是否使用 Dashboard 主题套件。 */
const isDashboardTab = computed(() => !STANDALONE_TABS.has(currentTab.value))

/** 需要全屏 overflow:hidden 的 Tab */
const FULL_HEIGHT_TABS = new Set([
  'chat',
  'workspace',
  'logs',
  'terminal',
  'social',
  ...applicationTabIds,
  'stronghold',
])

// ── 导航状态 ──

const { currentTab, currentAmbient } = useMainNav()
const chatBackground = useChatBackground()
const showsChatBackground = computed(
  () =>
    STANDALONE_TABS.has(currentTab.value) &&
    chatBackground.settings.value.enabled &&
    chatBackground.hasImage.value,
)
const chatBackgroundStyle = computed(() => {
  const value = chatBackground.settings.value
  return {
    '--chat-background-image': `url("${chatBackground.imageUrl.value}")`,
    '--chat-background-enabled': '1',
    '--chat-background-opacity': String(value.opacity),
    '--chat-background-blur': `${value.blur}px`,
    '--chat-background-brightness': String(value.brightness),
    '--chat-background-saturation': String(value.saturation),
    '--chat-background-contrast': String(value.contrast),
    '--chat-background-overlay': String(value.overlayOpacity),
    '--chat-surface-opacity': String(value.surfaceOpacity),
    '--chat-surface-soft-opacity': String(value.surfaceOpacity * 0.72),
    '--chat-surface-content-opacity': String(value.surfaceOpacity * 0.2),
    '--chat-surface-blur': `${value.surfaceBlur}px`,
    '--chat-background-position': `${value.positionX}% ${value.positionY}%`,
    '--chat-background-fit': value.fit,
  }
})

/** 当前激活 Tab 组件 */
const activeTabComponent = computed(() => tabComponents[currentTab.value] ?? null)

/** 当前 Tab 是否需要全屏高度 */
const isFullHeightTab = computed(() => FULL_HEIGHT_TABS.has(currentTab.value))

/** 是否显示环境光(仅总览页) */
const showAmbient = computed(() => currentTab.value === 'overview')

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

// ── Gateway WebSocket 接入 ──

const { onPush, offPush, subscribe } = useGateway()
const notifyStore = useNotificationStore()
const agentStore = useAgentStore()
const threadStore = useThreadStore()
const approvalStore = useApprovalStore()
let lastSynchronizedAgentId = ''

watch(
  () => agentStore.activeAgentId,
  (agentId) => {
    ctx.activeAgentId.value = agentId
    if (agentId) {
      void subscribe(`approval:${agentId}`)
      void subscribe(`agent-input:${agentId}`)
      void subscribe(`notification:${agentId}`)
    }
    if (agentId && agentId !== lastSynchronizedAgentId) {
      lastSynchronizedAgentId = agentId
      void threadStore.loadLatestThread(agentId, 'desktop')
    }
  },
  { immediate: true },
)

// 监听通知推送
onPush('notification', (payload) => {
  logger.info('MainView', '收到通知', { title: payload.title, body: payload.body })
  const body = (payload.body as string) || (payload.title as string) || '系统通知'
  const level = (payload.level as 'info' | 'success' | 'warning' | 'error') || 'info'
  notifyStore.toastRemote(String(payload.notificationId ?? ''), body, {
    type: level,
    duration: Number(payload.duration ?? 4000),
  })
})
onPush('durable_notification', (payload) => {
  const body = (payload.body as string) || (payload.title as string) || '系统通知'
  const level = (payload.level as 'info' | 'success' | 'warning' | 'error') || 'info'
  notifyStore.toastRemote(String(payload.notificationId ?? ''), body, {
    type: level,
    duration: Number(payload.duration ?? 4000),
  })
})

// 监听状态更新 → 触发全局刷新
onPush('state_update', () => {
  triggerRefresh()
})

// 监听 Agent 切换
onPush('agent_changed', (payload) => {
  const newId = payload.agentId as string
  if (newId && newId !== agentStore.activeAgentId) {
    agentStore.switchAgent(newId).catch((err: unknown) => {
      logger.error('MainView', '同步后端角色切换失败', err)
    })
  }
})

// ── M05: 任务中心 Gateway 事件绑定 ──
// 后台任务事件只增量更新对应任务，不切换前台角色（M05 §6 约束）
const taskCenterStore = useTaskCenterStore()
taskCenterStore.bindGateway({ onPush, offPush })

// 初始拉取一次进行中任务（之后由 Gateway 事件增量维护）
void taskCenterStore.refreshActive()

// 审批事件优先走 Gateway 即时同步，4 秒轮询仅用于断线或漏事件兜底。
const handleApprovalRequested = (payload: Record<string, unknown>) => {
  const request = payload.request as ApprovalRequest | undefined
  if (request) approvalStore.receive(request)
}
const handleApprovalResolved = (payload: Record<string, unknown>) => {
  const request = payload.request as ApprovalRequest | undefined
  if (request) approvalStore.remove(request.id)
}
const handleAgentInputRequested = (payload: Record<string, unknown>) => {
  const request = payload.request as { threadId?: string; agentId?: string } | undefined
  if (
    request?.threadId &&
    request.threadId === threadStore.threadId &&
    request.agentId === agentStore.activeAgentId
  ) {
    void threadStore.refreshCurrentThread(request.agentId)
  }
}
const handleAgentInputResolved = handleAgentInputRequested
let agentInputPollTimer: ReturnType<typeof setInterval> | null = null
async function refreshPendingAgentInputs(): Promise<void> {
  const threadId = threadStore.threadId
  const agentId = agentStore.activeAgentId
  if (!threadId || !agentId) return
  try {
    const response = await agentInputsApi.list({ status: 'pending', threadId, agentId })
    if ((response.data?.total ?? 0) > 0 && threadStore.threadId === threadId) {
      await threadStore.refreshCurrentThread(agentId)
    }
  } catch {
    // Gateway是主链路，轮询只在断线或漏事件时静默兜底。
  }
}
onPush('tool_approval_requested', handleApprovalRequested)
onPush('tool_approval_resolved', handleApprovalResolved)
onPush('agent_input_requested', handleAgentInputRequested)
onPush('agent_input_resolved', handleAgentInputResolved)

onUnmounted(() => {
  approvalStore.stopPolling()
  if (agentInputPollTimer) clearInterval(agentInputPollTimer)
  offPush('tool_approval_requested', handleApprovalRequested)
  offPush('tool_approval_resolved', handleApprovalResolved)
  offPush('agent_input_requested', handleAgentInputRequested)
  offPush('agent_input_resolved', handleAgentInputResolved)
})

// ── 环境光样式 ──

const ambientStyle = computed(() => {
  if (!showAmbient.value || !currentAmbient.value) return {}
  const c = currentAmbient.value
  return {
    background: `radial-gradient(circle at 20% 30%, ${c.primary} 0%, transparent 70%),
                 radial-gradient(circle at 80% 70%, ${c.secondary} 0%, transparent 70%)`,
    filter: 'blur(100px)',
    opacity: '0.6',
  }
})

// ── 粒子动画(仅总览页) ──

interface ParticleItem {
  id: number
  icon: string
  size: 'xs' | 'sm'
  style: Record<string, string>
}

const PARTICLE_ICONS = ['sparkle', 'heart', 'star', 'thought', 'chat', 'flash']
const particles = ref<ParticleItem[]>([])

function initParticles() {
  particles.value = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    icon: PARTICLE_ICONS[i % PARTICLE_ICONS.length] ?? 'sparkle',
    size: (i % 3 === 0 ? 'sm' : 'xs') as 'xs' | 'sm',
    style: {
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 5}s`,
      animationDuration: `${12 + Math.random() * 12}s`,
      willChange: 'transform, opacity',
    },
  }))
}

onMounted(() => {
  initParticles()
  void chatBackground
    .load()
    .catch((error) => logger.warn('MainView', '聊天背景配置加载失败', error))

  // 审批属于全局安全基础设施，与当前激活 Tab 无关。
  approvalStore.startPolling()
  void refreshPendingAgentInputs()
  agentInputPollTimer = setInterval(() => void refreshPendingAgentInputs(), 4_000)
})
</script>

<template>
  <div class="main-view-root">
    <!-- Electron 自定义标题栏 -->
    <CustomTitleBar v-if="isElectron()" title="PeroperoChat" />

    <div class="main-view-body" :class="{ 'pt-8': isElectron() }">
      <!-- 左侧导航 -->
      <MainNav />

      <!-- 右侧内容区 -->
      <main
        class="main-content"
        :class="{
          'main-content--full': isFullHeightTab,
        }"
        :style="showsChatBackground ? chatBackgroundStyle : undefined"
      >
        <!-- 环境光(仅总览页) -->
        <div v-if="showAmbient" class="main-ambient" :style="ambientStyle" />

        <!-- 粒子(仅总览页) -->
        <div v-if="showAmbient" class="main-particles">
          <PixelIcon
            v-for="p in particles"
            :key="p.id"
            :name="p.icon"
            :size="p.size"
            class="main-particle"
            :style="p.style"
          />
        </div>

        <!-- 模块已经在旧页面可见期间完成解析，目标页面可直接提交。 -->
        <!-- 高频交互页保留现场；其他页面切换后释放组件和大型图表。 -->
        <KeepAlive :include="cachedTabNames" :max="4">
          <component
            :is="activeTabComponent"
            v-if="activeTabComponent"
            :key="currentTab"
            :data-dashboard-scope="isDashboardTab ? '' : undefined"
            :class="[
              'main-tab-content',
              {
                'dashboard-tab-content': isDashboardTab,
                'main-tab-content--cached': CACHED_TABS.has(currentTab),
              },
            ]"
          />
        </KeepAlive>
      </main>
    </div>

    <!-- 底部状态栏 -->
    <footer class="main-statusbar">
      <div class="main-statusbar-left">
        <span
          class="main-status-dot"
          :class="isBackendOnline ? 'main-status-dot--online' : 'main-status-dot--offline'"
        />
        <span class="main-status-text">
          {{ isBackendOnline ? '在线' : '离线' }}
        </span>
        <span class="main-status-divider" />
        <span class="main-status-text">{{ ctx.activeAgentId.value || '助手' }}</span>
      </div>

      <div class="main-statusbar-right">
        <button
          class="main-statusbar-btn"
          :disabled="isRefreshing"
          title="刷新"
          @click="handleRefresh"
        >
          <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
        </button>
        <button
          v-if="isElectron()"
          class="main-status-version font-pixel"
          title="打开应用更新中心"
          @click="showUpdateCenter = true"
        >
          v{{ appVersion }}
        </button>
        <button
          v-if="isElectron()"
          class="main-statusbar-btn main-statusbar-btn--danger"
          title="退出"
          @click="handleQuitApp"
        >
          <PixelIcon name="power" size="xs" />
        </button>
      </div>
    </footer>

    <UpdateCenterDialog
      v-if="isElectron()"
      v-model="showUpdateCenter"
      :current-version="appVersion"
    />

    <!-- M05-B4: 任务中心专属 Toast 容器（右下角，独立于通用通知体系） -->
    <TaskToastContainer />

    <!-- 全局确认弹窗 -->
    <PDialog
      v-model="showConfirm"
      :title="confirmTitle"
      :message="confirmContent"
      :mode="confirmIsPrompt ? 'prompt' : 'confirm'"
      :confirm-variant="confirmType === 'error' ? 'danger' : 'primary'"
      :default-value="confirmPromptValue"
      :placeholder="confirmPromptPlaceholder"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
/* Tab 页面不执行整体过渡。大型图表和编辑器根节点动画会造成纹理上传和布局延迟。 */

/* ── 根容器 ── */
.main-view-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--ui-bg-canvas);
  color: var(--ui-text-primary);
  font-family: var(--ui-font-sans);
}

/* ── 主体区域(导航+内容) ── */
.main-view-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* ── 内容区 ── */
.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  background: var(--ui-bg-canvas);
}

/* 底板纹理：点阵网格 + 微渐变，极淡不喧宾夺主 */
.main-content::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: radial-gradient(
    circle at 50% 50%,
    var(--canvas-dot-color) var(--canvas-dot-size),
    transparent var(--canvas-dot-size)
  );
  background-size: var(--canvas-dot-spacing) var(--canvas-dot-spacing);
}

/* 底板微渐变：顶部向下微亮/暗，提供纵向 luminance 层次 */
.main-content::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: linear-gradient(to bottom, var(--canvas-grad-top), var(--canvas-grad-bottom) 18%);
}

.main-content--full {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 环境光 ── */
.main-ambient {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

/* ── 粒子 ── */
.main-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.main-particle {
  position: absolute;
  opacity: 0.12;
  animation: main-particle-float 15s ease-in-out infinite;
}

@keyframes main-particle-float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
    opacity: 0.12;
  }
  25% {
    transform: translateY(-8px) rotate(3deg);
    opacity: 0.2;
  }
  50% {
    transform: translateY(-4px) rotate(-2deg);
    opacity: 0.15;
  }
  75% {
    transform: translateY(-10px) rotate(4deg);
    opacity: 0.18;
  }
}

/* ── Tab 内容 ── */
.main-tab-content {
  position: relative;
  z-index: 1;
}

/* ── 状态栏 ── */
.main-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 16px;
  background: var(--ui-bg-sidebar);
  border-top: 1px solid var(--ui-border-subtle);
  flex-shrink: 0;
  font-size: 11px;
}

.main-statusbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.main-status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--ui-radius-full);
  flex-shrink: 0;
}

.main-status-dot--online {
  background: var(--ui-success);
  box-shadow: 0 0 6px rgba(5, 150, 105, 0.4);
  animation: status-pulse 2s ease-in-out infinite;
}

.main-status-dot--offline {
  background: var(--ui-danger);
}

@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.main-status-text {
  color: var(--ui-text-secondary);
  font-weight: 500;
}

.main-status-divider {
  width: 1px;
  height: 12px;
  background: var(--ui-border-default);
}

.main-statusbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.main-statusbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  border-radius: var(--ui-radius-xs);
  transition: all var(--ui-duration-fast);
}

.main-statusbar-btn:hover:not(:disabled) {
  background: var(--ui-bg-hover);
  color: var(--ui-text-secondary);
}

.main-statusbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.main-statusbar-btn--danger:hover:not(:disabled) {
  color: var(--ui-danger);
}

.main-status-version {
  padding: 3px 5px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary);
  letter-spacing: 0.05em;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--ui-duration-fast);
}

.main-status-version:hover {
  color: var(--ui-accent-sky);
  background: var(--ui-bg-hover);
  border-color: var(--ui-border-default);
}
</style>
