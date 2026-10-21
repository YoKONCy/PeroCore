<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  normalizeReasoningEffort,
  reasoningEffortOptions,
  type ReasoningEffort,
  type ThreadModelSettings,
} from '@infos/shared'
import { threadsApi } from '../../api/modules/threadsApi'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { resolveModelBrand } from '../../lib/modelBrands'
import BrandIcon from '../brands/BrandIcon.vue'
import PSelect from '../pixel/PSelect.vue'
import PixelIcon from '../pixel/PixelIcon.vue'

const props = defineProps<{ threadId: string; disabled?: boolean }>()
const emit = defineEmits<{ changed: [settings: ThreadModelSettings]; busy: [value: boolean] }>()
const notify = useNotificationStore()
const settings = ref<ThreadModelSettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref(false)
let sequence = 0
const blocked = computed(() => props.disabled || loading.value || saving.value || !settings.value)
const modelValue = computed(() => settings.value?.modelConfigId?.toString() ?? '')
const modelOptions = computed(() => [
  {
    value: '',
    get label() {
      return __t('ui.chat', '全局主模型')
    },
    brand: modelValue.value ? undefined : resolveModelBrand(settings.value?.effective.modelId),
  },
  ...(settings.value?.models ?? []).map((model) => ({
    value: String(model.id),
    label: model.name,
    brand: resolveModelBrand(model.modelId),
  })),
])
const modelBrands = computed(
  () => new Map(modelOptions.value.map((option) => [option.value, option.brand])),
)
const efforts = computed(() =>
  reasoningEffortOptions(settings.value?.effective.modelId ?? '', __t('ui.chat', '跟随模型')).map(
    (option) => ({ ...option, label: __t('common.interface', option.label) }),
  ),
)
const rank = computed(() => {
  const effort = settings.value?.effective.reasoningEffort
  return effort ? { off: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }[effort] : 0
})
const effortLabel = computed(() =>
  settings.value?.reasoningEffort
    ? (efforts.value.find((option) => option.value === settings.value?.reasoningEffort)?.label ??
      __t('ui.chat', '默认'))
    : __t('ui.chat', '默认'),
)
const modelTitle = computed(() =>
  __t('ui.chat', '本会话模型：{0} · {1}', [
    settings.value?.effective.name || __t('ui.chat', '未配置'),
    settings.value?.effective.modelId || __t('ui.chat', '请选择模型'),
  ]),
)
const effortTitle = computed(() =>
  __t('ui.chat', '本会话思考强度：{0}', [
    settings.value?.effective.reasoningEffort ?? __t('ui.chat', '服务商默认'),
  ]),
)

async function load(): Promise<void> {
  const id = props.threadId
  const request = ++sequence
  saving.value = false
  emit('busy', false)
  error.value = false
  if (!id) {
    settings.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    const response = await threadsApi.getModelSettings(id)
    if (request !== sequence || id !== props.threadId) return
    if (!response.data) throw new Error('未收到会话配置')
    settings.value = response.data
    emit('changed', response.data)
  } catch {
    if (request === sequence) error.value = true
  } finally {
    if (request === sequence) loading.value = false
  }
}

async function save(modelConfigId: number | null, effort: ReasoningEffort | null): Promise<void> {
  if (blocked.value || !settings.value) return
  const id = props.threadId
  const request = ++sequence
  saving.value = true
  emit('busy', true)
  try {
    const response = await threadsApi.updateModelSettings(id, {
      modelConfigId,
      reasoningEffort: effort,
    })
    if (request !== sequence || id !== props.threadId) return
    if (!response.data) throw new Error('保存失败')
    settings.value = response.data
    emit('changed', response.data)
  } catch (cause) {
    if (request === sequence)
      notify.toast(cause instanceof Error ? cause.message : __t('ui.chat', '保存失败'), 'error')
  } finally {
    if (request === sequence) {
      saving.value = false
      emit('busy', false)
    }
  }
}
function selectModel(value: string | number): void {
  const id = value === '' ? null : Number(value)
  if (id === settings.value?.modelConfigId) return
  const model = settings.value?.models.find((item) => item.id === id)
  // 更换模型后由服务端按新模型校正档位，默认项始终保留跟随语义。
  const effort = model
    ? (normalizeReasoningEffort(model.modelId, settings.value?.reasoningEffort) ?? null)
    : (settings.value?.reasoningEffort ?? null)
  void save(id, effort)
}
function selectEffort(value: string | number): void {
  void save(settings.value?.modelConfigId ?? null, value ? (value as ReasoningEffort) : null)
}
function refresh(): void {
  if (!saving.value && document.visibilityState !== 'hidden') void load()
}
watch(
  () => props.threadId,
  () => {
    settings.value = null
    void load()
  },
  { immediate: true },
)
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) refresh()
  },
)
onMounted(() => {
  window.addEventListener('infos:model-capabilities-changed', refresh)
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => {
  sequence++
  emit('busy', false)
  window.removeEventListener('infos:model-capabilities-changed', refresh)
  window.removeEventListener('focus', refresh)
})
</script>

<template>
  <div
    class="thread-model-controls"
    :aria-busy="saving || loading"
    :data-effort="rank"
    :style="{
      '--effort-distance': `${rank * 0.6}px`,
      '--effort-period': `${4.8 - rank * 0.55}s`,
      '--effort-glow': `${rank * 2}px`,
    }"
  >
    <div class="thread-model-picker" :title="modelTitle">
      <PSelect
        :model-value="modelValue"
        :options="modelOptions"
        :disabled="blocked"
        teleport
        size="sm"
        :aria-label="__t('ui.chat', '本会话模型')"
        @change="selectModel"
      >
        <template #selected>
          <span class="thread-model-line">
            <BrandIcon :brand="resolveModelBrand(settings?.effective.modelId)" size="xs" />
            <span>{{ modelValue ? settings?.effective.name : __t('ui.chat', '主模型') }}</span>
          </span>
        </template>
        <template #option="{ option }">
          <span
            class="thread-model-line"
            :title="
              settings?.models.find((model) => String(model.id) === String(option.value))
                ?.modelId || __t('ui.chat', '全局主模型')
            "
          >
            <BrandIcon :brand="modelBrands.get(String(option.value))" size="xs" />
            <span>{{ option.label }}</span>
          </span>
        </template>
      </PSelect>
    </div>
    <PSelect
      class="thread-effort-picker"
      :model-value="settings?.reasoningEffort ?? ''"
      :options="efforts"
      :disabled="blocked"
      teleport
      size="sm"
      :title="effortTitle"
      :aria-label="__t('ui.chat', '本会话思考强度')"
      @change="selectEffort"
    >
      <template #selected>
        <span class="thread-effort-label">
          <span class="thread-effort-orbit" aria-hidden="true">
            <PixelIcon
              :name="saving ? 'refresh' : 'brain'"
              :animation="saving ? 'spin' : undefined"
              size="xs"
            />
            <i />
            <i />
          </span>
          <span>{{ effortLabel }}</span>
        </span>
      </template>
    </PSelect>
    <button
      v-if="error"
      class="thread-model-retry"
      type="button"
      :title="__t('ui.chat', '配置加载失败，点击重试')"
      :aria-label="__t('ui.chat', '重新加载会话模型')"
      @click="refresh"
    >
      <PixelIcon name="refresh" size="xs" />
    </button>
  </div>
