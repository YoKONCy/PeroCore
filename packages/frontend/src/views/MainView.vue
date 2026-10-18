<script setup lang="ts">
/**
 * MainView — AIOS 综合面板
 *
 * 统一 Chat/Dashboard/Stronghold 等所有功能到单一 View。
 * 布局: 应用标签栏(仅Electron) + 固定综合面板首页 + 浏览器和子应用视图。
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
import { getTabLoader, warmTabsWhenIdle } from '../composables/main/tabRegistry'
import { startFrontendPerformanceObserver } from '../compositor/performanceBaseline'
import { useWindowVisibility } from '../composables/main/useWindowVisibility'
import { useSensoryPreferences } from '../composables/ui/useSensoryPreferences'
import MainTabLoading from '../components/main/MainTabLoading.vue'
import SurfaceTransition from '../components/motion/SurfaceTransition.vue'
import { PixelIcon, PDialog } from '../components/pixel'
import DesktopTabBar from '../components/layout/DesktopTabBar.vue'
import AppWallpaper from '../components/layout/AppWallpaper.vue'
import DesktopNewTab from '../components/layout/DesktopNewTab.vue'
import DesktopBrowserToolbar from '../components/layout/DesktopBrowserToolbar.vue'
import ApplicationLoading from '../components/layout/ApplicationLoading.vue'
import { createApplicationWaitingPage } from '@infos/shared'
import { useDesktopTabs } from '../composables/main/useDesktopTabs'
import { useDesktopToasts } from '../composables/main/useDesktopToasts'
import { resolveArcaUiUrl } from '../applications/openArcaSurface'
import { resolvePictoriaUiUrl } from '../applications/openPictoriaSurface'
import MainNav from '../components/main/MainNav.vue'
import UpdateCenterDialog from '../components/main/UpdateCenterDialog.vue'
import { TaskToastContainer } from '../components/taskCenter'
import { createDashboardContext, DASHBOARD_CTX_KEY, useGateway } from '../composables/dashboard'
import { useMainNav } from '../composables/main/useMainNav'
import { useConversationNavigation } from '../composables/chat/useConversationNavigation'
import { useTaskNavigation } from '../composables/main/useTaskNavigation'
import { useRemoteNotifications } from '../composables/main/useRemoteNotifications'
import { useAppBackground } from '../composables/ui/useAppBackground'
import {
  useNotificationStore,
  useAgentStore,
  useApprovalStore,
  useThreadStore,
  usePetStateStore,
  useCompositorStore,
} from '../stores'
import { useTaskCenterStore } from '../stores/taskCenterStore'
import { isElectron } from '../utils/ipcAdapter'
import type { ApprovalRequest } from '../api/modules/approvalsApi'
import { agentInputsApi } from '../api/modules/agentInputsApi'
import { clearAgentInputDraft } from '../components/agent/agentInputDraft'
import { logger } from '../lib/logger'
import ResourcePreviewDialog from '../components/resources/ResourcePreviewDialog.vue'
import { resourceNavigation } from '../composables/resources/useResources'
import { invoke } from '../utils/ipcAdapter'

defineOptions({ name: 'MainView' })
const TarotTab = defineAsyncComponent(() => import('../components/tarot/TarotTab.vue'))

/** 编译时注入的版本号 */
const appVersion = __APP_VERSION__
const showUpdateCenter = ref(false)
const openingWebArca = ref(false)
const openingWebPictoria = ref(false)
function showWebAppWaiting(page: Window, applicationName: string): void {
  page.document.open()
  page.document.write(
    createApplicationWaitingPage({
      dark: theme.value === 'dark',
      applicationName,
      motion: motionLevel.value,
    }),
  )
  page.document.close()
}
async function openWebPictoria(): Promise<void> {
  if (openingWebPictoria.value) return
  const page = window.open('about:blank', '_blank')
  if (!page) {
    notifyStore.toast('请允许打开 Pictoria 画布', 'error')
    return
  }
  page.opener = null
  openingWebPictoria.value = true
  try {
    showWebAppWaiting(page, 'Pictoria')
    const url = await resolvePictoriaUiUrl(agentStore.activeAgentId)
    if (!page.closed) page.location.replace(url)
  } catch (error) {
    page.close()
    notifyStore.toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    openingWebPictoria.value = false
  }
}
async function openWebArca(): Promise<void> {
  if (openingWebArca.value) return
  const page = window.open('about:blank', '_blank')
  if (!page) {
    notifyStore.toast('请允许打开 Arca 应用页面', 'error')
    return
  }
  page.opener = null
  openingWebArca.value = true
  try {
    showWebAppWaiting(page, 'Arca')
    const url = await resolveArcaUiUrl()
    if (!page.closed) page.location.replace(url)
  } catch (error) {
    page.close()
    notifyStore.toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    openingWebArca.value = false
  }
}
const desktopShell = useDesktopTabs()
const {
  enabled: desktopEnabled,
  state: desktopState,
  activeTab: desktopActiveTab,
  isHome: desktopIsHome,
  nativeMount: desktopNativeMount,
  opening: desktopOpening,
  openingApplication: desktopOpeningApplication,
  addressFocus: desktopAddressFocus,
  queries: desktopQueries,
} = desktopShell
const desktopLoadingTitle = computed(() => {
  const preparing = desktopOpeningApplication.value
  const active = desktopActiveTab.value
  if (preparing && (active.kind === 'new' || active.appId === preparing.id)) return preparing.title
  return active.kind === 'application' && active.loading && !active.error ? active.title : ''
})
const windowVisible = useWindowVisibility()
const mainSurfaceVisible = computed(() => desktopIsHome.value && windowVisible.value)
provide('infos:main-surface-visible', mainSurfaceVisible)
const compositorStore = useCompositorStore()
const { motionLevel } = useSensoryPreferences()
watch(
  motionLevel,
  (level) => {
    if (isElectron()) void invoke('desktop-tabs:set-motion', level).catch(() => {})
  },
  { immediate: true },
)
watch(mainSurfaceVisible, (active) => compositorStore.setPresentationActive(active), {
  immediate: true,
})

