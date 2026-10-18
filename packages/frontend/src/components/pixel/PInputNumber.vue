<script setup lang="ts">
/**
 * PInputNumber — 像素风数字输入
 *
 */

interface Props {
  modelValue: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  label?: string
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  min: -Infinity,
  max: Infinity,
  step: 1,
  disabled: false,
  label: '',
  placeholder: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

function clampAndEmit(val: number) {
  const clamped = Math.min(Math.max(val, props.min), props.max)
  emit('update:modelValue', clamped)
}

function increment() {
  if (props.disabled) return
  clampAndEmit((props.modelValue ?? 0) + props.step)
}

function decrement() {
  if (props.disabled) return
  clampAndEmit((props.modelValue ?? 0) - props.step)
}

function handleInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.value === '') {
    emit('update:modelValue', null)
    return
  }
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
        :value="modelValue ?? ''"
        :min="min"
        :max="max"
        :step="step"
        :placeholder="placeholder"
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
  color: var(--ui-text-tertiary);
}

.p-input-number {
  display: flex;
  min-width: 0;
  border: 2px solid var(--dash-input-border);
  overflow: hidden;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard);
}
.p-input-number:not(.p-input-number-disabled):hover {
  border-color: var(--ui-border-strong);
}
.p-input-number:not(.p-input-number-disabled):focus-within {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 1px var(--ui-accent-sky);
}
.p-input-number-disabled {
  color: var(--ui-text-disabled);
  pointer-events: none;
}

.p-input-number-btn {
  --ui-focus-color: var(--ui-accent-sky);
  flex-shrink: 0;
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-bg-hover);
  border: none;
  color: var(--ui-text-primary);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard);
  user-select: none;
}
.p-input-number-btn:focus-visible {
  outline-offset: -2px;
}
.p-input-number-btn:hover:not(:disabled) {
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}
.p-input-number-btn:active:not(:disabled) {
  background: var(--ui-bg-active);
}

.p-input-number-input {
  flex: 1;
  min-width: 0;
  text-align: center;
  border: none;
  border-left: 1px solid var(--dash-input-border);
  border-right: 1px solid var(--dash-input-border);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  font-family: var(--ui-font-pixel);
  font-size: 13px;
  padding: 4px;
  outline: none;
  caret-color: var(--ui-accent-sky);
  -moz-appearance: textfield;
}
.p-input-number-input::-webkit-inner-spin-button,
.p-input-number-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
