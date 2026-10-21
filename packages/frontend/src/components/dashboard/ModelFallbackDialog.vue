<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PButton, PDialog, PixelIcon } from '../pixel'
import BrandIcon from '../brands/BrandIcon.vue'
import BrandSelect from '../brands/BrandSelect.vue'
import { resolveModelBrand } from '../../lib/modelBrands'
import { modelApi } from '../../api/modules/modelApi'
import { useNotificationStore } from '../../stores/useNotificationStore'

type Model = { id: string; name: string; modelId: string; provider: string }
const props = defineProps<{ model: Model | null; models: Model[] }>()
const emit = defineEmits<{ close: [] }>()
const notify = useNotificationStore()
const ids = ref<number[]>([])
const choice = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let sequence = 0
const visible = computed({
  get: () => !!props.model,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})
const selection = computed({
  get: () => choice.value,
  set: (value: string | number) => {
    choice.value = String(value)
  },
})
const options = computed(() =>
  props.models
    .filter((model) => model.id !== props.model?.id && !ids.value.includes(Number(model.id)))
    .map((model) => ({
      value: model.id,
      label: `${model.name} · ${model.modelId}`,
      brand: resolveModelBrand(model.modelId),
    })),
)
const chain = computed(() =>
  ids.value.map((id) => ({
    id,
    model: props.models.find((model) => Number(model.id) === id),
  })),
)

