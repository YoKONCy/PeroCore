<script setup lang="ts">
/**
 * PTextarea — 像素风多行文本输入
 *
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  modelValue: string
  label?: string
  icon?: string
  placeholder?: string
  rows?: number
  disabled?: boolean
  maxlength?: number
}

withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  placeholder: '',
  rows: 3,
  disabled: false,
  maxlength: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function handleInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="p-textarea-wrapper">
    <!-- 标签 -->
    <label v-if="label" class="p-textarea-label">
      <PixelIcon v-if="icon" :name="icon" size="xs" />
      {{ label }}
    </label>

    <div class="p-textarea-container">
      <textarea
        :value="modelValue"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :maxlength="maxlength"
        class="p-textarea"
        :class="{ 'p-textarea-disabled': disabled }"
        @input="handleInput"
      />

      <!-- 装饰光晕 -->
      <div class="p-textarea-glow" />

      <!-- 猫爪装饰 -->
      <div class="p-textarea-paw">
        <PixelIcon name="paw" size="xs" />
      </div>

      <!-- 底部动态线 -->
      <div class="p-textarea-underline" />
    </div>
  </div>
</template>

<style scoped>
.p-textarea-wrapper {
  width: 100%;
}

.p-textarea-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}

.p-textarea-container {
  position: relative;
  width: 100%;
}

.p-textarea {
  width: 100%;
  padding: 10px 14px;
  background: var(--color-bg-secondary);
  border: 2px solid var(--color-border);
  border-radius: 0;
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  position: relative;
  z-index: 1;
}
.p-textarea::placeholder {
  color: var(--color-text-muted);
}
.p-textarea:focus {
  border-color: var(--color-sky-500);
  box-shadow: 0 0 0 1px var(--color-sky-500);
}
.p-textarea-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 装饰光晕 */
.p-textarea-glow {
  position: absolute;
  inset: 0;
  background: var(--color-sky-500);
  opacity: 0;
  filter: blur(20px);
  pointer-events: none;
  transition: opacity 0.7s;
}
.p-textarea-container:focus-within .p-textarea-glow {
  opacity: 0.05;
}

/* 猫爪装饰 */
.p-textarea-paw {
  position: absolute;
  right: 12px;
  bottom: 10px;
  opacity: 0;
  color: var(--color-text-muted);
  pointer-events: none;
  z-index: 2;
  transition:
    opacity 0.3s,
    color 0.3s;
}
.p-textarea-container:hover .p-textarea-paw {
  opacity: 0.4;
}
.p-textarea-container:focus-within .p-textarea-paw {
  opacity: 1;
  color: var(--color-sky-hover);
}

/* 底部动态线 */
.p-textarea-underline {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-sky-hover), transparent);
  z-index: 2;
  transition: width 0.7s;
}
.p-textarea-container:focus-within .p-textarea-underline {
  width: 66%;
}

/* 滚动条样式 */
.p-textarea::-webkit-scrollbar {
  width: 4px;
}
.p-textarea::-webkit-scrollbar-track {
  background: transparent;
}
.p-textarea::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
  border-radius: 2px;
}
</style>
