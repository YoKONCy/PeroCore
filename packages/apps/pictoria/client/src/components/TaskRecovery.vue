<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Run } from '../types'
import type { CanvasStore } from '../composables/useCanvas'
import { pictoria } from '../services/transport'
import Icon from './PictoriaIcon.vue'
import PictoriaSelect from './PictoriaSelect.vue'
const props = defineProps<{ store: CanvasStore; runId: string }>()
const emit = defineEmits<{ close: [] }>()
const run = ref<Run>(),
  nodeId = ref(''),
  remoteId = ref(''),
  confirmRetry = ref(false),
  busy = ref(false),
  problem = ref('')
const dialog = ref<HTMLElement | null>(null),
  previousFocus = document.activeElement
let generation = 0,
  disposed = false
const candidates = computed(
  () =>
    run.value?.nodes.filter(
      (node) => !['completed', 'cancelled', 'skipped'].includes(node.state),
    ) || [],
)
const node = computed(
  () => candidates.value.find((node) => node.id === nodeId.value) || candidates.value[0],
)
async function load() {
  const request = ++generation,
    owner = props.store.agentId.value
  busy.value = true
  problem.value = ''
  run.value = undefined
  nodeId.value = ''
  remoteId.value = ''
  confirmRetry.value = false
  try {
    const value = await pictoria.task(owner, props.runId)
    if (!disposed && request === generation) {
      if (!value) throw new Error('任务不存在')
      run.value = value
      nodeId.value =
        value.nodes.find((node) => node.state === 'uncertain')?.id || candidates.value[0]?.id || ''
    }
  } catch (error) {
    if (!disposed && request === generation)
      problem.value = error instanceof Error ? error.message : '任务读取失败'
  } finally {
    if (!disposed && request === generation) busy.value = false
  }
}
watch(() => [props.runId, props.store.agentId.value], load, { immediate: true })
watch(nodeId, () => {
  remoteId.value = node.value?.remoteId || ''
  confirmRetry.value = false
})
async function resume() {
  if (!node.value || busy.value) return
  if (node.value.state === 'uncertain' && !confirmRetry.value && !remoteId.value.trim()) {
    problem.value = '请填写远程任务 ID'
    return
  }
  const request = generation,
    owner = props.store.agentId.value
  busy.value = true
  problem.value = ''
  try {
    const result = await pictoria.operation<Run>(owner, 'task.resume', {
      id: props.runId,
      nodeId: node.value.id,
      ...(confirmRetry.value
        ? { confirmRetry: true }
        : remoteId.value.trim() && node.value.state === 'uncertain'
          ? { remoteId: remoteId.value.trim() }
          : {}),
    })
    if (disposed || request !== generation) return
    const card = props.store.project.items.find((item) => item.content.runId === result.id)
    if (card) {
      card.content.state = result.state
      card.content.error = result.error
      card.content.outputsResolved = false
    }
    if (result.state === 'waiting') {
      run.value = result
      nodeId.value = result.nodes.find((node) => node.state === 'uncertain')?.id || ''
      confirmRetry.value = false
    } else emit('close')
  } catch (error) {
    if (!disposed && request === generation)
      problem.value = error instanceof Error ? error.message : '恢复失败'
  } finally {
    if (!disposed && request === generation) busy.value = false
  }
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
    ) || [],
  )
  const first = elements[0],
    last = elements.at(-1)
  if (!first) {
    event.preventDefault()
    dialog.value?.focus()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(() => dialog.value?.focus())
onBeforeUnmount(() => {
  disposed = true
  generation++
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
})
</script>
<template>
  <div
    class="recovery-backdrop"
    data-ui
    @pointerdown.self="emit('close')"
    @keydown.esc.stop="emit('close')"
  >
    <section
      ref="dialog"
      class="task-recovery floating-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="__t('apps.pictoria.ui', '恢复任务')"
      tabindex="-1"
      @keydown="trapFocus"
    >
      <header>
        <strong>{{ __t('apps.pictoria.ui', '恢复任务') }}</strong>
        <button
          class="icon-button"
          :aria-label="__t('apps.pictoria.ui', '关闭')"
          @click="emit('close')"
        >
          <Icon name="close" :size="17" />
        </button>
      </header>
      <span v-if="busy && !run" class="field-help">{{ __t('apps.pictoria.ui', '读取中…') }}</span>
      <template v-if="run && node">
        <div v-if="candidates.length > 1" class="panel-field">
          <span>{{ __t('apps.pictoria.ui', '节点') }}</span>
          <PictoriaSelect
            v-model="nodeId"
            :options="candidates.map((node) => ({ value: node.id, label: node.id }))"
            :label="__t('apps.pictoria.ui', '待恢复节点')"
            :disabled="busy"
          />
        </div>
        <p v-if="node.error" class="recovery-error">{{ node.error }}</p>
        <label v-if="node.state === 'uncertain'" class="panel-field">
          {{ __t('apps.pictoria.ui', '远程任务 ID') }}
          <input
            v-model="remoteId"
            :disabled="busy || confirmRetry"
            maxlength="500"
            :placeholder="__t('apps.pictoria.ui', '填写供应商的任务 ID')"
          />
        </label>
        <code v-else-if="node.remoteId" class="recovery-id">{{ node.remoteId }}</code>
        <label v-if="['uncertain', 'failed'].includes(node.state)" class="retry-confirmation">
          <input v-model="confirmRetry" type="checkbox" :disabled="busy" />
          <span>{{ __t('apps.pictoria.ui', '已核验，需要重新提交（可能再次计费）') }}</span>
        </label>
        <footer>
          <button class="text-button" @click="emit('close')">
            {{ __t('apps.pictoria.ui', '取消') }}
          </button>
          <button
            class="create-button"
            :disabled="busy || (node.state === 'uncertain' && !confirmRetry && !remoteId.trim())"
            @click="resume"
          >
            {{
              busy
                ? __t('apps.pictoria.ui', '处理中')
                : confirmRetry
                  ? __t('apps.pictoria.ui', '重新提交')
                  : __t('apps.pictoria.ui', '继续恢复')
            }}
          </button>
        </footer>
      </template>
      <p v-if="problem" class="composer-error" role="alert">{{ problem }}</p>
    </section>
  </div>
</template>
