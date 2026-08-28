<script setup lang="ts">
/** Electron 客户端专属启动与维护中心。 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PixelIcon } from '../components/pixel'
import AsyncMarkdown from '../components/markdown/AsyncMarkdown.vue'
import { OnboardingOverlay } from '../components/overlays'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { useLauncher } from '../composables/launcher/useLauncher'
import { launcherSteps } from '../composables/launcher/onboardingScripts'
import { useAgentStore, useNotificationStore } from '../stores'
import { getApiBaseUrl } from '../api/transport'
import { invoke, listen } from '../utils/ipcAdapter'

interface ClientInfo {
  version: string
  edition: 'development' | 'portable' | 'steam' | 'release'
  isPackaged: boolean
  platform: string
  architecture: string
  osVersion: string
  osName: string
  hostname: string
  cpuModel: string
  cpuCores: number
  memoryUsed: number
  memoryTotal: number
  uptime: number
  electronVersion: string
  chromiumVersion: string
  nodeVersion: string
  dataPath: string
  logsPath: string
  appPath: string
  windows: { launcher: boolean; dashboard: boolean; pet: boolean }
  development: {
    available: boolean
    branch?: string
    commit?: string
    dirty?: boolean
    projectPath?: string
    updateCommand?: string
    error?: string
  }
}

interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  deployment?: 'installed' | 'portable' | 'unsupported'
  currentVersion: string
  latestVersion?: string
  selectedVersion?: string
  selectedTag?: string
  progress: number
  message: string
  checkedAt?: string
}

interface ReleaseNotice {
  tagName: string
  version?: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  prerelease: boolean
  cached?: boolean
}

const tabs = [
  { id: 'launch', code: '01', label: '启动', icon: 'power' },
  { id: 'environment', code: '02', label: '运行环境', icon: 'cpu' },
  { id: 'updates', code: '03', label: '版本公告', icon: 'download' },
  { id: 'about', code: '04', label: '关于', icon: 'info' },
] as const

type TabId = (typeof tabs)[number]['id']
const appVersion = __APP_VERSION__
const activeTab = ref<TabId>('launch')
const agentStore = useAgentStore()
const notification = useNotificationStore()
const clientInfo = ref<ClientInfo | null>(null)
const updateState = ref<UpdateState | null>(null)
const release = ref<ReleaseNotice | null>(null)
const loadingInfo = ref(false)
const loadingRelease = ref(false)
const switchingAgent = ref('')
let stopUpdateListener: (() => void) | null = null

const {
  phase,
  checks,
  startLaunch,
  enterApp,
  enteringText,
  showEula,
  acceptEula,
  declineEula,
  triggerEula,
  showOnboarding,
  finishOnboarding,
  triggerOnboarding,
} = useLauncher()

const editionName = computed(
  () =>
    ({
      development: '开发版',
      portable: '便携版',
      steam: 'Steam 版',
      release: '正式版',
    })[clientInfo.value?.edition ?? 'development'],
)

const checkFriendlyLabel: Record<string, string> = {
  backend: '后台服务',
  database: '数据存储',
  model: 'AI 模型',
  memory: '记忆系统',
  extension: '伙伴配置',
}

const healthyChecks = computed(() => checks.value.filter((item) => item.status === 'ok').length)
const totalChecks = computed(() => checks.value.length)
const environmentWarning = computed(() =>
  checks.value.some((item) => item.status === 'error' || item.status === 'warn'),
)
const hasUpdate = computed(
  () => updateState.value?.phase === 'available' || updateState.value?.phase === 'downloaded',
)

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDate(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '未知'
}

async function refreshClientInfo(): Promise<void> {
  loadingInfo.value = true
  try {
    clientInfo.value = (await invoke('get-client-info')) as ClientInfo
    updateState.value = (await invoke('get-update-state')) as UpdateState
  } catch (error) {
    notification.toast(
      `客户端环境检测失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  } finally {
    loadingInfo.value = false
  }
}

async function loadRelease(): Promise<void> {
  loadingRelease.value = true
  try {
    release.value = (await invoke('get-latest-release')) as ReleaseNotice
  } catch (error) {
    notification.toast(
      `版本公告获取失败：${error instanceof Error ? error.message : String(error)}`,
      'warning',
    )
  } finally {
    loadingRelease.value = false
  }
}

async function selectAgent(agentId: string): Promise<void> {
  if (switchingAgent.value || agentId === agentStore.activeAgentId) return
  switchingAgent.value = agentId
  try {
    await agentStore.switchAgent(agentId)
  } catch (error) {
    notification.toast(
      `切换角色失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  } finally {
    switchingAgent.value = ''
  }
}

async function enterDesktop(): Promise<void> {
  await enterApp()
  await refreshClientInfo()
}

async function openDashboard(): Promise<void> {
  await invoke('open-dashboard-window')
  await refreshClientInfo()
}

async function checkUpdate(): Promise<void> {
  updateState.value = (await invoke('check-client-update')) as UpdateState
}

async function downloadUpdate(): Promise<void> {
  updateState.value = (await invoke('download-client-update')) as UpdateState
}

async function installUpdate(): Promise<void> {
  await invoke('install-client-update')
}

async function copyUpdateCommand(): Promise<void> {
  const command = clientInfo.value?.development.updateCommand
  if (!command) return
  await navigator.clipboard.writeText(command)
  notification.toast('开发更新命令已复制', 'success')
}

function handleOnboardingStep(step: { tab?: string }): void {
  if (step.tab && tabs.some((tab) => tab.id === step.tab)) activeTab.value = step.tab as TabId
}

onMounted(async () => {
  await Promise.all([agentStore.fetchAgents(), refreshClientInfo(), startLaunch()])
  void loadRelease()
  stopUpdateListener = await listen('client-update-state', (payload) => {
    updateState.value = payload as UpdateState
  })
})

onUnmounted(() => stopUpdateListener?.())
</script>

<template>
  <div class="launcher-shell">
    <CustomTitleBar :transparent="true" />

    <OnboardingOverlay
      :visible="showOnboarding"
      :steps="launcherSteps"
      @finish="finishOnboarding"
      @step="handleOnboardingStep"
      @update:visible="
        (visible: boolean) => {
          if (!visible) finishOnboarding()
        }
      "
    />

    <header class="launcher-head">
      <div class="launcher-brand">
        <div class="brand-mark"><img src="/icon.png" alt="PeroperoChat" /></div>
        <div>
          <strong>PeroperoChat</strong>
          <span>启动器</span>
        </div>
      </div>
      <div class="global-signals">
        <span class="signal">
          <i :class="phase === 'ready' ? 'ok' : 'pending'" />
          {{ phase === 'ready' ? '服务在线' : '正在连接' }}
        </span>
        <span class="badge">{{ editionName }}</span>
        <span class="ver">v{{ clientInfo?.version ?? appVersion }}</span>
      </div>
    </header>

    <nav id="launcher-tabs" class="launcher-tabs" aria-label="启动器页面">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <span class="tab-code">{{ tab.code }}</span>
        <PixelIcon :name="tab.icon" size="sm" />
        <strong>{{ tab.label }}</strong>
        <i v-if="tab.id === 'environment' && environmentWarning" class="tab-signal warn" />
        <i v-if="tab.id === 'updates' && hasUpdate" class="tab-signal update" />
      </button>
    </nav>

    <main class="launcher-content">
      <!-- 启动 -->
      <section v-if="activeTab === 'launch'" class="page launch-page">
        <div class="page-head">
          <div>
            <span class="page-eyebrow">今天和谁一起</span>
            <h1>选择你的伙伴</h1>
            <p>选中的伙伴会出现在主界面和桌面，下次启动也会记住哦。</p>
          </div>
          <div class="check-score">
            <strong>{{ healthyChecks }}/{{ totalChecks }}</strong>
            <span>启动检查通过</span>
          </div>
        </div>

        <div id="launcher-agent-stage" class="agent-stage">
          <article class="active-agent-card">
            <div class="active-avatar">
              <img
                v-if="agentStore.currentAgent?.avatarUrl"
                :src="`${getApiBaseUrl()}${agentStore.currentAgent.avatarUrl}`"
                :alt="agentStore.currentAgent.name"
              />
              <span v-else>{{ agentStore.currentAgent?.name?.[0] ?? '?' }}</span>
            </div>
            <div class="active-copy">
              <small>当前伙伴</small>
              <h2>{{ agentStore.currentAgent?.name ?? '还没选伙伴' }}</h2>
              <p>
                {{
                  agentStore.currentAgent?.description ||
                  '点右侧选一个伙伴，它就会在桌面和主界面陪伴你。'
                }}
              </p>
              <div class="active-meta">
                <span>
                  <i class="ok" />
                  已连接到客户端
                </span>
                <span class="mono">{{ agentStore.activeAgentId }}</span>
              </div>
            </div>
          </article>

          <div class="agent-picker">
            <button
              v-for="agent in agentStore.agents"
              :key="agent.id"
              :class="{ active: agent.id === agentStore.activeAgentId }"
              :disabled="switchingAgent === agent.id"
              @click="selectAgent(agent.id)"
            >
              <span class="picker-avatar">
                <img
                  v-if="agent.avatarUrl"
                  :src="`${getApiBaseUrl()}${agent.avatarUrl}`"
                  :alt="agent.name"
                />
                <i v-else>{{ agent.name?.[0] ?? '?' }}</i>
              </span>
              <strong>{{ agent.name }}</strong>
              <small class="mono">{{ agent.id }}</small>
              <PixelIcon v-if="agent.id === agentStore.activeAgentId" name="check" size="xs" />
            </button>
          </div>
        </div>

        <div class="launch-bottom">
          <div id="launcher-readiness" class="check-list">
            <div v-for="item in checks" :key="item.id">
              <i :class="item.status" />
              <span>{{ checkFriendlyLabel[item.id] ?? item.label }}</span>
              <strong>{{ item.message ?? '等待检测' }}</strong>
            </div>
          </div>
          <div class="launch-actions">
            <button class="ghost-action" @click="openDashboard">
              <PixelIcon name="layout" size="sm" />
              打开主界面
            </button>
            <button
              id="launcher-primary-action"
              class="primary-action"
              :disabled="phase === 'entering'"
              @click="enterDesktop"
            >
              <PixelIcon name="power" size="md" />
              <span>
                <strong>{{ clientInfo?.windows.pet ? '显示伙伴' : '召唤伙伴' }}</strong>
                <small>{{ phase === 'entering' ? enteringText : '进入桌面陪伴模式' }}</small>
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- 运行环境 -->
      <section
        v-else-if="activeTab === 'environment'"
        id="launcher-environment-content"
        class="page"
      >
        <div class="page-head">
          <div>
            <span class="page-eyebrow">这台电脑的情况</span>
            <h1>运行环境</h1>
            <p>看看客户端的运行状态，出问题时也能更快定位。</p>
          </div>
          <button class="ghost-action" :disabled="loadingInfo" @click="refreshClientInfo">
            <PixelIcon name="refresh" size="xs" />
            重新检测
          </button>
        </div>

        <div class="diagnostic-grid">
          <article class="env-card">
            <header>
              <PixelIcon name="desktop" size="sm" />
              <div>
                <strong>客户端</strong>
                <span class="mono">APP</span>
              </div>
            </header>
            <dl>
              <div>
                <dt>版本</dt>
                <dd class="mono">{{ clientInfo?.version }}</dd>
              </div>
              <div>
                <dt>渠道</dt>
                <dd>{{ editionName }}</dd>
              </div>
              <div>
                <dt>形式</dt>
                <dd>{{ clientInfo?.isPackaged ? '安装包' : '源码运行' }}</dd>
              </div>
              <div>
                <dt>设备名</dt>
                <dd class="mono">{{ clientInfo?.hostname }}</dd>
              </div>
            </dl>
          </article>
          <article class="env-card">
            <header>
              <PixelIcon name="cpu" size="sm" />
              <div>
                <strong>电脑</strong>
                <span class="mono">SYSTEM</span>
              </div>
            </header>
            <dl>
              <div>
                <dt>系统</dt>
                <dd>{{ clientInfo?.osName }} {{ clientInfo?.osVersion }}</dd>
              </div>
              <div>
                <dt>架构</dt>
                <dd class="mono">{{ clientInfo?.architecture }}</dd>
              </div>
              <div>
                <dt>处理器</dt>
                <dd>{{ clientInfo?.cpuModel }}</dd>
              </div>
              <div>
                <dt>内存</dt>
                <dd class="mono">
                  {{ formatBytes(clientInfo?.memoryUsed ?? 0) }} /
                  {{ formatBytes(clientInfo?.memoryTotal ?? 0) }}
                </dd>
              </div>
            </dl>
          </article>
          <article class="env-card">
            <header>
              <PixelIcon name="code" size="sm" />
              <div>
                <strong>运行时</strong>
                <span class="mono">RUNTIME</span>
              </div>
            </header>
            <dl>
              <div>
                <dt>Electron</dt>
                <dd class="mono">{{ clientInfo?.electronVersion }}</dd>
              </div>
              <div>
                <dt>Chromium</dt>
                <dd class="mono">{{ clientInfo?.chromiumVersion }}</dd>
              </div>
              <div>
                <dt>Node.js</dt>
                <dd class="mono">{{ clientInfo?.nodeVersion }}</dd>
              </div>
              <div>
                <dt>后台服务</dt>
                <dd :class="phase === 'ready' ? 'ok-text' : 'warn-text'">
                  {{ phase === 'ready' ? '已连接' : '连接中' }}
                </dd>
              </div>
            </dl>
          </article>
          <article class="env-card">
            <header>
              <PixelIcon name="layout" size="sm" />
              <div>
                <strong>窗口</strong>
                <span class="mono">WINDOWS</span>
              </div>
            </header>
            <dl>
              <div>
                <dt>启动器</dt>
                <dd>已打开</dd>
              </div>
              <div>
                <dt>主界面</dt>
                <dd>{{ clientInfo?.windows.dashboard ? '已打开' : '未打开' }}</dd>
              </div>
              <div>
                <dt>桌宠</dt>
                <dd>{{ clientInfo?.windows.pet ? '已打开' : '未打开' }}</dd>
              </div>
              <div>
                <dt>桌面能力</dt>
                <dd>{{ phase === 'ready' ? '可用' : '等待服务' }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <!-- 版本公告 -->
      <section v-else-if="activeTab === 'updates'" class="page updates-page">
        <div class="page-head update-head">
          <div>
            <span class="page-eyebrow">新版本有什么变化</span>
            <h1>版本公告</h1>
            <p>先看看这次更新了什么，再决定要不要升级。</p>
          </div>
          <div class="release-identity">
            <span>{{ release?.tagName || 'LATEST' }}</span>
            <strong>{{ release ? formatDate(release.publishedAt) : '正在连接 GitHub…' }}</strong>
          </div>
        </div>

        <div class="release-workspace">
          <article id="launcher-release-notice" class="release-notice">
            <header class="release-notice__head">
              <div class="release-symbol"><PixelIcon name="sparkle" size="md" /></div>
              <div>
                <small>最新版本公告</small>
                <h2>{{ release?.name ?? '正在获取版本公告…' }}</h2>
                <p v-if="release">
                  发布于 {{ formatDate(release.publishedAt) }}
                  <em v-if="release.cached">离线缓存</em>
                </p>
              </div>
              <button :disabled="loadingRelease" title="刷新公告" @click="loadRelease">
                <PixelIcon name="refresh" size="xs" />
              </button>
            </header>
            <div class="release-notice__body">
              <AsyncMarkdown v-if="release?.body" :content="release.body" />
              <div v-else class="release-empty">
                <PixelIcon name="download" size="lg" />
                <span>正在读取 GitHub Release…</span>
              </div>
            </div>
            <footer v-if="release">
              <span>内容来自项目的 GitHub Release</span>
              <button @click="invoke('open-external-url', { url: release.htmlUrl })">
                在网页里看
                <PixelIcon name="external-link" size="xs" />
              </button>
            </footer>
          </article>

          <aside class="update-console">
            <header>
              <div>
                <span class="mono">CLIENT UPDATE</span>
                <strong>客户端更新</strong>
              </div>
              <b>{{ editionName }}</b>
            </header>
            <div class="version-stack">
              <div>
                <small>当前版本</small>
                <strong class="mono">v{{ clientInfo?.version }}</strong>
              </div>
              <PixelIcon name="arrow-right" size="sm" />
              <div>
                <small>最新版本</small>
                <strong class="mono">
                  {{
                    updateState?.selectedVersion || updateState?.latestVersion
                      ? `v${updateState.selectedVersion ?? updateState.latestVersion}`
                      : release?.tagName || '—'
                  }}
                </strong>
              </div>
            </div>
            <div class="update-state-line">
              <i :class="updateState?.phase" />
              <div>
                <strong>{{ updateState?.message ?? '正在读取更新状态' }}</strong>
                <span>当前是{{ editionName }}</span>
              </div>
            </div>
            <div v-if="updateState?.phase === 'downloading'" class="progress-track">
              <i :style="{ width: `${updateState.progress}%` }" />
              <span>{{ updateState.progress }}%</span>
            </div>

            <div v-if="clientInfo?.edition === 'development'" class="development-box">
              <header>
                <PixelIcon name="code" size="xs" />
                <strong>开发工作区</strong>
              </header>
              <dl>
                <div>
                  <dt>分支</dt>
                  <dd class="mono">{{ clientInfo.development.branch ?? '未知' }}</dd>
                </div>
                <div>
                  <dt>提交</dt>
                  <dd class="mono">{{ clientInfo.development.commit ?? '未知' }}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd :class="clientInfo.development.dirty ? 'warn-text' : 'ok-text'">
                    {{ clientInfo.development.dirty ? '有本地修改' : '工作区干净' }}
                  </dd>
                </div>
              </dl>
              <p>为了保护你的代码，启动器不会自动改仓库，只告诉你安全的手动更新方式。</p>
            </div>

            <div class="update-actions">
              <template v-if="clientInfo?.edition === 'development'">
                <button class="ghost-action" @click="invoke('open-client-path', 'app')">
                  打开目录
                </button>
                <button class="primary-small" @click="copyUpdateCommand">复制更新命令</button>
              </template>
              <template v-else-if="clientInfo?.edition === 'steam'">
                <button class="ghost-action" disabled>由 Steam 管理更新</button>
              </template>
              <template v-else>
                <button
                  class="ghost-action"
                  :disabled="updateState?.phase === 'checking'"
                  @click="checkUpdate"
                >
                  检查更新
                </button>
                <button
                  v-if="updateState?.phase === 'available'"
                  class="primary-small"
                  @click="downloadUpdate"
                >
                  下载更新
                </button>
                <button
                  v-if="updateState?.phase === 'downloaded'"
                  class="primary-small"
                  @click="installUpdate"
                >
                  安装并重启
                </button>
              </template>
            </div>
          </aside>
        </div>
      </section>

      <!-- 关于 -->
      <section v-else class="page about-page">
        <div class="page-head">
          <div>
            <span class="page-eyebrow">关于这个伙伴</span>
            <h1>关于客户端</h1>
            <p>项目入口、数据位置和客户端协议都在这里。</p>
          </div>
        </div>
        <div class="about-hero">
          <div class="about-logo"><img src="/icon.png" alt="萌动链接：PeroperoChat！" /></div>
          <div>
            <span class="mono">INFRASTRUCTURE · INFOMORPH · INFINITY</span>
            <h2>萌动链接：PeroperoChat！</h2>
            <p>Your Warm, and Infinite Companion</p>
          </div>
          <strong class="mono">v{{ clientInfo?.version ?? appVersion }}</strong>
        </div>
        <div class="about-grid">
          <button @click="invoke('open-external-url', { url: 'https://github.com/YoKONCy/infOS' })">
            <PixelIcon name="code" size="sm" />
            <span>
              <strong>项目主页</strong>
              <small>GitHub Repository</small>
            </span>
          </button>
          <button
            @click="invoke('open-external-url', { url: 'https://github.com/YoKONCy/infOS/issues' })"
          >
            <PixelIcon name="chat" size="sm" />
            <span>
              <strong>问题反馈</strong>
              <small>Issues & Feedback</small>
            </span>
          </button>
          <button @click="invoke('open-client-path', 'data')">
            <PixelIcon name="database" size="sm" />
            <span>
              <strong>数据目录</strong>
              <small class="mono">{{ clientInfo?.dataPath }}</small>
            </span>
          </button>
          <button @click="invoke('open-client-path', 'logs')">
            <PixelIcon name="file" size="sm" />
            <span>
              <strong>日志目录</strong>
              <small class="mono">{{ clientInfo?.logsPath }}</small>
            </span>
          </button>
          <button @click="triggerEula">
            <PixelIcon name="shield" size="sm" />
            <span>
              <strong>用户协议</strong>
              <small>重新查看 EULA</small>
            </span>
          </button>
          <button @click="triggerOnboarding">
            <PixelIcon name="book" size="sm" />
            <span>
              <strong>新手引导</strong>
              <small>重新看一遍引导</small>
            </span>
          </button>
        </div>
      </section>
    </main>

    <Teleport to="body">
      <div v-if="showEula" class="eula-mask">
        <div class="eula-dialog">
          <header class="eula-head">
            <div class="eula-icon"><PixelIcon name="shield" size="lg" /></div>
            <div>
              <h2>
                用户许可协议
                <em>REQUIRED</em>
              </h2>
              <span class="mono">END USER LICENSE AGREEMENT</span>
            </div>
          </header>

          <div class="eula-body">
            <p class="eula-welcome">
              <PixelIcon name="heart" size="xs" />
              欢迎使用 萌动链接：PeroperoChat！（以下简称“本软件”）。
            </p>
            <p>
              在使用本软件之前，请您务必仔细阅读并理解《最终用户许可协议》（以下简称“本协议”）。本软件是一个开源项目，我们鼓励社区共建与共享。
            </p>

            <h4>1. 开源许可与分发</h4>
            <p>
              本软件基于开源协议发布，您可以自由地查看、修改和分发源代码，但须遵守对应的开源许可条款。再分发时请保留原始版权声明与许可信息。
            </p>

            <h4>2. AI 生成内容免责声明</h4>
            <p>
              本软件作为工具平台，集成并调用第三方大语言模型（LLM）服务。所有由 AI
              生成的文字、图像及其他内容均由模型自动产出，不代表开发者的观点或立场。开发者不对 AI
              生成内容的准确性、合法性或适用性承担任何责任。您应自行甄别并审慎使用 AI
              生成的内容，因使用 AI 输出内容所产生的一切后果由用户自行承担。
            </p>

            <h4>3. 隐私与数据安全</h4>
            <p>
              本软件高度重视您的隐私。您的对话记录、角色配置和个人数据默认仅存储在本地设备上，不会被上传至开发者的服务器。若您配置了第三方
              API（如 LLM 接口），相关数据将依据该第三方服务的隐私政策进行处理，请知悉。
            </p>

            <h4>4. 使用规范</h4>
            <p>
              您不得利用本软件从事任何违反所在地区法律法规的活动，包括但不限于生成和传播违法有害信息。请遵守社区公约，共同维护友善、健康的使用环境。
            </p>

            <h4>5. 免责与风险提示</h4>
            <p>
              本软件按“原样”提供，不附带任何形式的明示或暗示担保。开发者不对因使用或无法使用本软件而导致的任何直接或间接损失承担责任。本软件可能集成第三方组件，其稳定性与安全性由各自维护者负责。
            </p>

            <p class="eula-note">
              <PixelIcon name="check" size="xs" />
              点击“同意并继续”即表示您已阅读并同意上述所有条款喵~
            </p>
          </div>

          <footer class="eula-foot">
            <button class="eula-button eula-decline" @click="declineEula">拒绝并退出</button>
            <button class="eula-button eula-accept" @click="acceptEula">
              <PixelIcon name="check" size="xs" />
              <span>同意并继续</span>
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.launcher-shell {
  --px: 2px;
  --cocoa: var(--color-moe-cocoa);
  --cocoa-soft: rgba(45, 27, 30, 0.18);
  --pink: var(--color-pink-face);
  --pink-deep: var(--color-pink-shadow);
  --sky: var(--color-sky-face);
  --sky-deep: var(--color-sky-shadow);
  --purple: var(--color-purple-face);
  position: relative;
  height: 100vh;
  padding-top: 32px;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 16%, rgba(249, 168, 212, 0.2), transparent 30%),
    radial-gradient(circle at 88% 84%, rgba(167, 216, 240, 0.26), transparent 34%),
    linear-gradient(135deg, #fff5fb 0%, #f2faff 55%, #faf7ff 100%);
  color: var(--ui-text-primary);
  font-family: var(--ui-font-sans);
}

/* ── 顶部品牌栏 ── */
.launcher-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 66px;
  padding: 0 26px;
  border-bottom: 2px solid var(--cocoa);
  background: rgba(255, 255, 255, 0.9);
}
.launcher-brand {
  display: flex;
  align-items: center;
  gap: 11px;
}
.brand-mark {
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
}
.brand-mark img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.launcher-brand div:last-child {
  display: flex;
  flex-direction: column;
}
.launcher-brand strong {
  font: 800 17px var(--ui-font-pixel);
  letter-spacing: 0.02em;
}
.launcher-brand span {
  margin-top: 1px;
  color: var(--ui-text-secondary);
  font: 800 10px var(--ui-font-pixel);
  letter-spacing: 0.2em;
}