// ── Tab 组件异步加载 ──

/**
 * 所有 Tab 共用稳定的加载占位。
 *
 * 首次加载由外层过渡承接；配合 KeepAlive，已访问的 Tab
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
    'prompts',
    'voice_config',
    'mcp_config',
    'distributed',
    'social',
    'terminal',
    'system_reset',
  ].map((id) => [id, createTabComponent(id)]),
)

/** 不属于 Dashboard 主题作用域的独立页面。 */
const STANDALONE_TABS = new Set(['chat', 'workspace', 'stronghold'])
/** 仅高成本重建且需要保持交互现场的页面进入缓存。 */
const CACHED_TABS = new Set(['chat', 'workspace', 'stronghold', 'social'])
const cachedTabNames = ['ChatTab', 'WorkspaceTab', 'StrongholdTab', 'SocialTab']

/** 当前页面是否使用 Dashboard 主题套件。 */
const isDashboardTab = computed(() => !STANDALONE_TABS.has(currentTab.value))

/** 需要全屏 overflow:hidden 的 Tab */
const FULL_HEIGHT_TABS = new Set(['chat', 'workspace', 'logs', 'terminal', 'social', 'stronghold'])

// ── 导航状态 ──

const { currentTab, pendingTab, tabDirection, currentAmbient, theme, toggleTheme, setTab } =
  useMainNav()
useDesktopToasts(theme)
const conversationNavigation = useConversationNavigation()
const taskNavigation = useTaskNavigation()
watch(
  () => desktopState.value.homeNavigation?.revision,
  () => {
    const navigation = desktopState.value.homeNavigation
    if (navigation?.conversation && !navigation.conversation.taskId)
      conversationNavigation.value = {
        target: navigation.conversation,
        revision: navigation.revision,
      }
    taskNavigation.value =
      navigation?.section === 'tasks' && navigation.conversation?.taskId
        ? { taskId: navigation.conversation.taskId, revision: navigation.revision }
        : null
    if (navigation?.section) void setTab(navigation.section)
  },
  { immediate: true },
)
async function openHomeSection(id: string): Promise<void> {
  await desktopShell.activate('home')
  await setTab(id)
}
const appBackground = useAppBackground()
const backgroundReadyUrl = ref('')
const backgroundEnabled = computed(
  () => appBackground.settings.value.enabled && appBackground.hasImage.value,
)
const showsAppBackground = computed(
  () => backgroundEnabled.value && backgroundReadyUrl.value === appBackground.imageUrl.value,
)
provide('infos:app-background-active', showsAppBackground)
watch(
  [appBackground.imageUrl, backgroundEnabled],
  () => {
    backgroundReadyUrl.value = ''
  },
  { flush: 'sync' },
)
function handleBackgroundReady(src: string): void {
  if (src === appBackground.imageUrl.value) backgroundReadyUrl.value = src
}
function handleBackgroundError(src: string): void {
  if (src !== appBackground.imageUrl.value) return
  backgroundReadyUrl.value = ''
  logger.warn('MainView', '应用背景图片加载失败，保留默认页面材质')
}