watch(
  () => props.model?.id,
  async (id) => {
    const current = ++sequence
    ids.value = []
    choice.value = ''
    error.value = ''
    loading.value = !!id
    if (!id) return
    try {
      const response = await modelApi.getFallbacks(id)
      if (current === sequence) ids.value = response.data?.modelIds ?? []
    } catch (failure) {
      if (current === sequence) error.value = (failure as Error).message
    } finally {
      if (current === sequence) loading.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  sequence++
})

function add(): void {
  const id = Number(choice.value)
  if (!options.value.some((option) => Number(option.value) === id) || ids.value.length >= 32) return
  ids.value.push(id)
  choice.value = ''
}
function move(index: number, offset: number): void {
  const next = index + offset
  if (next < 0 || next >= ids.value.length) return
  const value = ids.value.splice(index, 1)[0]!
  ids.value.splice(next, 0, value)
}
async function save(): Promise<void> {
  if (!props.model || loading.value || saving.value || error.value) return
  saving.value = true
  try {
    await modelApi.setFallbacks(props.model.id, [...ids.value])
    notify.toast(__t('ui.settings', '模型回退顺序已保存'), 'success')
    emit('close')
  } catch (failure) {
    notify.toast(__t('ui.settings', '保存回退配置失败：{0}', [(failure as Error).message]), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <PDialog
    v-model="visible"
    :title="__t('ui.settings', '多级模型回退')"
    width="min(600px, calc(100vw - 32px))"
    :loading="saving"
    :auto-close="false"
  >
    <div class="fallback-config" :aria-busy="loading">
      <p class="fallback-help">
        <PixelIcon name="refresh" size="sm" aria-hidden="true" />
        {{ __t('ui.settings', '每个模型尝试两次，失败后依次切换。') }}
      </p>
      <TransitionGroup tag="ol" name="fallback-chain" class="fallback-list">
        <li key="primary" class="fallback-item fallback-primary">
          <span class="fallback-level" :aria-label="__t('ui.settings', '第 {0} 级', [1])">01</span>
          <span class="fallback-brand">
            <BrandIcon :brand="resolveModelBrand(model?.modelId)" size="md" />
          </span>
          <div class="fallback-model">
            <strong :title="model?.name">{{ model?.name }}</strong>
            <small :title="model?.modelId">{{ model?.modelId }}</small>
          </div>
          <span class="fallback-badge">
            <PixelIcon name="check" size="xs" aria-hidden="true" />
            {{ __t('ui.settings', '当前模型') }}
          </span>
        </li>
        <template v-if="!loading && !error">
          <li v-for="(entry, index) in chain" :key="entry.id" class="fallback-item">
            <span class="fallback-level" :aria-label="__t('ui.settings', '第 {0} 级', [index + 2])">
              {{ String(index + 2).padStart(2, '0') }}
            </span>
            <span class="fallback-brand">
              <BrandIcon :brand="resolveModelBrand(entry.model?.modelId)" size="md" />
            </span>
            <div class="fallback-model" :class="{ 'is-missing': !entry.model }">
              <strong :title="entry.model?.name">
                {{ entry.model?.name ?? __t('ui.settings', '模型已删除') }}
              </strong>
              <small :title="entry.model?.modelId">{{ entry.model?.modelId ?? entry.id }}</small>
            </div>
            <div class="fallback-controls">
              <PButton
                size="sm"
                variant="ghost"
                :disabled="saving || index === 0"
                :aria-label="__t('ui.settings', '上移')"
                :title="__t('ui.settings', '上移')"
                @click="move(index, -1)"
              >
                <PixelIcon name="chevron-up" size="sm" aria-hidden="true" />
              </PButton>
              <PButton
                size="sm"
                variant="ghost"
                :disabled="saving || index === chain.length - 1"
                :aria-label="__t('ui.settings', '下移')"
                :title="__t('ui.settings', '下移')"
                @click="move(index, 1)"
              >
                <PixelIcon name="chevron-down" size="sm" aria-hidden="true" />
              </PButton>
              <PButton
                size="sm"
                variant="ghost"
                class="fallback-remove"
                :disabled="saving"
                :aria-label="__t('ui.settings', '移除')"
                :title="__t('ui.settings', '移除')"
                @click="ids.splice(index, 1)"
              >
                <PixelIcon name="trash" size="sm" aria-hidden="true" />
              </PButton>
            </div>
          </li>
        </template>
      </TransitionGroup>
      <p v-if="loading" class="fallback-state" role="status">
        <PixelIcon name="loader" size="sm" animation="spin" aria-hidden="true" />
        {{ __t('ui.settings', '正在读取配置…') }}
      </p>
      <p v-else-if="error" class="fallback-state fallback-error" role="alert">
        <PixelIcon name="alert" size="sm" aria-hidden="true" />
        {{ __t('ui.settings', '读取回退配置失败：{0}', [error]) }}
      </p>
      <template v-else>
        <p v-if="!chain.length" class="fallback-empty">{{ __t('ui.settings', '暂无备用模型') }}</p>
        <div v-if="ids.length < 32" class="fallback-add">
          <BrandSelect
            v-model="selection"
            :options="options"
            teleport
            size="sm"
            :placeholder="__t('ui.settings', '选择备用模型')"
            :disabled="saving || !options.length"
          />
          <PButton size="sm" variant="secondary" :disabled="saving || !choice" @click="add">
            <PixelIcon name="plus" size="sm" aria-hidden="true" />
            {{ __t('ui.settings', '添加') }}
          </PButton>
        </div>
      </template>
    </div>
    <template #footer>
      <PButton size="sm" variant="ghost" :disabled="saving" @click="visible = false">
        {{ __t('ui.settings', '取消') }}
      </PButton>
      <PButton size="sm" :disabled="loading || !!error" :loading="saving" @click="save">
        <PixelIcon v-if="!saving" name="save" size="sm" aria-hidden="true" />
        {{ saving ? __t('ui.settings', '保存中…') : __t('ui.settings', '保存') }}
      </PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.fallback-config {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.fallback-help,
.fallback-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
.fallback-help > .pixel-icon,
.fallback-state > .pixel-icon {
  flex-shrink: 0;
}
.fallback-help > .pixel-icon {
  color: var(--ui-accent-purple);
}
.fallback-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.fallback-item {
  position: relative;
  display: grid;
  grid-template-columns: 24px 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 4px;
  background: var(--ui-bg-surface-soft);
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    background-color var(--ui-duration-fast) var(--ui-ease-standard);
}
.fallback-item:hover {
  border-color: var(--ui-border-default);
  background-color: var(--ui-bg-hover);
}
.fallback-primary {
  border-color: color-mix(in srgb, var(--ui-accent-purple) 22%, var(--ui-border-subtle));
  background:
    linear-gradient(
      100deg,
      color-mix(in srgb, var(--ui-accent-purple) 7%, transparent),
      transparent 75%
    ),
    var(--ui-bg-surface-soft);
}
.fallback-primary::before {
  content: '';
  position: absolute;
  inset: 14px auto 14px -1px;
  width: 3px;
  border-radius: 2px;
  background: var(--ui-accent-purple);
}
.fallback-level {
  color: var(--ui-text-tertiary);
  text-align: center;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.fallback-primary .fallback-level {
  color: var(--ui-accent-purple);
}
.fallback-brand {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 4px;
  background: var(--ui-bg-surface);
}
.fallback-model {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}
.fallback-model strong,
.fallback-model small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fallback-model strong {
  color: var(--ui-text-primary);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.5;
}
.fallback-model small {
  color: var(--ui-text-tertiary);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  line-height: 1.5;
}
.fallback-model.is-missing strong {
  color: var(--ui-warning);
}
.fallback-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ui-accent-purple) 9%, transparent);
  color: var(--ui-accent-purple);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
}
.fallback-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}
.fallback-controls > .p-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-width: 1px;
  border-radius: 3px;
  color: var(--ui-text-tertiary);
}
.fallback-controls > .p-btn:hover:not(:disabled) {
  color: var(--ui-accent-purple);
}
.fallback-controls > .fallback-remove:hover:not(:disabled) {
  color: var(--ui-danger);
  background: color-mix(in srgb, var(--ui-danger) 9%, transparent);
}
.fallback-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border-subtle);
}
.fallback-add > .p-btn {
  align-self: stretch;
  white-space: nowrap;
}
.fallback-empty {
  margin: 0;
  padding: 0 10px;
  color: var(--ui-text-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
.fallback-error {
  align-items: flex-start;
  color: var(--ui-danger);
  overflow-wrap: anywhere;
}
.fallback-error > .pixel-icon {
  margin-top: 2px;
}
.fallback-chain-move,
.fallback-chain-enter-active,
.fallback-chain-leave-active {
  transition:
    transform var(--ui-duration-normal) var(--ui-ease-standard),
    opacity var(--ui-duration-fast) var(--ui-ease-standard);
}
.fallback-chain-enter-from,
.fallback-chain-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.fallback-chain-leave-active {
  position: absolute;
  width: 100%;
}
@media (max-width: 480px) {
  .fallback-item {
    grid-template-columns: 20px 28px minmax(0, 1fr);
    gap: 8px;
  }
  .fallback-brand {
    width: 28px;
    height: 28px;
  }
  .fallback-controls,
  .fallback-badge {
    grid-column: 3;
    justify-self: end;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fallback-item,
  .fallback-chain-move,
  .fallback-chain-enter-active,
  .fallback-chain-leave-active {
    transition: none;
  }
}
</style>
