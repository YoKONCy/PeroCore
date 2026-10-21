<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed } from 'vue'
import PSelect, { type SelectOption } from '../pixel/PSelect.vue'
import BrandIcon from './BrandIcon.vue'
import type { ModelBrandId } from '../../lib/modelBrands'

export interface BrandSelectOption extends SelectOption {
  brand?: ModelBrandId
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: BrandSelectOption[]
    fallback?: 'model' | 'provider'
    placeholder?: string
    disabled?: boolean
    teleport?: boolean
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { fallback: 'model', placeholder: undefined, disabled: false, teleport: false, size: 'md' },
)
const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()
// 选项较多时也只建一次映射，不为每行反复遍历远程模型列表。
const brands = computed(() => new Map(props.options.map((option) => [option.value, option.brand])))
const displayPlaceholder = computed(() => props.placeholder ?? __t('ui.brands', '请选择...'))
</script>

<template>
  <PSelect
    :model-value="modelValue"
    :options="options"
    :placeholder="displayPlaceholder"
    :disabled="disabled"
    :teleport="teleport"
    :size="size"
    @update:model-value="emit('update:modelValue', $event)"
    @change="emit('change', $event)"
  >
    <template #selected="{ option }">
      <span v-if="option" class="brand-select-line" :title="option.label">
        <BrandIcon :brand="brands.get(option.value)" :fallback="fallback" />
        <span>{{ option.label }}</span>
      </span>
      <span v-else>{{ displayPlaceholder }}</span>
    </template>
    <template #option="{ option }">
      <span class="brand-select-line" :title="option.label">
        <BrandIcon :brand="brands.get(option.value)" :fallback="fallback" />
        <span>{{ option.label }}</span>
      </span>
    </template>
  </PSelect>
</template>

<style scoped>
.brand-select-line {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.brand-select-line > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
