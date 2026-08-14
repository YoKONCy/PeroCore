<script setup lang="ts">
/**
 * PSwitch — 像素风开关
 *
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  modelValue: boolean
  label?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  disabled: false,
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
  <div :class="['p-switch-wrapper', { 'p-switch-disabled': disabled }]" @click="toggle">
    <!-- 开关轨道 -->
    <div :class="['p-switch-track', { 'p-switch-on': modelValue }]">
      <!-- 滑块 -->
      <div :class="['p-switch-thumb', { 'p-switch-thumb-on': modelValue }]">
        <div v-if="modelValue" class="p-switch-thumb-icon">
          <PixelIcon name="paw" size="xs" />
        </div>
      </div>
    </div>

    <!-- 标签 -->
    <span v-if="label" class="p-switch-label">
      {{ label }}
      <span v-if="modelValue" class="p-switch-sparkle">
        <PixelIcon name="sparkle" size="xs" />
      </span>
    </span>
  </div>
</template>

<style scoped>
.p-switch-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  transition: all 0.5s;
}
.p-switch-wrapper:active {
  transform: scale(0.95);
}
.p-switch-disabled {
  color: var(--ui-text-disabled);
  cursor: not-allowed;
}

.p-switch-track {
  position: relative;
  width: 44px;
  height: 24px;
  background: var(--ui-bg-hover);
  border: 2px solid var(--ui-border-strong);
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.p-switch-track.p-switch-on {
  background: var(--ui-accent-sky-soft);
  border-color: var(--ui-accent-sky);
}

.p-switch-thumb {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  background: var(--ui-bg-surface);
  border: 1px solid var(--ui-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: var(--ui-shadow-xs);
}
.p-switch-thumb-on {
  transform: translateX(20px);
}

.p-switch-thumb-icon {
  color: var(--ui-accent-sky);
  transition: all 0.5s;
  animation: pixel-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.p-switch-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ui-text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.3s;
}
.p-switch-wrapper:hover .p-switch-label {
  color: var(--color-sky-500);
}

.p-switch-sparkle {
  font-size: 10px;
  animation: bounce 1s infinite;
}

@keyframes pixel-pop {
  0% {
    transform: scale(0.5) rotate(-45deg);
    opacity: 0;
  }
  100% {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}
@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}
</style>
