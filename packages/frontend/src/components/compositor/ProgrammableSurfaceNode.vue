<script setup lang="ts">
/**
 * ProgrammableSurfaceNode.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ProgrammableIslandSurfaceProps } from '@infos/shared'
import {
  parseProgrammableSurfaceMessage,
  prepareProgrammableSandbox,
  programmableSurfaceSources,
} from '../../compositor/programmableSurfaceSandbox'

const props = defineProps<{
  descriptor: ProgrammableIslandSurfaceProps
  active: boolean
}>()
const emit = defineEmits<{
  input: [payload: { action: string; value?: unknown }]
}>()
const iframe = ref<HTMLIFrameElement>()
const srcdoc = ref('')
const state = ref<'loading' | 'ready' | 'blocked' | 'failed'>('loading')
const errorMessage = ref('')
let timeout: number | undefined

async function initialize(): Promise<void> {
  state.value = 'loading'
  try {
    const source = await programmableSurfaceSources.resolve(props.descriptor.sourceBlobId)
    const prepared = await prepareProgrammableSandbox(props.descriptor, source)
    srcdoc.value = prepared.srcdoc
    timeout = window.setTimeout(() => {
      state.value = 'failed'
      errorMessage.value = '可编程Surface启动超时'
      srcdoc.value = ''
    }, 5_000)
  } catch (error) {
    state.value = 'blocked'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function handleMessage(event: MessageEvent): void {
  if (event.source !== iframe.value?.contentWindow) return
  const message = parseProgrammableSurfaceMessage(event.data, props.descriptor.sandboxId)
  if (!message) return
  if (message.type === 'ready') {
    if (timeout) window.clearTimeout(timeout)
    state.value = 'ready'
  } else if (message.type === 'input') {
    if (!props.active || !props.descriptor.permissions.includes('input')) return
    emit('input', message.payload)
  } else if (message.type === 'error') {
    state.value = 'failed'
    errorMessage.value = message.payload.message
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  void initialize()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
  if (timeout) window.clearTimeout(timeout)
  srcdoc.value = ''
})
</script>

<template>
  <section class="programmable-surface" :data-state="state">
    <iframe
      v-if="srcdoc && active"
      ref="iframe"
      :srcdoc="srcdoc"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      title="隔离的可编程Surface"
    />
    <p v-if="state === 'loading'">正在验证可编程Surface…</p>
    <p v-else-if="state === 'blocked' || state === 'failed'">已阻止：{{ errorMessage }}</p>
    <p v-else-if="!active">可编程Surface已暂停</p>
  </section>
</template>

<style scoped>
.programmable-surface {
  min-height: 32px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-secondary);
}
.programmable-surface iframe {
  display: block;
  width: 100%;
  min-height: 120px;
  border: 0;
}
.programmable-surface p {
  margin: 0;
  padding: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.programmable-surface[data-state='blocked'],
.programmable-surface[data-state='failed'] {
  border-color: var(--color-danger);
}
</style>
