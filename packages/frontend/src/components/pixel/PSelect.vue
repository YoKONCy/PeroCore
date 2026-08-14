<script setup lang="ts">
/**
 * PSelect — 像素风下拉选择器
 *
 * - CSS 变量色值 (取代硬编码 sky-400)
 * - useEventListener 管理点击外部关闭
 * - TypeScript strict
 */
import { ref, computed } from 'vue'
import PixelIcon from './PixelIcon.vue'
import { useEventListener } from '../../composables'

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  icon?: string
}

interface Props {
  modelValue: string | number
  options: SelectOption[]
  label?: string
  icon?: string
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  placeholder: '请选择...',
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const selectedOption = computed(() => props.options.find((opt) => opt.value === props.modelValue))

function toggleDropdown() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function selectOption(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  isOpen.value = false
}

// 点击外部关闭
useEventListener(document as unknown as EventTarget, 'click', (e: Event) => {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
})
</script>

<template>
  <div ref="containerRef" class="p-select-wrapper">
    <!-- 标签 -->
    <label v-if="label" class="p-select-label">
      <PixelIcon v-if="icon" :name="icon" size="xs" />
      {{ label }}
    </label>

    <div class="p-select-container">
      <button
        type="button"
        :class="['p-select-trigger', `p-select-${size}`, { 'p-select-open': isOpen }]"
        :disabled="disabled"
        @click="toggleDropdown"
      >
        <span :class="selectedOption ? 'p-select-value' : 'p-select-placeholder'">
          <PixelIcon v-if="selectedOption?.icon" :name="selectedOption.icon" size="xs" />
          {{ selectedOption?.label || placeholder }}
        </span>
        <PixelIcon
          name="chevron-down"
          size="xs"
          :class="['p-select-arrow', { 'p-select-arrow-open': isOpen }]"
        />
      </button>

      <Transition name="select-dropdown">
        <div v-if="isOpen" class="p-select-dropdown">
          <div class="p-select-options">
            <div
              v-for="option in options"
              :key="option.value"
              :class="[
                'p-select-option',
                { 'p-select-option-active': modelValue === option.value },
                { 'p-select-option-disabled': option.disabled },
              ]"
              @click="selectOption(option)"
            >
              <div class="p-select-option-content">
                <PixelIcon v-if="option.icon" :name="option.icon" size="xs" />
                {{ option.label }}
              </div>
              <PixelIcon
                v-if="modelValue === option.value"
                name="check"
                size="xs"
                class="p-select-check"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.p-select-wrapper {
  width: 100%;
}

.p-select-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ui-text-tertiary);
}

.p-select-container {
  position: relative;
  width: 100%;
}

.p-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--dash-input-bg);
  border: 2px solid var(--dash-input-border);
  border-radius: 0;
  color: var(--ui-text-primary);
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  font-family: var(--ui-font-pixel);
}
.p-select-trigger:hover:not(:disabled) {
  border-color: var(--ui-accent-sky);
}
.p-select-trigger:disabled {
  color: var(--ui-text-disabled);
  background: var(--ui-bg-surface-soft);
  cursor: not-allowed;
}
.p-select-open {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 1px var(--ui-accent-sky);
}

.p-select-sm {
  padding: 4px 8px;
  font-size: 12px;
}
.p-select-md {
  padding: 6px 12px;
  font-size: 14px;
}
.p-select-lg {
  padding: 10px 16px;
  font-size: 16px;
}

.p-select-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.p-select-placeholder {
  color: var(--ui-text-tertiary);
}

.p-select-arrow {
  color: var(--ui-text-secondary);
  transition: transform 0.3s;
}
.p-select-arrow-open {
  transform: rotate(180deg);
  color: var(--ui-accent-sky);
}

.p-select-dropdown {
  position: absolute;
  z-index: 50;
  width: 100%;
  margin-top: 4px;
  background: var(--dash-panel-elevated);
  border: 2px solid var(--ui-border-strong);
  box-shadow: var(--ui-shadow-md);
  max-height: 240px;
  overflow-y: auto;
}

.p-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  color: var(--ui-text-secondary);
}
.p-select-option:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-accent-sky);
}
.p-select-option-active {
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  font-weight: 700;
}
.p-select-option-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.p-select-option-content {
  display: flex;
  align-items: center;
  gap: 8px;
}
.p-select-check {
  color: var(--ui-accent-sky);
}

/* 下拉动画 */
.select-dropdown-enter-active {
  transition: all 0.1s ease-out;
}
.select-dropdown-leave-active {
  transition: all 0.075s ease-in;
}
.select-dropdown-enter-from,
.select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
