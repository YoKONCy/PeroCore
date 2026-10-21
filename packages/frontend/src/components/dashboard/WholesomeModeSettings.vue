<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { onMounted, ref, watch } from 'vue'
import { WHOLESOME_MODE_KEY } from '@infos/shared'
import { configApi } from '../../api/modules/configApi'
import { useDashboardContext } from '../../composables/dashboard'
import { PButton, PCard, PSwitch, PixelIcon } from '../pixel'

const ctx = useDashboardContext()
const enabled = ref(true)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
let request = 0

async function load(): Promise<void> {
  if (saving.value) return
  const version = ++request
  try {
    const response = await configApi.batch([WHOLESOME_MODE_KEY])
    if (version !== request) return
    enabled.value = response.data?.[WHOLESOME_MODE_KEY] !== 'false'
    loaded.value = true
    error.value = ''
  } catch {
    if (version === request) error.value = '读取失败，请重试'
  }
}

async function update(value: boolean): Promise<void> {
  if (!loaded.value || saving.value) return
  saving.value = true
  ++request
  error.value = ''
  try {
    await configApi.set(WHOLESOME_MODE_KEY, String(value))
    enabled.value = value
  } catch {
    error.value = '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

watch(
  () => ctx.refreshKey.value,
  () => void load(),
)
onMounted(() => void load())
</script>

<template>
  <PCard pixel padding="lg">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <h3
          class="flex items-center gap-2 text-sm font-black text-[var(--ui-text-primary)] font-pixel"
        >
          <PixelIcon name="shield" size="sm" />
          {{ __t('ui.settings', '健全模式') }}
        </h3>
        <p class="mt-2 text-xs text-[var(--ui-text-tertiary)]">
          {{ __t('ui.settings', '启用后会引导模型，避免生成限制级内容。') }}
        </p>
      </div>
      <PSwitch
        :model-value="enabled"
        :disabled="!loaded || saving"
        :aria-label="__t('ui.settings', '健全模式')"
        @update:model-value="update"
      />
    </div>
    <div
      v-if="error"
      class="mt-3 flex items-center gap-2 text-xs text-[var(--ui-text-secondary)]"
      role="alert"
    >
      <PixelIcon name="alert" size="xs" />
      <span>{{ error }}</span>
      <PButton variant="ghost" size="sm" :disabled="saving" @click="load">
        {{ __t('ui.settings', '重试') }}
      </PButton>
    </div>
  </PCard>
</template>