.global-signals {
  display: flex;
  align-items: center;
  gap: 8px;
}
.signal,
.badge,
.ver {
  display: flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 2px solid var(--cocoa);
  border-radius: 4px;
  background: #fff;
  font: 800 11px var(--ui-font-pixel);
  box-shadow: 2px 2px 0 0 var(--cocoa-soft);
}
.signal {
  gap: 6px;
}
.signal i,
.active-meta i {
  width: 8px;
  height: 8px;
  background: var(--color-amber-face);
}
.signal i.ok,
.active-meta i.ok {
  background: var(--color-emerald-face);
}
.badge {
  background: var(--sky);
  color: #fff;
}
.ver {
  color: var(--ui-text-secondary);
  font-family: var(--ui-font-mono);
}

/* ── 顶部 Tab ── */
.launcher-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: stretch;
  gap: 8px;
  height: 58px;
  padding: 8px 26px;
  border-bottom: 2px solid var(--cocoa);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(8px);
}
.launcher-tabs button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 156px;
  padding: 0 14px;
  border: 2px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}
.launcher-tabs button:hover {
  background: rgba(249, 168, 212, 0.12);
  transform: translateY(-1px);
}
.launcher-tabs button.active {
  border-color: var(--cocoa);
  background: linear-gradient(180deg, #ffe4f2, #ffd1ea);
  color: #831843;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
  transform: translateY(-1px);
}
.launcher-tabs button.active::after {
  position: absolute;
  right: 6px;
  bottom: -6px;
  left: 6px;
  height: 3px;
  background: linear-gradient(90deg, var(--pink-deep), var(--sky-deep));
  content: '';
}
.tab-code {
  font: 800 11px var(--ui-font-mono);
  color: var(--ui-text-tertiary);
}
.launcher-tabs button.active .tab-code {
  color: #831843;
}
.launcher-tabs button strong {
  font: 800 13px var(--ui-font-pixel);
  letter-spacing: 0.02em;
}
.tab-signal {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 8px;
  height: 8px;
}
.tab-signal.warn {
  background: var(--color-amber-face);
}
.tab-signal.update {
  background: var(--sky);
}

/* ── 内容区 ── */
.launcher-content {
  position: relative;
  z-index: 1;
  height: calc(100vh - 156px);
  overflow: hidden;
}
.page {
  width: min(1380px, 100%);
  height: 100%;
  margin: 0 auto;
  padding: 24px 32px 40px;
  overflow: auto;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-eyebrow {
  color: var(--pink-deep);
  font: 900 11px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.page-head h1 {
  margin: 5px 0 4px;
  color: var(--ui-text-primary);
  font-size: 24px;
  letter-spacing: -0.01em;
}
.page-head p {
  margin: 0;
  color: var(--ui-text-secondary);
  font-size: 13px;
}
.check-score {
  padding: 8px 13px;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
  text-align: right;
}
.check-score strong {
  display: block;
  color: var(--sky-deep);
  font: 800 22px var(--ui-font-pixel);
}
.check-score span {
  color: var(--ui-text-secondary);
  font-size: 11px;
}

/* ── 启动页 ── */
.agent-stage {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) 1.4fr;
  gap: 16px;
}
.active-agent-card {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 158px;
  padding: 18px;
  border: 2px solid var(--cocoa);
  background: linear-gradient(135deg, #fff, #ffeef8);
  box-shadow: 5px 5px 0 0 var(--cocoa-soft);
}
.active-avatar {
  position: relative;
  width: 100px;
  height: 100px;
  flex-shrink: 0;
  overflow: hidden;
  border: 2px solid var(--cocoa);
  background: var(--pink);
  box-shadow:
    inset 0 0 0 4px #fff,
    3px 3px 0 0 var(--cocoa-soft);
}
.active-avatar img,
.picker-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.active-avatar span {
  display: grid;
  height: 100%;
  place-items: center;
  color: #fff;
  font-size: 40px;
  font-weight: 900;
}
.active-copy {
  min-width: 0;
}
.active-copy small {
  color: var(--pink-deep);
  font: 900 10px var(--ui-font-pixel);
  letter-spacing: 0.1em;
}
.active-copy h2 {
  margin: 6px 0;
  font-size: 26px;
}
.active-copy p {
  margin: 0;
  color: var(--ui-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.active-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 13px;
  color: var(--ui-text-secondary);
  font-size: 11px;
}
.active-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.active-meta .mono,
.mono {
  font-family: var(--ui-font-mono);
}

.agent-picker {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
  align-content: start;
}
.agent-picker button {
  position: relative;
  display: grid;
  grid-template-columns: 46px 1fr auto;
  grid-template-rows: 1fr 1fr;
  align-items: center;
  column-gap: 10px;
  min-height: 76px;
  padding: 10px;
  border: 2px solid var(--cocoa);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}
.agent-picker button:hover {
  background: #fef2f9;
  transform: translateY(-2px);
}
.agent-picker button.active {
  background: #ffe4f2;
  box-shadow: 4px 4px 0 0 var(--pink-deep);
}
.agent-picker button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.picker-avatar {
  grid-row: 1 / 3;
  width: 44px;
  height: 44px;
  overflow: hidden;
  border: 2px solid var(--cocoa);
  background: var(--sky);
}
.picker-avatar i {
  display: grid;
  height: 100%;
  place-items: center;
  color: #fff;
  font-style: normal;
  font-weight: 900;
}
.agent-picker strong {
  align-self: end;
  font-size: 13px;
}
.agent-picker small {
  align-self: start;
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-mono);
  text-overflow: ellipsis;
}

.launch-bottom {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 18px;
  margin-top: 18px;
}
.check-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  flex: 1;
  gap: 8px;
}
.check-list div {
  display: grid;
  grid-template-columns: 9px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 2px 2px 0 0 var(--cocoa-soft);
  font-size: 12px;
}
.check-list i {
  width: 9px;
  height: 9px;
  background: var(--ui-text-disabled);
}
.check-list i.ok {
  background: var(--color-emerald-face);
}
.check-list i.warn,
.check-list i.running {
  background: var(--color-amber-face);
}
.check-list i.error {
  background: var(--color-red-face);
}
.check-list strong {
  color: var(--ui-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.launch-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.primary-action,
.ghost-action,
.primary-small {
  border: 2px solid var(--cocoa);
  border-radius: 4px;
  font-weight: 800;
  cursor: pointer;
}
.primary-action {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 210px;
  padding: 12px 17px;
  background: linear-gradient(135deg, var(--pink-deep), #be185d);
  color: #fff;
  box-shadow: 4px 4px 0 0 #831843;
  transition:
    transform 0.1s ease,
    box-shadow 0.1s ease;
}
.primary-action:active {
  transform: translate(3px, 3px);
  box-shadow: 1px 1px 0 0 #831843;
}
.primary-action span {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.primary-action strong {
  font-size: 13px;
}
.primary-action small {
  font-size: 10px;
  opacity: 0.85;
}
.ghost-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 13px;
  background: #fff;
  color: var(--ui-text-primary);
  font-size: 12px;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
  transition:
    transform 0.1s ease,
    box-shadow 0.1s ease;
}
.ghost-action:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 0 var(--cocoa-soft);
}
.ghost-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-small {
  padding: 10px 14px;
  background: var(--pink-deep);
  color: #fff;
  font-size: 12px;
  box-shadow: 3px 3px 0 0 #831843;
}

/* ── 运行环境页 ── */
.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.env-card {
  padding: 16px;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 4px 4px 0 0 var(--cocoa-soft);
}
.env-card header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--cocoa-soft);
  color: var(--sky-deep);
}
.env-card header div {
  display: flex;
  flex-direction: column;
}
.env-card header strong {
  color: var(--ui-text-primary);
  font-size: 15px;
}
.env-card header span {
  color: var(--ui-text-tertiary);
  font: 800 10px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.env-card dl {
  margin: 10px 0 0;
}
.env-card dl div {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 2px;
  border-bottom: 1px dashed var(--ui-border-default);
  font-size: 13px;
}
.env-card dt {
  color: var(--ui-text-tertiary);
}
.env-card dd {
  max-width: 72%;
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 12px;
  text-align: right;
}
.env-card dd.mono {
  font-family: var(--ui-font-mono);
}
.ok-text {
  color: var(--color-emerald-shadow) !important;
}
.warn-text {
  color: var(--color-amber-shadow) !important;
}

/* ── 版本公告页 ── */
.update-head {
  align-items: flex-start;
}
.release-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.release-identity span {
  padding: 4px 9px;
  border: 2px solid var(--cocoa);
  background: #ffe4f2;
  color: #831843;
  font: 800 10px var(--ui-font-mono);
  box-shadow: 2px 2px 0 0 var(--cocoa-soft);
}
.release-identity strong {
  color: var(--ui-text-tertiary);
  font: 600 11px var(--ui-font-mono);
}

.release-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  height: calc(100vh - 240px);
  min-height: 380px;
}
.release-notice,
.update-console {
  overflow: hidden;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 5px 5px 0 0 var(--cocoa-soft);
}
.release-notice {
  display: flex;
  min-width: 0;
  height: 100%;
  flex-direction: column;
  border-top: 4px solid var(--pink-deep);
}
.release-notice__head {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 2px solid var(--cocoa-soft);
  background: linear-gradient(100deg, #ffeef8, #fff);
}
.release-symbol {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 2px solid var(--cocoa);
  background: #fff;
  color: var(--pink-deep);
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
}
.release-notice__head small {
  color: var(--pink-deep);
  font: 900 10px var(--ui-font-pixel);
  letter-spacing: 0.08em;
}
.release-notice__head h2 {
  margin: 3px 0;
  color: var(--ui-text-primary);
  font-size: 18px;
}
.release-notice__head p {
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.release-notice__head em {
  margin-left: 8px;
  padding: 2px 6px;
  background: var(--color-amber-light);
  color: #78350f;
  font-style: normal;
}
.release-notice__head > button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 2px solid var(--cocoa);
  border-radius: 4px;
  background: #fff;
  color: var(--ui-text-secondary);
  cursor: pointer;
}
.release-notice__body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 14px 22px 20px;
  background: #fff;
}
.release-notice__body :deep(.async-markdown) {
  min-height: 100%;
}
.release-notice__body :deep(.md-body) {
  color: var(--ui-text-secondary);
  font: 400 14px/1.75 var(--ui-font-sans);
}
.release-notice__body :deep(.md-body h1) {
  padding-bottom: 8px;
  border-bottom: 2px solid var(--cocoa-soft);
  color: var(--ui-text-primary);
  font-size: 22px;
}
.release-notice__body :deep(.md-body h2) {
  margin-top: 1.2em;
  color: var(--pink-deep);
  font-size: 17px;
}
.release-notice__body :deep(.md-body h3) {
  color: var(--ui-text-primary);
  font-size: 15px;
}
.release-notice__body :deep(.md-body code) {
  border: 1px solid var(--ui-border-default);
  border-radius: 3px;
  background: #fafbfc;
  color: var(--ui-accent-purple);
  font-family: var(--ui-font-mono);
}
.release-notice__body :deep(.md-body pre) {
  border: 2px solid var(--cocoa);
  border-radius: 4px;
  background: #1e293b;
}
.release-notice__body :deep(.md-body pre code) {
  background: none;
  border: 0;
  color: #e2e8f0;
}
.release-notice__body :deep(.md-body th) {
  background: rgba(167, 216, 240, 0.35);
}
.release-notice__body :deep(.md-body blockquote) {
  border-left: 4px solid var(--pink-deep);
  border-radius: 0;
  background: #ffeef8;
}
.release-notice > footer {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-top: 2px solid var(--cocoa-soft);
  background: #fafbfc;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.release-notice > footer button {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--sky-deep);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.release-empty {
  display: flex;
  height: 100%;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--ui-text-tertiary);
  font-size: 13px;
}

.update-console {
  align-self: stretch;
  padding: 16px;
}
.update-console > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--cocoa-soft);
}
.update-console > header div {
  display: flex;
  flex-direction: column;
}
.update-console > header span {
  color: var(--ui-text-tertiary);
  font: 800 10px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.update-console > header strong {
  margin-top: 2px;
  font-size: 15px;
}
.update-console > header b {
  padding: 4px 8px;
  border: 2px solid var(--cocoa);
  background: var(--sky);
  color: #fff;
  font: 800 11px var(--ui-font-pixel);
}
.version-stack {
  display: grid;
  grid-template-columns: 1fr 18px 1fr;
  align-items: center;
  gap: 6px;
  padding: 16px 0;
}
.version-stack div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.version-stack small {
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.version-stack strong {
  overflow: hidden;
  margin-top: 3px;
  color: var(--ui-text-primary);
  font: 800 14px var(--ui-font-mono);
  text-overflow: ellipsis;
}
.update-state-line {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 2px solid var(--cocoa-soft);
  background: #fafbfc;
}
.update-state-line > i {
  width: 9px;
  height: 9px;
  background: var(--ui-text-disabled);
}
.update-state-line > i.available,
.update-state-line > i.downloaded {
  background: var(--pink-deep);
  box-shadow: 0 0 0 3px rgba(219, 39, 119, 0.14);
}
.update-state-line > i.error {
  background: var(--color-red-face);
}
.update-state-line div {
  display: flex;
  flex-direction: column;
}
.update-state-line strong {
  font-size: 12px;
}
.update-state-line span {
  margin-top: 2px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.progress-track {
  position: relative;
  height: 12px;
  margin-top: 10px;
  border: 2px solid var(--cocoa);
  background: #fff;
}
.progress-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--pink-deep), var(--sky-deep));
}
.progress-track span {
  position: absolute;
  top: -4px;
  right: 6px;
  color: var(--ui-text-primary);
  font: 800 10px var(--ui-font-mono);
}
.development-box {
  margin-top: 12px;
  padding: 11px;
  border: 2px solid var(--color-amber-shadow);
  background: #fff7e0;
}
.development-box > header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #78350f;
}
.development-box > header strong {
  font-size: 12px;
}
.development-box dl {
  margin: 8px 0;
}
.development-box dl div {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(217, 119, 6, 0.3);
  font-size: 12px;
}
.development-box dt {
  color: #92400e;
}
.development-box dd {
  margin: 0;
  font-family: var(--ui-font-mono);
}
.development-box p {
  margin: 7px 0 0;
  color: #92400e;
  font-size: 11px;
  line-height: 1.5;
}
.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

