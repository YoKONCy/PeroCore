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
  font-family: var(--font-pixel), monospace;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: 2px solid var(--color-border);
  outline: none;
  width: 100%;
  transition: border-color 0.2s;
  /* 像素风：无圆角 */
  border-radius: 0;
}

.p-input:focus {
  border-color: var(--color-blue-500);
  box-shadow: 0 0 0 1px var(--color-blue-500);
}

.p-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.p-input::placeholder {
  color: var(--color-text-muted);
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
