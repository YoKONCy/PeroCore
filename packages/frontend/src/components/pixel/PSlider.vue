<script setup lang="ts">
/**
 * PSlider — 像素风滑块
 *
 */
import PixelIcon from './PixelIcon.vue'
import { computed } from 'vue'

interface Props {
  modelValue: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** 是否显示数字输入框 */
  showInput?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  showInput: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/** 当前百分比 */
const percentage = computed(() => {
  return ((props.modelValue - props.min) / (props.max - props.min)) * 100
})

function handleInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', Number(target.value))
}
</script>

<template>
  <div :class="['p-slider-wrapper', { 'p-slider-disabled': disabled }]">
    <!-- 滑动条轨道 -->
    <div class="p-slider-track-container">
      <!-- 背景轨道 -->
      <div class="p-slider-track">
        <!-- 已填充部分 -->
        <div class="p-slider-fill" :style="{ width: `${percentage}%` }">
          <div class="p-slider-stripes" />
        </div>
      </div>

      <!-- 原生 range input (透明覆盖) -->
      <input
        type="range"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        class="p-slider-native"
        @input="handleInput"
      />

      <!-- 自定义滑块 -->
      <div class="p-slider-thumb" :style="{ left: `calc(${percentage}% - 10px)` }">
        <div class="p-slider-thumb-dot" />
        <!-- 悬浮猫爪 -->
        <div class="p-slider-paw">
          <PixelIcon name="paw" size="xs" />
        </div>
      </div>
    </div>

    <!-- 可选数字输入 -->
    <div v-if="showInput" class="p-slider-input-box">
      <input
        type="number"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        class="p-slider-input"
        @input="handleInput"
      />
    </div>
  </div>
</template>

<style scoped>
.p-slider-wrapper {
  display: flex;
  align-items: center;
  gap: 16px;
}
.p-slider-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.p-slider-track-container {
  position: relative;
  flex: 1;
  height: 24px;
  display: flex;
  align-items: center;
  user-select: none;
}

.p-slider-track {
  width: 100%;
  height: 10px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.p-slider-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-sky-light), var(--color-sky-hover));
  position: relative;
  transition: width 0.15s;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}

.p-slider-stripes {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.1) 0px,
    rgba(255, 255, 255, 0.1) 5px,
    transparent 5px,
    transparent 10px
  );
  animation: stripe-scroll 20s linear infinite;
}

.p-slider-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 20;
}

.p-slider-thumb {
  position: absolute;
  width: 20px;
  height: 20px;
  background: white;
  border: 2px solid var(--color-sky-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
  transition:
    left 0.15s,
    transform 0.2s;
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.2);
}
.p-slider-wrapper:hover .p-slider-thumb {
  transform: scale(1.1);
}
.p-slider-wrapper:active .p-slider-thumb {
  transform: scale(0.95);
}

.p-slider-thumb-dot {
  width: 8px;
  height: 8px;
  background: var(--color-sky-hover);
  animation: pulse 1.5s ease-in-out infinite;
}

.p-slider-paw {
  position: absolute;
  top: -24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  opacity: 0;
  transition: all 0.3s;
  pointer-events: none;
  color: var(--color-sky-hover);
}
.p-slider-wrapper:hover .p-slider-paw {
  opacity: 1;
  top: -28px;
}

.p-slider-input-box {
  width: 64px;
}
.p-slider-input {
  width: 100%;
  background: var(--color-bg-secondary);
  border: 2px solid var(--color-border);
  padding: 4px 8px;
  font-size: 12px;
  text-align: center;
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace;
  outline: none;
}
.p-slider-input:focus {
  border-color: var(--color-sky-500);
}

@keyframes stripe-scroll {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 100px 0;
  }
}
@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
}

/* Firefox range 样式 */
.p-slider-native::-moz-range-track {
  background: transparent;
  border: none;
}
.p-slider-native::-moz-range-thumb {
  background: transparent;
  border: none;
}
</style>
