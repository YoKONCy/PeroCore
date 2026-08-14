<script setup lang="ts">
/**
 * PCheckbox — 像素风复选框
 *
 */
import { computed } from 'vue'
import PixelIcon from './PixelIcon.vue'

interface Props {
  modelValue?: boolean
  label?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  label: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

const isChecked = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit('update:modelValue', val)
    emit('change', val)
  },
})

function toggle() {
  if (props.disabled) return
  isChecked.value = !isChecked.value
}
</script>

<template>
  <div :class="['p-checkbox-wrapper', { 'p-checkbox-disabled': disabled }]" @click="toggle">
    <!-- 复选框主体 -->
    <div :class="['p-checkbox-box', { 'p-checkbox-checked': isChecked }]">
      <PixelIcon v-if="isChecked" name="check" size="xs" class="p-checkbox-icon" />
      <!-- 未勾选悬浮猫爪 -->
      <div v-if="!isChecked" class="p-checkbox-hover-hint">
        <PixelIcon name="paw" size="xs" />
      </div>
    </div>

    <!-- 标签 -->
    <span v-if="label || $slots.default" class="p-checkbox-label">
      <slot>{{ label }}</slot>
    </span>
  </div>
</template>

<style scoped>
.p-checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.p-checkbox-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.p-checkbox-box {
  width: 20px;
  height: 20px;
  border: 2px solid var(--ui-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  position: relative;
  overflow: hidden;
  background: var(--dash-input-bg);
}
.p-checkbox-wrapper:not(.p-checkbox-disabled):hover .p-checkbox-box {
  border-color: var(--ui-accent-sky);
}
.p-checkbox-wrapper:active .p-checkbox-box {
  transform: scale(0.9);
}

.p-checkbox-checked {
  background: var(--ui-accent-sky);
  border-color: var(--ui-accent-sky);
  color: var(--ui-text-inverse);
  box-shadow: var(--ui-glow-sky);
}

.p-checkbox-icon {
  animation: zoom-in 0.3s ease-out;
}

.p-checkbox-hover-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  color: var(--ui-accent-sky);
  transition: opacity 0.2s;
}
.p-checkbox-wrapper:hover .p-checkbox-hover-hint {
  opacity: 0.3;
}

.p-checkbox-label {
  font-size: 14px;
  color: var(--ui-text-secondary);
  transition: color 0.2s;
}
.p-checkbox-wrapper:hover .p-checkbox-label {
  color: var(--color-sky-500);
}

@keyframes zoom-in {
  from {
    transform: scale(0.3);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
