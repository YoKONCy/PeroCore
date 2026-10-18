<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkbenchStore } from '../stores/workbench'
import { workspaceActions } from '../services/workspaceUi'
import { arcaApplicationControl, type ArcaApplicationStatus } from '../services/applicationControl'
import ArcaIcon from './ArcaIcon.vue'
import ArcaDialog from './ArcaDialog.vue'
import { openDialogs } from '../services/dialogState'

const store = useWorkbenchStore(),
  route = useRoute(),
  router = useRouter()
const confirmStop = ref(false),
  stoppingError = ref('')
const inDocument = computed(() => route.name === 'workbench')
const dirty = computed(
  () => store.officeDirty || store.drafts.length > 0 || store.editState === 'saving',
)
const running = computed(() =>
  store.collaborationTasks.some((task) => ['queued', 'working'].includes(task.status)),
)
const saveLabel = computed(
  () =>
    ({
      idle: '已保存',
      saved: '已保存',
      dirty: '未同步',
      saving: '保存中…',
      conflicted: '版本冲突',
      failed: '保存失败',
    })[store.editState],
)
const bridge = (
  window as unknown as {
    electron?: {
      invoke(channel: string): Promise<unknown>
      send?(channel: string, value: unknown): void
    }
  }
).electron

async function save() {
  try {
    await workspaceActions.value?.save()
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : '保存失败'
  }
}
function requestStop() {
  stoppingError.value = ''
  if (dirty.value || running.value || workspaceActions.value?.hasPendingInput())
    confirmStop.value = true
  else void stop(false)
}
async function stop(keepDraft: boolean) {
  if (store.applicationStopping) return
  store.applicationStopping = true
  stoppingError.value = ''
  const actions = workspaceActions.value
  try {
    if (
      store.foregroundOperations ||
      store.collaborationBusy ||
      ['importing', 'exporting'].includes(store.packageState)
    )
      throw new Error('请等待当前操作完成')
    if (actions) await actions.prepareExit(keepDraft)
    else if (dirty.value) throw new Error('请返回文稿处理未保存的内容')
    let status: ArcaApplicationStatus | undefined
    try {
      status = await arcaApplicationControl.status()
    } catch {
      /* 独立运行时使用自身停止能力。 */
    }
    if (status?.ownership === 'managed') {
      const result = await arcaApplicationControl.stop()
      if (result.hostState !== 'offline') throw new Error('应用仍在停止，请稍后重试')
    } else {
      const transport = store.transport,
        token = store.session?.token
      if (!transport || !token) throw new Error('无法连接应用，请在连接设置中重新检测')
      await transport.invoke(
        'application.stop',
        { surfaceSessionToken: token },
        { idempotencyKey: crypto.randomUUID() },
      )
      await transport.waitUntilClosed()
    }
    store.applicationStopped = true
    await store.disconnect()
    confirmStop.value = false
    bridge?.send?.('desktop-tabs:unsaved-changes', false)
    if (bridge) {
      try {
        await bridge.invoke('window-close')
      } catch {
        /* 容器不支持关闭时保留停止页面。 */
      }
    } else if (window.opener) window.close()
  } catch (error) {
    actions?.resume()
    stoppingError.value = error instanceof Error ? error.message : '停止应用失败'
    confirmStop.value = true
  } finally {
    store.applicationStopping = false
    if (!store.applicationStopped && !store.hostOnline) store.scheduleReconnect()
  }
}
</script>

<template>
  <header class="application-bar" :inert="openDialogs > 0">
    <button
      class="app-brand"
      type="button"
      title="文稿库"
      :disabled="store.applicationStopping"
      @click="router.push('/')"
    >
      <span class="app-wordmark">Arca</span>
    </button>
    <span class="app-divider" />
    <div class="application-title">
      <button
        v-if="inDocument"
        class="document-name"
        type="button"
        title="重命名"
        :disabled="store.applicationStopping || store.foregroundOperations > 0"
        @click="workspaceActions?.rename()"
      >
        {{ store.documentTitle }}
      </button>
      <strong v-else>{{ route.name === 'settings' ? '设置' : '文稿' }}</strong>
    </div>
    <div class="app-controls">
      <button
        v-if="inDocument"
        class="save-state"
        :data-state="store.editState"
        type="button"
        title="保存文稿"
        :disabled="store.applicationStopping"
        @click="save"
      >
        <i />
        {{ saveLabel }}
      </button>
      <button
        v-if="route.name !== 'settings'"
        class="icon-button"
        type="button"
        title="设置"
        aria-label="设置"
        :disabled="store.applicationStopping"
        @click="router.push('/settings')"
      >
        <ArcaIcon name="settings" />
      </button>
      <button
        v-if="!store.applicationStopped"
        class="stop-application"
        type="button"
        :disabled="store.applicationStopping"
        @click="requestStop"
      >
        <ArcaIcon name="power" :size="16" />
        {{ store.applicationStopping ? '停止中…' : '停止应用' }}
      </button>
    </div>
  </header>
  <ArcaDialog
    :open="confirmStop"
    title="停止应用？"
    :busy="store.applicationStopping"
    @close="confirmStop = false"
  >
    <p v-if="dirty">
      {{ store.editState === 'conflicted' ? '当前文稿存在版本冲突。' : '文稿还有未保存的内容。' }}
    </p>
    <p v-if="running">正在进行的协作会停止。</p>
    <p v-if="stoppingError" class="form-error" role="alert">{{ stoppingError }}</p>
    <template #footer>
      <button type="button" :disabled="store.applicationStopping" @click="confirmStop = false">
        取消
      </button>
      <button
        v-if="dirty && workspaceActions?.canKeepDraft()"
        type="button"
        :disabled="store.applicationStopping"
        @click="stop(true)"
      >
        保留草稿并停止
      </button>
      <button
        class="danger-button"
        type="button"
        :disabled="store.applicationStopping"
        @click="stop(false)"
      >
        {{ dirty ? '保存并停止' : '停止应用' }}
      </button>
    </template>
  </ArcaDialog>
</template>
