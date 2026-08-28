<script setup lang="ts">
/**
 * ArcaTab.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
defineOptions({ name: 'ArcaTab' })

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PixelIcon, PButton, PSwitch } from '../../pixel'
import { getApiBaseUrl } from '../../../api/transport'
import { arcaApi, type ArcaApplicationStatus } from '../../../api/modules/arcaApi'
import { invoke, isElectron } from '../../../utils/ipcAdapter'
import { useCompositorStore, useNotificationStore } from '../../../stores'

const notification = useNotificationStore()
const compositor = useCompositorStore()
const status = ref<ArcaApplicationStatus>()
const loading = ref(false)
const action = ref('')
const autoRefresh = ref(true)
const uiWindow = ref({ open: false, visible: false })
let timer: number | undefined

const connected = computed(() => status.value?.federation.state === 'connected')
const managed = computed(() => status.value?.ownership === 'managed')
const hostLabel = computed(() => {
  if (!status.value) return '检测中'
  if (status.value.ownership === 'managed') return '由 infOS 托管'
  if (status.value.ownership === 'adopted') return '外部实例'
  return '未运行'
})
const stateLabel = computed(() => {
  const state = status.value?.federation.state
  return state === 'connected'
    ? '已接入'
    : state === 'connecting'
      ? '连接中'
      : state === 'error'
        ? '异常'
        : '离线'
})

async function refresh(silent = false) {
  if (!silent) loading.value = true
  try {
    const [statusResponse, projectionResponse] = await Promise.all([
      arcaApi.getStatus(),
      arcaApi.getProjection(),
    ])
    status.value = statusResponse.data
    if (projectionResponse.data) compositor.replaceProjection(projectionResponse.data)
    if (isElectron()) {
      uiWindow.value = (await invoke('get-arca-window-state')) as typeof uiWindow.value
    }
  } catch (error) {
    if (!silent) notification.toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    loading.value = false
  }
}

async function run(name: string, task: () => Promise<unknown>) {
  action.value = name
  try {
    await task()
    await refresh(true)
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    action.value = ''
  }
}

function startHost() {
  return run('start', () => arcaApi.start())
}
function stopHost() {
  return run('stop', () => arcaApi.stop())
}
function reconnect() {
  return run('reconnect', () => arcaApi.reconnect())
}

async function openUi() {
  const value = status.value
  const endpoint = value?.federation.discovery?.endpoint
  if (!value || !endpoint) {
    notification.toast('Arca Host尚未发布可用连接端点', 'error')
    return
  }
  const uiUrl = new URL(value.uiUrl, window.location.origin)
  uiUrl.searchParams.set('endpoint', endpoint)
  uiUrl.searchParams.set('kernelOrigin', new URL(getApiBaseUrl()).origin)
  action.value = 'open-ui'
  try {
    if (isElectron()) {
      uiWindow.value = (await invoke('open-arca-window', {
        url: uiUrl.toString(),
      })) as typeof uiWindow.value
    } else {
      window.open(uiUrl, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    action.value = ''
  }
}

async function closeUi() {
  action.value = 'close-ui'
  try {
    if (isElectron()) {
      uiWindow.value = (await invoke('close-arca-window')) as typeof uiWindow.value
    }
  } finally {
    action.value = ''
  }
}

async function copyDiagnostics() {
  await navigator.clipboard.writeText(JSON.stringify(status.value, null, 2))
  notification.toast('Arca诊断信息已复制', 'success')
}

function schedule() {
  if (timer) window.clearInterval(timer)
  if (autoRefresh.value) timer = window.setInterval(() => void refresh(true), 3_000)
}

onMounted(() => {
  void refresh()
  schedule()
})
onBeforeUnmount(() => timer && window.clearInterval(timer))
</script>

<template>
  <div class="arca-panel">
    <header class="arca-hero">
      <div class="arca-mark" aria-hidden="true">
        <span class="arca-fold" />
        <PixelIcon name="book" size="md" />
      </div>
      <div class="arca-heading">
        <div class="arca-title-row">
          <h1>Arca</h1>
          <span class="arca-badge">OFFICIAL APP</span>
        </div>
        <p>语义文档工作站 · 独立应用控制与联邦观察</p>
      </div>
      <div class="arca-live" :class="{ online: connected }">
        <span class="arca-pixel-dot" />
        {{ stateLabel }}
      </div>
    </header>

    <section class="arca-action-deck">
      <div>
        <span class="eyebrow">APPLICATION</span>
        <h2>{{ hostLabel }}</h2>
        <p v-if="status?.ownership === 'adopted'">已发现外部Arca实例。默认只连接，不直接终止。</p>
        <p v-else-if="status?.ownership === 'managed'">Host由当前infOS进程托管，可安全优雅停止。</p>
        <p v-else>启动托管实例，或等待外部Arca发布Discovery。</p>
      </div>
      <div class="arca-actions">
        <PButton
          v-if="status?.ownership === 'offline'"
          size="sm"
          :loading="action === 'start'"
          :disabled="!status?.managedRuntimeAvailable"
          @click="startHost"
        >
          <PixelIcon name="flash" size="xs" />
          启动 Arca
        </PButton>
        <PButton
          v-if="managed"
          size="sm"
          variant="danger"
          :loading="action === 'stop'"
          @click="stopHost"
        >
          <PixelIcon name="close" size="xs" />
          停止 Host
        </PButton>
        <PButton size="sm" variant="secondary" :loading="action === 'reconnect'" @click="reconnect">
          <PixelIcon name="refresh" size="xs" />
          重新检测
        </PButton>
      </div>
      <div v-if="status && !status.managedRuntimeAvailable" class="arca-inline-note">
        <PixelIcon name="alert" size="xs" />
        {{ status.managedRuntimeReason }}
      </div>
    </section>

    <div class="arca-grid">
      <section class="arca-card">
        <header>
          <PixelIcon name="link" size="xs" />
          <span>Federation</span>
        </header>
        <dl>
          <div>
            <dt>连接状态</dt>
            <dd :class="{ ok: connected }">{{ stateLabel }}</dd>
          </div>
          <div>
            <dt>所有权</dt>
            <dd>{{ status?.ownership ?? '—' }}</dd>
          </div>
          <div>
            <dt>Node ID</dt>
            <dd class="mono">{{ status?.federation.discovery?.nodeId ?? '—' }}</dd>
          </div>
          <div>
            <dt>Generation</dt>
            <dd>{{ status?.federation.discovery?.generation ?? '—' }}</dd>
          </div>
          <div>
            <dt>PID</dt>
            <dd>{{ status?.pid ?? '—' }}</dd>
          </div>
          <div>
            <dt>最后接入</dt>
            <dd>{{ status?.federation.lastConnectedAt ?? '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="arca-card arca-ui-card">
        <header>
          <PixelIcon name="desktop" size="xs" />
          <span>工作台 UI</span>
        </header>
        <div class="arca-window-art" aria-hidden="true">
          <span class="window-bar">
            <i />
            <i />
            <i />
          </span>
          <span class="window-page">
            <b />
            <b />
            <b />
          </span>
        </div>
        <p>
          {{
            isElectron() ? 'Electron客户端将在独立窗口中打开。' : '浏览器客户端将在新页面中打开。'
          }}
        </p>
        <div class="arca-actions">
          <PButton size="sm" :disabled="!connected" :loading="action === 'open-ui'" @click="openUi">
            <PixelIcon name="book" size="xs" />
            {{ uiWindow.open ? '聚焦工作台' : '打开工作台' }}
          </PButton>
          <PButton
            v-if="isElectron()"
            size="sm"
            variant="ghost"
            :disabled="!uiWindow.open"
            :loading="action === 'close-ui'"
            @click="closeUi"
          >
            关闭 UI
          </PButton>
        </div>
      </section>
    </div>

    <section class="arca-card arca-diagnostics">
      <header>
        <PixelIcon name="settings" size="xs" />
        <span>集成观察</span>
        <div class="arca-header-spacer" />
        <label class="arca-switch-label">
          自动刷新
          <PSwitch v-model="autoRefresh" @update:model-value="schedule" />
        </label>
      </header>
      <div class="diagnostic-row">
        <span>Discovery</span>
        <code>{{ status?.federation.discoveryPath ?? '—' }}</code>
      </div>
      <div class="diagnostic-row">
        <span>UI URL</span>
        <code>{{ status?.uiUrl ?? '—' }}</code>
      </div>
      <div v-if="status?.lastError" class="arca-error">
        <PixelIcon name="alert" size="xs" />
        {{ status.lastError }}
      </div>
      <PButton size="sm" variant="ghost" @click="copyDiagnostics">复制诊断信息</PButton>
    </section>
  </div>
</template>

<style scoped>
.arca-panel {
  min-height: 100%;
  padding: 22px;
  color: var(--ui-text-primary);
  background:
    radial-gradient(
      circle at 88% 4%,
      color-mix(in srgb, var(--color-purple-face) 24%, transparent),
      transparent 34%
    ),
    radial-gradient(
      circle at 7% 96%,
      color-mix(in srgb, var(--color-sky-500) 12%, transparent),
      transparent 28%
    );
  overflow: auto;
}
.arca-hero,
.arca-action-deck,
.arca-card {
  border: 2px solid var(--ui-border-default);
  background: color-mix(in srgb, var(--dash-panel-soft) 92%, transparent);
  box-shadow: 4px 4px 0 var(--color-shadow, rgba(37, 28, 64, 0.14));
}
.arca-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 6px;
}
.arca-mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  position: relative;
  color: white;
  background: linear-gradient(135deg, var(--color-purple-face), var(--color-sky-500));
  border: 2px solid var(--ui-border-default);
  box-shadow: 3px 3px 0 var(--color-shadow);
}
.arca-fold {
  position: absolute;
  right: -2px;
  top: -2px;
  border-left: 13px solid transparent;
  border-top: 13px solid var(--dash-panel-soft);
}
.arca-heading {
  flex: 1;
}
.arca-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  font-family: var(--font-pixel), monospace;
  font-size: 24px;
}
h2 {
  font-size: 17px;
  margin: 5px 0;
}
.arca-heading p,
.arca-action-deck p,
.arca-ui-card p {
  color: var(--ui-text-secondary);
  font-size: 13px;
}
.arca-badge,
.eyebrow {
  font-family: var(--font-pixel), monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--color-purple-shadow);
}
.arca-badge {
  padding: 4px 7px;
  border: 1px solid currentColor;
  background: color-mix(in srgb, var(--color-purple-face) 12%, transparent);
}
.arca-live {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ui-text-secondary);
}
.arca-pixel-dot {
  width: 9px;
  height: 9px;
  background: var(--color-red-face);
  box-shadow: 2px 0 0 color-mix(in srgb, var(--color-red-face) 50%, transparent);
}
.arca-live.online .arca-pixel-dot {
  background: #68d391;
  box-shadow: 2px 0 0 #b7f4c9;
}
.arca-action-deck {
  margin-top: 16px;
  padding: 18px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
}
.arca-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
}
.arca-inline-note {
  grid-column: 1 / -1;
  display: flex;
  gap: 7px;
  align-items: center;
  color: var(--ui-text-secondary);
  font-size: 12px;
  padding: 9px 11px;
  background: color-mix(in srgb, var(--color-yellow-face) 15%, transparent);
  border-left: 3px solid var(--color-yellow-face);
}
.arca-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  gap: 16px;
  margin-top: 16px;
}
.arca-card {
  padding: 16px;
}
.arca-card > header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 25px;
  font-family: var(--font-pixel), monospace;
  font-size: 12px;
  color: var(--ui-text-primary);
  border-bottom: 1px dashed var(--ui-border-default);
  padding-bottom: 10px;
  margin-bottom: 12px;
}
dl {
  margin: 0;
  display: grid;
  gap: 7px;
}
dl > div {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 10px;
  font-size: 12px;
}
dt {
  color: var(--ui-text-tertiary);
}
dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
dd.ok {
  color: #35a56a;
  font-weight: 700;
}
.mono,
code {
  font-family: var(--font-mono), monospace;
}
.arca-ui-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.arca-window-art {
  height: 105px;
  border: 2px solid var(--ui-border-default);
  background: color-mix(in srgb, var(--ui-bg-hover) 78%, transparent);
  box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--color-purple-face) 8%, transparent);
}
.window-bar {
  height: 22px;
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 0 7px;
  border-bottom: 2px solid var(--ui-border-default);
}
.window-bar i {
  width: 7px;
  height: 7px;
  background: var(--color-purple-face);
}
.window-page {
  display: grid;
  gap: 8px;
  padding: 15px;
}
.window-page b {
  display: block;
  height: 8px;
  background: color-mix(in srgb, var(--color-sky-500) 24%, var(--dash-panel-soft));
}
.window-page b:nth-child(2) {
  width: 72%;
}
.window-page b:nth-child(3) {
  width: 86%;
}
.arca-diagnostics {
  margin-top: 16px;
}
.arca-header-spacer {
  flex: 1;
}
.arca-switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--ui-text-secondary);
}
.diagnostic-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  margin: 8px 0;
  font-size: 12px;
}
.diagnostic-row span {
  color: var(--ui-text-tertiary);
}
.diagnostic-row code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arca-error {
  display: flex;
  gap: 7px;
  color: var(--color-red-face);
  padding: 10px;
  margin: 10px 0;
  border: 1px dashed currentColor;
}
@media (max-width: 840px) {
  .arca-grid {
    grid-template-columns: 1fr;
  }
  .arca-action-deck {
    grid-template-columns: 1fr;
  }
  .arca-live {
    display: none;
  }
}
</style>
