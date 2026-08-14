<script setup lang="ts">
/**
 * PDatePicker — 像素风日期选择器
 *
 * 包裹原生 <input type="date">，应用像素风样式。
 *
 * @props modelValue - 日期字符串 (YYYY-MM-DD)
 * @emits update:modelValue - 日期变化
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** 处理日期选择 */
function handleInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div :class="['p-datepicker', { 'p-datepicker-disabled': disabled }]">
    <PixelIcon name="calendar" size="sm" class="p-datepicker-icon" />
    <input
      type="date"
      :value="modelValue"
      :disabled="disabled"
      class="p-datepicker-input"
      @input="handleInput"
    />
  </div>
</template>

<style scoped>
.p-datepicker {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 2px solid var(--dash-input-border);
  background: var(--dash-input-bg);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.p-datepicker:focus-within {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 2px var(--ui-accent-sky-soft);
}
.p-datepicker-disabled {
  color: var(--ui-text-disabled);
  background: var(--ui-bg-surface-soft);
  cursor: not-allowed;
}

.p-datepicker-icon {
  color: var(--ui-text-tertiary);
  flex-shrink: 0;
  transition: color 0.15s;
}
.p-datepicker:focus-within .p-datepicker-icon {
  color: var(--ui-accent-sky);
}

.p-datepicker-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ui-text-primary);
  color-scheme: light dark;
  font-family: var(--ui-font-sans);
  font-size: 13px;
  font-weight: 700;
  outline: none;
  cursor: pointer;
}
.p-datepicker-input:disabled {
  cursor: not-allowed;
}

/* 隐藏原生日期选择器图标 */
.p-datepicker-input::-webkit-inner-spin-button,
.p-datepicker-input::-webkit-clear-button {
  display: none;
}
.p-datepicker-input::-webkit-calendar-picker-indicator {
  opacity: 0;
  position: absolute;
  inset: 0;
  cursor: pointer;
}
</style>
