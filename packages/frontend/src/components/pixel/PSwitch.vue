<script setup lang="ts">
/** PSwitch — 细描边滑轨与微立体滑块，保留轻量像素轮廓。 */

interface Props {
  modelValue: boolean
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function toggle() {
  if (props.disabled) return
  const newVal = !props.modelValue
  emit('update:modelValue', newVal)
  emit('change', newVal)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    :class="['p-switch-wrapper', `p-switch-${size}`, { 'p-switch-disabled': disabled }]"
    @click="toggle"
  >
    <span :class="['p-switch-track', { 'p-switch-on': modelValue }]" aria-hidden="true">
      <span :class="['p-switch-thumb', { 'p-switch-thumb-on': modelValue }]" />
    </span>
    <span v-if="label" class="p-switch-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.p-switch-wrapper {
  --switch-width: 42px;
  --switch-height: 24px;
  --switch-thumb: 16px;
  --switch-inset: 3px;
  --switch-travel: calc(var(--switch-width) - var(--switch-thumb) - var(--switch-inset) * 2 - 2px);
  --switch-accent: var(--ui-accent-sky);
  --switch-thumb-top: #ffffff;
  --switch-thumb-bottom: #edf0f6;
  --switch-highlight: rgba(255, 255, 255, 0.6);
  --ui-focus-color: var(--switch-accent);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  gap: 9px;
  width: fit-content;
  min-height: 32px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-secondary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
  vertical-align: middle;
  appearance: none;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.p-switch-sm {
  --switch-width: 34px;
  --switch-height: 20px;
  --switch-thumb: 12px;
  min-height: 28px;
  gap: 7px;
  font-size: 12px;
}
.p-switch-track {
  position: relative;
  box-sizing: border-box;
  display: block;
  flex: 0 0 var(--switch-width);
  width: var(--switch-width);
  height: var(--switch-height);
  border: 1px solid var(--ui-border-strong);
  border-radius: 7px;
  background: color-mix(in srgb, var(--ui-text-primary) 8%, var(--ui-bg-surface-soft));
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.1),
    0 1px 0 var(--switch-highlight);
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}
.p-switch-track::before {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, var(--switch-highlight), transparent 60%);
  opacity: 0.22;
  content: '';
  pointer-events: none;
}
.p-switch-on {
  border-color: color-mix(in srgb, var(--switch-accent) 76%, var(--ui-border-default));
  background: color-mix(in srgb, var(--switch-accent) 70%, var(--ui-bg-surface));
}
.p-switch-thumb {
  position: absolute;
  top: var(--switch-inset);
  left: var(--switch-inset);
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: var(--switch-thumb);
  height: var(--switch-thumb);
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 4px;
  background: linear-gradient(180deg, var(--switch-thumb-top), var(--switch-thumb-bottom));
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    width 140ms ease,
    box-shadow 180ms ease;
}
.p-switch-thumb::after {
  width: calc(var(--switch-thumb) * 0.25);
  height: calc(var(--switch-thumb) * 0.43);
  margin-top: -2px;
  border-right: 1.5px solid var(--switch-accent);
  border-bottom: 1.5px solid var(--switch-accent);
  opacity: 0;
  transform: rotate(45deg) scale(0.6);
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  content: '';
}
.p-switch-thumb-on {
  transform: translateX(var(--switch-travel));
  background: linear-gradient(180deg, #ffffff, #edf7ff);
}
.p-switch-thumb-on::after {
  opacity: 1;
  transform: rotate(45deg) scale(1);
}
.p-switch-sm .p-switch-track {
  border-radius: 6px;
}
.p-switch-sm .p-switch-thumb {
  border-radius: 3px;
}
.p-switch-label {
  transition: color 180ms ease;
}
.p-switch-wrapper:focus-visible {
  outline: none;
}
.p-switch-wrapper:focus-visible .p-switch-track {
  outline: 2px solid var(--switch-accent);
  outline-offset: 3px;
}
@media (hover: hover) {
  .p-switch-wrapper:not(:disabled):hover .p-switch-track {
    border-color: color-mix(in srgb, var(--switch-accent) 55%, var(--ui-border-strong));
  }
  .p-switch-wrapper:not(:disabled):hover .p-switch-label {
    color: var(--ui-text-primary);
  }
  .p-switch-wrapper:not(:disabled):hover .p-switch-thumb {
    box-shadow:
      0 2px 4px rgba(15, 23, 42, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.8);
  }
}
.p-switch-wrapper:not(:disabled):active .p-switch-thumb {
  width: calc(var(--switch-thumb) + 2px);
}
.p-switch-wrapper:not(:disabled):active .p-switch-thumb-on {
  transform: translateX(calc(var(--switch-travel) - 2px));
}
.p-switch-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
:global([data-theme='dark']) .p-switch-wrapper {
  --switch-thumb-top: #d9deea;
  --switch-thumb-bottom: #adb6c9;
  --switch-highlight: rgba(255, 255, 255, 0.12);
}
:global([data-motion='reduced']) .p-switch-thumb {
  transition: transform 100ms ease;
}
:global([data-motion='reduced']) .p-switch-wrapper:active .p-switch-thumb,
:global([data-motion='off']) .p-switch-wrapper:active .p-switch-thumb {
  width: var(--switch-thumb);
}
:global([data-motion='reduced']) .p-switch-wrapper:active .p-switch-thumb-on,
:global([data-motion='off']) .p-switch-wrapper:active .p-switch-thumb-on {
  transform: translateX(var(--switch-travel));
}
@media (prefers-reduced-motion: reduce) {
  .p-switch-track,
  .p-switch-thumb,
  .p-switch-thumb::after,
  .p-switch-label {
    transition: none;
  }
  .p-switch-wrapper:not(:disabled):active .p-switch-thumb {
    width: var(--switch-thumb);
  }
  .p-switch-wrapper:not(:disabled):active .p-switch-thumb-on {
    transform: translateX(var(--switch-travel));
  }
}
</style>