/** 当前激活 Tab 组件 */
const activeTabComponent = computed(() => tabComponents[currentTab.value] ?? null)

/** 当前 Tab 是否需要全屏高度 */
const isFullHeightTab = computed(() => FULL_HEIGHT_TABS.has(currentTab.value))

/** 是否显示环境光(仅总览页) */
const showAmbient = computed(() => currentTab.value === 'overview' && !showsAppBackground.value)

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

const gateway = useGateway()
const { onPush, offPush, subscribe, selectPrincipal, sessionId: gatewaySessionId } = gateway
useRemoteNotifications(gateway)
const notifyStore = useNotificationStore()
const agentStore = useAgentStore()
const petStateStore = usePetStateStore()
const threadStore = useThreadStore()
const approvalStore = useApprovalStore()
watch(resourceNavigation, async (request) => {
  if (!request) return
  const origin = request.origin
  try {
    if (origin.type === 'workspace') {
      if (!origin.agentId) throw new Error('文件缺少所属角色')
      await agentStore.switchAgent(origin.agentId)
      await openHomeSection('workspace')
    } else if (origin.type === 'arca') {
      const url = new URL(await resolveArcaUiUrl(true))
      url.hash = `/document/${encodeURIComponent(origin.value)}`
      if (desktopEnabled)
        await invoke('desktop-tabs:open-application', {
          appId: 'infos.arca',
          url: url.href,
          navigateExisting: true,
        })
      else window.open(url.href, '_blank', 'noopener,noreferrer')
    } else if (/^https?:\/\//i.test(origin.value)) {
      if (desktopEnabled) await desktopShell.openBrowser(origin.value)
      else window.open(origin.value, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    notifyStore.toast(error instanceof Error ? error.message : '无法打开资源', { type: 'error' })
  }
})
let lastSynchronizedAgentId = ''
watch(
  [gatewaySessionId, () => agentStore.activeAgentId],
  ([, agentId]) => {
    if (agentId) void selectPrincipal(agentId, document.hasFocus()).catch(() => {})
  },
  { immediate: true },
)

watch(
  [() => agentStore.activeAgentId, () => agentStore.isLoading],
  ([agentId, loading]) => {
    ctx.activeAgentId.value = agentId
    // 首次列表加载完成后才恢复会话，不能把暂存的默认角色当作最终选择。
    if (loading || !agentStore.currentAgent) return
    if (agentId && agentId !== lastSynchronizedAgentId) {
      lastSynchronizedAgentId = agentId
      void subscribe(`approval:${agentId}`)
      void subscribe(`agent-input:${agentId}`)
      void subscribe(`notification:${agentId}`)
      if (conversationNavigation.value?.target.agentId !== agentId)
        void threadStore.loadLatestThread(agentId, 'desktop')
    }
  },
  { immediate: true },
)

// 主界面始终同步各角色状态，头像浮层不依赖总览页是否打开。
function handleCharacterStateUpdate(payload: Record<string, unknown>): void {
  petStateStore.applyPush(payload)
  triggerRefresh()
}
onPush('state_update', handleCharacterStateUpdate)
watch(
  [() => threadStore.agentId, () => threadStore.threadId],
  ([agentId, threadId]) => {
    if (agentId) petStateStore.selectThread(agentId, threadId)
  },
  { immediate: true },
)

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
const handleAgentInputResolved = (payload: Record<string, unknown>) => {
  const request = payload.request as { id?: string } | undefined
  if (request?.id) clearAgentInputDraft(request.id)
  handleAgentInputRequested(payload)
}
let agentInputPollTimer: ReturnType<typeof setInterval> | null = null
let agentInputPollBusy = false
async function refreshPendingAgentInputs(): Promise<void> {
  if (!mainSurfaceVisible.value || agentInputPollBusy) return
  const threadId = threadStore.threadId
  const agentId = agentStore.activeAgentId
  if (!threadId || !agentId) return
  agentInputPollBusy = true
  try {
    const response = await agentInputsApi.list({ status: 'pending', threadId, agentId })
    if ((response.data?.total ?? 0) > 0 && threadStore.threadId === threadId) {
      await threadStore.refreshCurrentThread(agentId)
    }
  } catch {
    // Gateway是主链路，轮询只在断线或漏事件时静默兜底。
  } finally {
    agentInputPollBusy = false
  }
}
watch(
  mainSurfaceVisible,
  (visible) => {
    if (agentInputPollTimer) clearInterval(agentInputPollTimer)
    agentInputPollTimer = null
    if (visible) {
      void refreshPendingAgentInputs()
      agentInputPollTimer = setInterval(() => void refreshPendingAgentInputs(), 4_000)
    }
  },
  { immediate: true },
)
onPush('tool_approval_requested', handleApprovalRequested)
onPush('tool_approval_resolved', handleApprovalResolved)
onPush('agent_input_requested', handleAgentInputRequested)
onPush('agent_input_resolved', handleAgentInputResolved)

onUnmounted(() => {
  approvalStore.stopPolling()
  if (agentInputPollTimer) clearInterval(agentInputPollTimer)
  offPush('tool_approval_requested', handleApprovalRequested)
  offPush('state_update', handleCharacterStateUpdate)
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

let stopWarmup: (() => void) | undefined
let stopPerformance: (() => void) | undefined
onUnmounted(() => {
  stopWarmup?.()
  stopPerformance?.()
})
onMounted(() => {
  stopPerformance = startFrontendPerformanceObserver()
  stopWarmup = warmTabsWhenIdle(
    ['workspace', 'stronghold'],
    () =>
      mainSurfaceVisible.value &&
      !agentStore.isLoading &&
      !threadStore.isLoadingHistory &&
      !threadStore.isGenerating,
  )
  initParticles()
  void appBackground.load().catch((error) => logger.warn('MainView', '应用背景配置加载失败', error))

  // 审批属于全局安全基础设施，与当前激活 Tab 无关。
  approvalStore.startPolling()
})
</script>

<template>
  <div
    class="main-view-root"
    :class="{ 'main-view-root--hidden': !windowVisible }"
    :data-app-background="showsAppBackground ? 'active' : undefined"
    :style="appBackground.style.value"
  >
    <AppWallpaper
      v-if="backgroundEnabled"
      :src="appBackground.imageUrl.value"
      @ready="handleBackgroundReady"
      @error="handleBackgroundError"
    />
    <DesktopTabBar
      v-if="desktopEnabled"
      :tabs="desktopState.tabs"
      :active-tab-id="desktopState.activeTabId"
      :theme="theme"
      @activate="desktopShell.activate"
      @close="desktopShell.close"
      @create="desktopShell.create"
      @theme="toggleTheme"
      @update="showUpdateCenter = true"
    />

    <!-- 首页持续挂载，切换到子应用不会中断聊天与后台事件。 -->
    <div
      v-show="desktopIsHome"
      id="desktop-home-panel"
      class="main-home-surface"
      :class="{ 'main-home-surface--inactive': !mainSurfaceVisible }"
      role="tabpanel"
      :aria-labelledby="desktopEnabled ? 'desktop-tab-home' : undefined"
    >
      <div class="main-view-body">
        <!-- 左侧导航 -->
        <MainNav :show-theme-toggle="!desktopEnabled" />

        <!-- 右侧内容区 -->
        <main
          class="main-content"
          :class="{
            'main-content--full': isFullHeightTab,
          }"
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
          <SurfaceTransition
            class="main-tab-motion"
            :fill="isFullHeightTab"
            :identity="currentTab"
            :pending="!!pendingTab"
            :direction="tabDirection"
            label="正在切换页面"
          >
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
          </SurfaceTransition>
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
          <span class="main-status-text">{{ agentStore.currentAgent?.name || '助手' }}</span>
        </div>

        <div class="main-statusbar-right">
          <button
            v-if="!desktopEnabled"
            class="main-statusbar-btn"
            :disabled="openingWebPictoria"
            title="打开 Pictoria 画布"
            aria-label="打开 Pictoria 画布"
            @click="openWebPictoria"
          >
            <PixelIcon name="image" size="xs" />
          </button>
          <button
            v-if="!desktopEnabled"
            class="main-statusbar-btn"
            :disabled="openingWebArca"
            title="打开 Arca 应用"
            aria-label="打开 Arca 应用"
            @click="openWebArca"
          >
            <PixelIcon name="book" size="xs" />
          </button>
          <button
            class="main-statusbar-btn"
            :disabled="isRefreshing"
            title="刷新"
            @click="handleRefresh"
          >
            <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
          </button>
          <span class="main-status-version font-pixel">v{{ appVersion }}</span>
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
    </div>

    <section
      v-if="desktopEnabled && !desktopIsHome && desktopActiveTab.kind !== 'tarot'"
      id="desktop-app-panel"
      class="desktop-app-surface"
      role="tabpanel"
      :aria-labelledby="`desktop-tab-${desktopActiveTab.id}`"
    >
      <!-- 启动与页面加载共用同一实例，跨阶段切换不会重新播放动画。 -->
      <ApplicationLoading
        v-if="desktopLoadingTitle"
        :application-name="desktopLoadingTitle"
        :dark="theme === 'dark'"
        :motion="motionLevel"
      />
      <SurfaceTransition
        v-if="desktopActiveTab.kind === 'new'"
        independent
        fill
        :identity="desktopActiveTab.id"
        :pending="desktopOpening && !desktopOpeningApplication"
        label="正在打开"
      >
        <DesktopNewTab
          v-if="desktopActiveTab.kind === 'new'"
          :key="desktopActiveTab.id"
          v-model="desktopQueries[desktopActiveTab.id]"
          :applications="desktopState.applications"
          :busy="desktopOpening"
          :focus-request="desktopAddressFocus"
          @browse="desktopShell.openBrowser($event, desktopActiveTab.id)"
          @application="desktopShell.openApplication($event, desktopActiveTab.id)"
          @section="openHomeSection"
        />
      </SurfaceTransition>
      <template v-else>
        <DesktopBrowserToolbar
          v-if="desktopActiveTab.kind === 'browser'"
          :tab="desktopActiveTab"
          :focus-request="desktopAddressFocus"
          @navigate="desktopShell.navigate"
          @action="desktopShell.browserAction"
        />
        <div ref="desktopNativeMount" class="desktop-native-mount">
          <SurfaceTransition
            independent
            fill
            :identity="desktopActiveTab.id"
            :pending="
              desktopActiveTab.kind === 'browser' &&
              !!desktopActiveTab.loading &&
              !desktopActiveTab.error
            "
            :label="`正在打开 ${desktopActiveTab.title}`"
          >
            <div v-if="desktopActiveTab.error" class="desktop-surface-feedback" role="alert">
              <PixelIcon name="alert" size="lg" />
              <strong>这个页面暂时无法打开</strong>
              <p>{{ desktopActiveTab.error }}</p>
              <button
                v-if="desktopActiveTab.kind === 'browser'"
                type="button"
                @click="desktopShell.browserAction('reload')"
              >
                重新加载
              </button>
              <button
                v-else-if="desktopActiveTab.appId"
                type="button"
                @click="desktopShell.openApplication(desktopActiveTab.appId)"
              >
                重新打开
              </button>
              <button v-else type="button" @click="desktopShell.close(desktopActiveTab.id)">
                关闭标签页
              </button>
            </div>
          </SurfaceTransition>
        </div>
      </template>
    </section>

    <SurfaceTransition
      v-if="desktopEnabled && desktopState.tabs.some((tab) => tab.kind === 'tarot')"
      v-show="desktopActiveTab.kind === 'tarot'"
      id="desktop-tarot-panel"
      independent
      fill
      identity="tarot"
      :active="desktopActiveTab.kind === 'tarot'"
      role="tabpanel"
      :aria-labelledby="`desktop-tab-${desktopState.tabs.find((tab) => tab.kind === 'tarot')?.id}`"
    >
      <TarotTab :active="desktopActiveTab.kind === 'tarot'" />
    </SurfaceTransition>

    <UpdateCenterDialog
      v-if="isElectron()"
      v-model="showUpdateCenter"
      :current-version="appVersion"
    />

    <!-- M05-B4: 任务中心专属 Toast 容器（右下角，独立于通用通知体系） -->
    <TaskToastContainer />
    <ResourcePreviewDialog />

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
.main-view-root--hidden :deep(*),
.main-home-surface--inactive :deep(*) {
  animation-play-state: paused !important;
}

/* 只动画透明度与短距离位移，不使用大面积模糊或重建缓存页面。 */
.main-tab-motion {
  z-index: 1;
  min-height: 100%;
}

/* ── 根容器 ── */
.main-view-root {
  position: relative;
  isolation: isolate;
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
  min-height: 0;
}

.main-home-surface,
.desktop-app-surface {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.desktop-native-mount {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--ui-bg-canvas);
}
.desktop-surface-feedback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  color: var(--ui-text-secondary);
  text-align: center;
}
.desktop-surface-feedback strong {
  color: var(--ui-text-primary);
  font-size: 15px;
}
.desktop-surface-feedback p {
  max-width: 600px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.desktop-surface-feedback button {
  padding: 8px 15px;
  border: 1px solid var(--ui-border-default);
  border-radius: 8px;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  cursor: pointer;
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
