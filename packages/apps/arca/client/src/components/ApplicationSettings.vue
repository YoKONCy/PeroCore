<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { arcaApplicationControl, type ArcaApplicationStatus } from '../services/applicationControl'
import { useWorkbenchStore } from '../stores/workbench'
import ArcaIcon from './ArcaIcon.vue'

const store = useWorkbenchStore()
const status = ref<ArcaApplicationStatus>()
const refreshing = ref(false)
const action = ref('')
const autoRefresh = ref(true)
const error = ref('')
const notice = ref('')
let timer: ReturnType<typeof setInterval> | undefined
let disposed = false
const connected = computed(() => status.value?.federation.state === 'connected')
const ownership = computed(() =>
  status.value?.ownership === 'managed'
    ? '由 infOS 托管'
    : status.value?.ownership === 'adopted'
      ? '外部实例'
      : '未运行',
)
const connectionLabel = computed(() => {
  const state = status.value?.federation.state
  return state === 'connected'
    ? '已接入'
    : state === 'connecting'
      ? '连接中'
      : state === 'error'
        ? '连接异常'
        : '离线'
})
const hostStateLabel = computed(
  () =>
    ({
      offline: '未运行',
      starting: '启动中',
      running: '运行中',
      stopping: '停止中',
      error: '异常',
    })[status.value?.hostState ?? 'offline'],
)

async function acceptStatus(value: ArcaApplicationStatus): Promise<void> {
  if (disposed || store.applicationStopping || store.applicationStopped) return
  status.value = value
  const endpoint = value.federation.discovery?.endpoint
  if (value.federation.state === 'connected' && endpoint && endpoint !== store.endpoint) {
    await store.reconnect(endpoint)
  }
}

async function refresh(silent = false): Promise<void> {
  if (
    disposed ||
    store.applicationStopping ||
    store.applicationStopped ||
    refreshing.value ||
    action.value
  )
    return
  refreshing.value = true
  try {
    await acceptStatus(await arcaApplicationControl.status())
    if (!disposed) error.value = ''
  } catch (cause) {
    if (!disposed && (!silent || !status.value))
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    refreshing.value = false
  }
}

async function run(name: 'start' | 'reconnect'): Promise<void> {
  if (disposed || store.applicationStopping || action.value || refreshing.value) return
  action.value = name
  error.value = ''
  notice.value = ''
  try {
    const value = await arcaApplicationControl[name]()
    if (disposed) return
    await acceptStatus(value)
    if (
      name === 'reconnect' &&
      value.federation.discovery?.endpoint &&
      store.connection !== 'ready'
    ) {
      await store.reconnect(value.federation.discovery.endpoint)
    }
    if (disposed) return
    notice.value = '连接已更新'
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    action.value = ''
  }
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(status.value ?? {}, null, 2))
    if (!disposed) notice.value = '诊断信息已复制'
  } catch (cause) {
    if (!disposed) error.value = `复制诊断信息失败：${String(cause)}`
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  if (autoRefresh.value && !disposed) timer = setInterval(() => void refresh(true), 3_000)
}
onMounted(() => {
  void refresh()
  schedule()
})
onBeforeUnmount(() => {
  disposed = true
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="application-settings">
    <p v-if="error" class="property-message error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="property-message" role="status">{{ notice }}</p>
    <section class="property-group connection-overview">
      <header>
        <span>应用</span>
        <small>{{ hostStateLabel }}</small>
      </header>
      <div class="application-ownership">
        <div class="connection-identity">
          <span class="settings-symbol"><ArcaIcon name="connection" :size="23" /></span>
          <div>
            <strong>{{ ownership }}</strong>
            <small>{{ connectionLabel }}</small>
          </div>
        </div>
        <div class="application-actions">
          <button
            v-if="status?.ownership === 'offline'"
            class="primary-button"
            :disabled="!status?.managedRuntimeAvailable || !!action || refreshing"
            @click="run('start')"
          >
            {{ action === 'start' ? '启动中…' : '启动应用' }}
          </button>
          <button :disabled="!!action || refreshing" @click="run('reconnect')">
            {{ action === 'reconnect' ? '检测中…' : '重新连接' }}
          </button>
        </div>
      </div>
      <dl class="application-facts">
        <div>
          <dt>文稿服务</dt>
          <dd :class="{ connected: store.connection === 'ready' }">
            {{ store.connection === 'ready' ? '已连接' : '离线' }}
          </dd>
        </div>
        <div>
          <dt>infOS</dt>
          <dd :class="{ connected }">{{ connectionLabel }}</dd>
        </div>
      </dl>
    </section>
    <details class="property-group application-diagnostics">
      <summary>诊断信息</summary>
      <dl class="application-facts">
        <div>
          <dt>进程 ID</dt>
          <dd>{{ status?.pid ?? '—' }}</dd>
        </div>
        <div>
          <dt>节点 ID</dt>
          <dd>
            <code>{{ status?.federation.discovery?.nodeId ?? '—' }}</code>
          </dd>
        </div>
        <div>
          <dt>连接代次</dt>
          <dd>{{ status?.federation.discovery?.generation ?? '—' }}</dd>
        </div>
        <div>
          <dt>最后连接</dt>
          <dd>{{ status?.federation.lastConnectedAt ?? '—' }}</dd>
        </div>
        <div>
          <dt>发现文件</dt>
          <dd>
            <code>{{ status?.federation.discoveryPath ?? '—' }}</code>
          </dd>
        </div>
        <div>
          <dt>服务端点</dt>
          <dd>
            <code>{{ status?.federation.discovery?.endpoint ?? store.endpoint ?? '—' }}</code>
          </dd>
        </div>
        <div>
          <dt>界面入口</dt>
          <dd>
            <code>{{ status?.uiUrl ?? '—' }}</code>
          </dd>
        </div>
      </dl>
      <p v-if="status && !status.managedRuntimeAvailable" class="property-note">
        {{ status.managedRuntimeReason }}
      </p>
      <p v-if="status?.lastError || status?.federation.lastError" class="property-message error">
        {{ status?.lastError || status?.federation.lastError }}
      </p>
      <footer class="application-actions application-diagnostic-actions">
        <label class="application-auto-refresh">
          <input v-model="autoRefresh" type="checkbox" @change="schedule" />
          自动刷新
        </label>
        <button :disabled="!!action || refreshing" @click="refresh()">
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
        <button :disabled="!status" @click="copyDiagnostics">复制诊断</button>
      </footer>
    </details>
  </div>
</template>

<style scoped>
.application-settings {
  display: grid;
  gap: 18px;
}
.application-settings .property-group {
  margin: 0;
}
.application-ownership {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  padding: 20px;
}
.application-ownership strong {
  font-size: 14px;
  font-weight: 500;
}
.application-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.application-facts {
  margin: 0;
  padding: 0 20px 12px;
}
.application-facts > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 20px;
  padding: 12px 0;
  border-bottom: 1px solid var(--arca-line);
  font-size: 12px;
}
.application-facts > div:last-child {
  border-bottom: 0;
}
.application-facts dt {
  color: var(--arca-text-soft);
}
.application-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.application-facts dd.connected {
  color: var(--arca-verdant);
}
.application-facts code {
  font-size: 11px;
}
.application-auto-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arca-text-soft);
}
.application-diagnostic-actions {
  padding: 12px 20px 20px;
}
.application-settings .property-note {
  margin: 0 20px 18px;
  color: var(--arca-text-soft);
  font-size: 12px;
}
.application-settings .property-message {
  margin: 0;
}
</style>
