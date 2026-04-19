<script setup lang="ts">
/**
 * PInputNumber — 像素风数字输入
 *
 * 迁移自 v1，加减按钮 + 像素风格。
 */

interface Props {
  modelValue: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  min: -Infinity,
  max: Infinity,
  step: 1,
  disabled: false,
  label: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function clampAndEmit(val: number) {
  const clamped = Math.min(Math.max(val, props.min), props.max)
  emit('update:modelValue', clamped)
}

function increment() {
  if (props.disabled) return
  clampAndEmit(props.modelValue + props.step)
}

function decrement() {
  if (props.disabled) return
  clampAndEmit(props.modelValue - props.step)
}

function handleInput(e: Event) {
  const target = e.target as HTMLInputElement
  const val = Number(target.value)
  if (!isNaN(val)) clampAndEmit(val)
}
</script>

<template>
  <div class="p-input-number-wrapper">
    <label v-if="label" class="p-input-number-label">{{ label }}</label>
    <div :class="['p-input-number', { 'p-input-number-disabled': disabled }]">
      <button class="p-input-number-btn" :disabled="disabled" @click="decrement">−</button>
      <input
        type="number"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        class="p-input-number-input"
        @input="handleInput"
      />
      <button class="p-input-number-btn" :disabled="disabled" @click="increment">+</button>
    </div>
  </div>
</template>

<style scoped>
.p-input-number-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.p-input-number-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}

.p-input-number {
  display: flex;
  border: 2px solid var(--color-border);
  overflow: hidden;
}
.p-input-number-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.p-input-number-btn {
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover);
  border: none;
  color: var(--color-text-primary);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}
.p-input-number-btn:hover:not(:disabled) {
  background: var(--color-blue-100);
  color: var(--color-blue-600);
}
.p-input-number-btn:active:not(:disabled) {
  background: var(--color-blue-200);
}

.p-input-number-input {
  flex: 1;
  min-width: 0;
  text-align: center;
  border: none;
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace;
  font-size: 13px;
  padding: 4px;
  outline: none;
  -moz-appearance: textfield;
}
.p-input-number-input::-webkit-inner-spin-button,
.p-input-number-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
