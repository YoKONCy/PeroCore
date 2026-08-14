<script setup lang="ts">
/**
 * PInput — 像素风输入框
 */

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'password' | 'number'
  size?: 'sm' | 'md' | 'lg'
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  type: 'text',
  size: 'md',
})

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <input
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="['p-input', `p-input-${size}`]"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.p-input {
  font-family: var(--ui-font-pixel);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  border: 2px solid var(--dash-input-border);
  outline: none;
  width: 100%;
  transition: border-color 0.2s;
  /* 像素风：无圆角 */
  border-radius: 0;
}

.p-input:focus {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 1px var(--ui-accent-sky);
}

.p-input:disabled {
  color: var(--ui-text-disabled);
  background: var(--ui-bg-surface-soft);
  cursor: not-allowed;
}

.p-input::placeholder {
  color: var(--ui-text-tertiary);
}

/* 尺寸 */
.p-input-sm {
  padding: 4px 8px;
  font-size: 12px;
}
.p-input-md {
  padding: 6px 12px;
  font-size: 14px;
}
.p-input-lg {
  padding: 10px 16px;
  font-size: 16px;
}
</style>