/* ── 关于页 ── */
.about-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px;
  border: 2px solid var(--cocoa);
  background: linear-gradient(120deg, #fff, #ffeef8);
  box-shadow: 5px 5px 0 0 var(--cocoa-soft);
}
.about-logo {
  display: grid;
  width: 76px;
  height: 76px;
  overflow: hidden;
  place-items: center;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
}
.about-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.about-hero div:nth-child(2) {
  flex: 1;
}
.about-hero span {
  color: var(--pink-deep);
  font: 800 10px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.about-hero h2 {
  margin: 5px 0;
  font-size: 28px;
}
.about-hero p {
  margin: 0;
  color: var(--ui-text-secondary);
  font-size: 13px;
}
.about-hero > strong {
  color: var(--pink-deep);
  font: 800 18px var(--ui-font-mono);
}
.about-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 18px;
}
.about-grid button {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 15px;
  border: 2px solid var(--cocoa);
  background: #fff;
  color: var(--sky-deep);
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}
.about-grid button:hover {
  background: #fef2f9;
  transform: translateY(-2px);
}
.about-grid button span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.about-grid strong {
  color: var(--ui-text-primary);
  font-size: 13px;
}
.about-grid small {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font: 11px var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── EULA ── */
.eula-mask {
  --cocoa: var(--color-moe-cocoa);
  --cocoa-soft: rgba(45, 27, 30, 0.18);
  --pink-deep: var(--color-pink-shadow);
  position: fixed;
  z-index: 300;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(45, 27, 30, 0.6);
  backdrop-filter: blur(4px);
}
.eula-dialog {
  display: flex;
  width: min(720px, calc(100vw - 48px));
  height: min(680px, calc(100vh - 48px));
  max-height: none;
  flex-direction: column;
  overflow: hidden;
  border: 2px solid var(--cocoa);
  background: #fff;
  box-shadow: 9px 9px 0 0 var(--cocoa-soft);
}
.eula-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
  min-height: 88px;
  padding: 16px 20px;
  border-bottom: 2px solid var(--cocoa);
  background: linear-gradient(100deg, #ffeef8, #fff);
}
.eula-icon {
  display: grid;
  width: 54px;
  height: 54px;
  flex-shrink: 0;
  place-items: center;
  border: 2px solid var(--cocoa);
  background: var(--pink-deep);
  color: #fff;
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
}
.eula-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 20px;
}
.eula-head h2 em {
  padding: 2px 7px;
  border: 2px solid var(--cocoa);
  background: #ffe4f2;
  color: #831843;
  font-style: normal;
  font: 800 10px var(--ui-font-pixel);
}
.eula-head span {
  display: block;
  margin-top: 3px;
  color: var(--ui-text-tertiary);
  font: 800 10px var(--ui-font-mono);
  letter-spacing: 0.1em;
}
.eula-body {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 18px 24px 20px;
  color: var(--ui-text-secondary);
  font-size: 14px;
  line-height: 1.8;
}
.eula-body .eula-welcome {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--pink-deep);
  font-weight: 700;
}
.eula-body h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 8px;
  color: var(--ui-text-primary);
  font-size: 15px;
}
.eula-body h4::before {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  background: var(--pink-deep);
  box-shadow: 2px 2px 0 0 var(--cocoa-soft);
  content: '';
}
.eula-body p {
  margin: 0 0 8px;
}
.eula-body .eula-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 2px solid var(--cocoa-soft);
  color: var(--ui-text-tertiary);
  font-size: 13px;
}
.eula-foot {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 10px;
  min-height: 72px;
  padding: 14px 20px;
  border-top: 2px solid var(--cocoa);
  background: #fafbfc;
}
.eula-button {
  display: inline-flex;
  min-width: 138px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 42px;
  padding: 0 18px;
  border: 2px solid var(--cocoa);
  border-radius: 4px;
  font: 800 13px var(--ui-font-sans);
  cursor: pointer;
}
.eula-button:active {
  transform: translate(2px, 2px);
}
.eula-decline {
  background: #fff;
  color: var(--ui-text-secondary);
  box-shadow: 3px 3px 0 0 var(--cocoa-soft);
}
.eula-decline:hover {
  background: #fff4f8;
  color: var(--pink-deep);
}
.eula-accept {
  min-width: 174px;
  background: var(--pink-deep);
  color: #fff;
  box-shadow: 3px 3px 0 0 #831843;
}
.eula-accept:hover {
  background: #be185d;
}
@media (max-width: 600px) {
  .eula-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }
  .eula-head {
    padding: 12px 14px;
  }
  .eula-body {
    padding: 14px 16px;
    font-size: 13px;
  }
  .eula-foot {
    padding: 10px 14px;
  }
  .eula-button {
    min-width: 0;
    flex: 1;
  }
}

@media (max-width: 820px) {
  .launcher-tabs button {
    min-width: 0;
    flex: 1;
    padding: 0 10px;
  }
  .launcher-tabs button .tab-code {
    display: none;
  }
  .agent-stage,
  .release-workspace {
    grid-template-columns: 1fr;
  }
  .release-workspace {
    height: auto;
  }
  .release-notice {
    height: 420px;
  }
  .diagnostic-grid {
    grid-template-columns: 1fr;
  }
  .about-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .check-list {
    grid-template-columns: 1fr;
  }
  .global-signals .signal {
    display: none;
  }
}
</style>