</template>

<style scoped>
.thread-model-controls {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  color: var(--ui-text-secondary);
}
.thread-model-picker {
  width: 150px;
  flex: 0 0 150px;
}
.thread-model-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.thread-model-line > span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.thread-model-controls > .thread-effort-picker {
  width: 108px;
  flex: 0 0 108px;
}
.thread-model-controls :deep(.p-select-trigger) {
  min-height: 31px;
  border-width: 1px;
  background: transparent;
  box-shadow: none;
  font-size: 11px;
}
.thread-effort-label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.thread-effort-orbit {
  position: relative;
  display: inline-flex;
  color: var(--ui-accent-purple);
}
.thread-effort-orbit i {
  position: absolute;
  width: 2px;
  height: 2px;
  background: currentColor;
  opacity: 0;
  pointer-events: none;
}
.thread-effort-orbit i:first-of-type {
  left: -4px;
  top: 0;
}
.thread-effort-orbit i:last-of-type {
  right: -4px;
  bottom: 0;
  animation-delay: -0.8s;
}
.thread-model-controls:not([data-effort='0']) .thread-effort-orbit {
  animation: effort-float var(--effort-period) ease-in-out infinite;
}
.thread-model-controls[data-effort='3'] .thread-effort-orbit,
.thread-model-controls[data-effort='4'] .thread-effort-orbit,
.thread-model-controls[data-effort='5'] .thread-effort-orbit {
  filter: drop-shadow(
    0 0 var(--effort-glow) color-mix(in srgb, var(--ui-accent-purple) 50%, transparent)
  );
}
.thread-model-controls[data-effort='4'] .thread-effort-orbit i,
.thread-model-controls[data-effort='5'] .thread-effort-orbit i {
  animation: effort-spark var(--effort-period) ease-in-out infinite;
}
.thread-model-controls .thread-effort-orbit i:last-of-type {
  animation-delay: -0.8s;
}
.thread-model-controls[data-effort='5'] .thread-effort-orbit {
  color: var(--ui-accent-primary);
}
.thread-model-retry {
  color: var(--ui-text-secondary);
  background: none;
  border: 0;
  cursor: pointer;
}
@keyframes effort-float {
  0%,
  100% {
    transform: translateY(0) rotate(0);
  }
  35% {
    transform: translateY(calc(-1 * var(--effort-distance))) rotate(-6deg);
  }
  70% {
    transform: translateY(calc(var(--effort-distance) * 0.4)) rotate(6deg);
  }
}
@keyframes effort-spark {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.5);
  }
  45% {
    opacity: 0.85;
    transform: scale(1.3);
  }
}
:global([data-motion='reduced'] .thread-effort-orbit),
:global([data-motion='off'] .thread-effort-orbit),
:global([data-motion='reduced'] .thread-effort-orbit i),
:global([data-motion='off'] .thread-effort-orbit i) {
  animation: none !important;
  filter: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .thread-effort-orbit,
  .thread-effort-orbit i {
    animation: none !important;
    filter: none !important;
  }
}
@media (max-width: 640px) {
  .thread-model-picker {
    width: 124px;
    flex-basis: 124px;
  }
  .thread-model-controls > .thread-effort-picker {
    width: 96px;
    flex-basis: 96px;
  }
}
</style>
