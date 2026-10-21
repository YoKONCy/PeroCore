<script setup lang="ts">
import { t as __t } from '../../i18n/index'

/**
 * PSelect — 像素风下拉选择器
 *
 * - CSS 变量色值 (取代硬编码 sky-400)
 * - useEventListener 管理点击外部关闭
 * - TypeScript strict
 */
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import PixelIcon from './PixelIcon.vue'
import { useEventListener } from '../../composables'
import { useMobileLayout } from '../../composables/ui/useMobileLayout'

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
  /** 将菜单传送到 body，避免被弹窗或滚动容器裁剪。 */
  teleport?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  placeholder: undefined,
  disabled: false,
  size: 'md',
  teleport: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const isOpen = ref(false)
const displayPlaceholder = computed(() => props.placeholder ?? __t('ui.pixel', '请选择...'))
const containerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})
const { isMobile } = useMobileLayout()
const shouldTeleport = computed(() => props.teleport || isMobile.value)

function updateDropdownPosition(): void {
  if (!shouldTeleport.value || !containerRef.value) return
  const trigger = containerRef.value.querySelector('.p-select-trigger') as HTMLElement | null
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const visibleHeight = window.visualViewport?.height || window.innerHeight
  const availableBelow = visibleHeight - rect.bottom - 12
  const availableAbove = rect.top - 12
  const openAbove = availableBelow < 180 && availableAbove > availableBelow
  const maxHeight = Math.max(120, Math.min(240, openAbove ? availableAbove : availableBelow))
  dropdownStyle.value = {
    position: 'fixed',
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(rect.width, window.innerWidth - 16) - 8))}px`,
    width: `${Math.min(rect.width, window.innerWidth - 16)}px`,
    maxHeight: `${maxHeight}px`,
    ...(openAbove
      ? { bottom: `${window.innerHeight - rect.top + 4}px`, top: 'auto' }
      : { top: `${rect.bottom + 4}px`, bottom: 'auto' }),
  }
}

function closeDropdown(): void {
  isOpen.value = false
}

function handleViewportChange(): void {
  if (isOpen.value) updateDropdownPosition()
}

const selectedOption = computed(() => props.options.find((opt) => opt.value === props.modelValue))

function toggleDropdown() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value && shouldTeleport.value) void nextTick(updateDropdownPosition)
}

function selectOption(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  isOpen.value = false
}

// 点击外部关闭
useEventListener(document as unknown as EventTarget, 'click', (e: Event) => {
  const target = e.target as Node
  if (
    containerRef.value &&
    !containerRef.value.contains(target) &&
    !dropdownRef.value?.contains(target)
  ) {
    closeDropdown()
  }
})
useEventListener(window, 'resize', handleViewportChange)
if (window.visualViewport) useEventListener(window.visualViewport, 'resize', handleViewportChange)
useEventListener(document, 'scroll', handleViewportChange, { capture: true, passive: true })
onBeforeUnmount(closeDropdown)
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
          <slot name="selected" :option="selectedOption">
            <PixelIcon v-if="selectedOption?.icon" :name="selectedOption.icon" size="xs" />
            {{ selectedOption?.label || displayPlaceholder }}
          </slot>
        </span>
        <PixelIcon
          name="chevron-down"
          size="xs"
          :class="['p-select-arrow', { 'p-select-arrow-open': isOpen }]"
        />
      </button>

      <Teleport to="body" :disabled="!shouldTeleport">
        <Transition name="select-dropdown">
          <div
            v-if="isOpen"
            ref="dropdownRef"
            :class="['p-select-dropdown', { 'p-select-dropdown-teleported': shouldTeleport }]"
            :style="shouldTeleport ? dropdownStyle : undefined"
          >
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
                  <slot name="option" :option="option" :selected="modelValue === option.value">
                    <PixelIcon v-if="option.icon" :name="option.icon" size="xs" />
                    {{ option.label }}
                  </slot>
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
      </Teleport>
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
  --ui-focus-color: var(--ui-accent-sky);
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  background: var(--dash-input-bg);
  border: 2px solid var(--dash-input-border);
  border-radius: 0;
  color: var(--ui-text-primary);
  cursor: pointer;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard),
    background-color var(--ui-duration-fast) var(--ui-ease-standard);
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
.p-select-value,
.p-select-placeholder,
.p-select-option-content {
  min-width: 0;
  text-align: left;
  overflow-wrap: anywhere;
}
.p-select-value :deep(.pixel-icon),
.p-select-option-content :deep(.pixel-icon) {
  flex-shrink: 0;
}
.p-select-placeholder {
  color: var(--ui-text-tertiary);
}

.p-select-arrow {
  flex-shrink: 0;
  color: var(--ui-text-secondary);
  transition:
    transform var(--ui-duration-normal) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard);
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
  overscroll-behavior: contain;
  transform-origin: top center;
}

.p-select-dropdown-teleported {
  z-index: 10020;
  margin-top: 0;
}

.p-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard);
  color: var(--ui-text-secondary);
}
.p-select-option:hover:not(.p-select-option-disabled) {
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
  flex-shrink: 0;
  color: var(--ui-accent-sky);
}

/* 下拉动画 */
.select-dropdown-enter-active {
  transition:
    opacity var(--ui-duration-fast) var(--ui-ease-standard),
    transform var(--ui-duration-fast) var(--ui-ease-standard);
}
.select-dropdown-leave-active {
  transition:
    opacity var(--ui-duration-instant) var(--ui-ease-standard),
    transform var(--ui-duration-instant) var(--ui-ease-standard);
}
.select-dropdown-enter-from,
.select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--ui-motion-distance-sm)));
}
</style>
