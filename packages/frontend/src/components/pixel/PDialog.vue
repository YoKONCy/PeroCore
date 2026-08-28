<script setup lang="ts">
/**
 * PDialog — 像素风通用对话框
 *
 * 支持两种用法:
 * 1. 简单确认: visible + title + message + @confirm/@cancel
 * 2. 自定义内容: visible + title + default slot + #footer slot
 *
 * 支持 v-model 绑定 (v-model = :visible + @update:visible)
 */

interface Props {
  /** 控制显示/隐藏 (支持 v-model) */
  modelValue: boolean
  title?: string
  message?: string
  mode?: 'confirm' | 'prompt'
  confirmText?: string
  cancelText?: string
  placeholder?: string
  defaultValue?: string
  confirmVariant?: 'primary' | 'danger'
  /** 自定义宽度 */
  width?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '确认',
  message: '',
  mode: 'confirm',
  confirmText: '确定',
  cancelText: '取消',
  placeholder: '',
  defaultValue: '',
  confirmVariant: 'primary',
  width: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [value?: string]
  cancel: []
}>()

import { ref, watch, useSlots } from 'vue'
import PButton from './PButton.vue'

const slots = useSlots()
const inputValue = ref(props.defaultValue)
const overlayPointerDown = ref(false)

watch(
  () => props.modelValue,
  (val) => {
    if (val) inputValue.value = props.defaultValue
  },
)

function handleConfirm() {
  if (props.mode === 'prompt') {
    emit('confirm', inputValue.value)
  } else {
    emit('confirm')
  }
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}

/** 仅在按下和松开都发生于遮罩时关闭，避免从输入框拖选文字后误关闭。 */
function handleOverlayPointerDown(event: PointerEvent): void {
  overlayPointerDown.value = event.target === event.currentTarget
}

function handleOverlayClick(event: MouseEvent): void {
  const shouldClose =
    event.target === event.currentTarget && (overlayPointerDown.value || event.detail === 0)
  overlayPointerDown.value = false
  if (shouldClose) handleCancel()
}

/** 关闭按钮只关闭窗口，取消按钮和遮罩点击才触发取消业务。 */
function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="modelValue"
        class="p-dialog-overlay"
        @pointerdown="handleOverlayPointerDown"
        @click="handleOverlayClick"
      >
        <div class="p-dialog" :style="width ? { minWidth: width, maxWidth: width } : {}">
          <div class="p-dialog-header">
            <span>{{ title }}</span>
            <button class="p-dialog-close" @click="close">✕</button>
          </div>

          <div class="p-dialog-body">
            <p v-if="message" class="p-dialog-message">{{ message }}</p>
            <input
              v-if="mode === 'prompt'"
              v-model="inputValue"
              :placeholder="placeholder"
              class="p-dialog-input"
              @keydown.enter="handleConfirm"
            />
            <!-- 自定义内容 slot -->
            <slot />
          </div>

          <!-- 自定义 footer 或 默认按钮 -->
          <div class="p-dialog-footer">
            <template v-if="slots.footer">
              <slot name="footer" />
            </template>
            <template v-else>
              <PButton variant="secondary" size="sm" @click="handleCancel">
                {{ cancelText }}
              </PButton>
              <PButton :variant="confirmVariant" size="sm" @click="handleConfirm">
                {{ confirmText }}
              </PButton>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.p-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-overlay-backdrop);
  backdrop-filter: blur(var(--ui-overlay-blur));
}

.p-dialog {
  min-width: 340px;
  max-width: 560px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ui-text-primary);
  background: var(--dash-panel-bg);
  border: 3px solid var(--ui-border-strong);
  box-shadow: var(--ui-shadow-lg);
}

.p-dialog-header {
  padding: 12px 16px;
  border-bottom: 2px solid var(--ui-border-default);
  font-weight: 700;
  font-size: 15px;
  color: var(--ui-text-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.p-dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ui-text-tertiary);
  font-size: 14px;
  padding: 2px 6px;
  transition: color 0.15s;
}
.p-dialog-close:hover {
  color: var(--ui-text-primary);
}

.p-dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
}
.p-dialog-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ui-text-secondary);
  margin-bottom: 12px;
}

.p-dialog-input {
  width: 100%;
  padding: 6px 12px;
  border: 2px solid var(--dash-input-border);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  font-family: var(--ui-font-pixel);
  font-size: 14px;
  outline: none;
}
.p-dialog-input::placeholder {
  color: var(--ui-text-tertiary);
}
.p-dialog-input:focus {
  border-color: var(--ui-accent-sky);
}

.p-dialog-footer {
  padding: 12px 16px;
  border-top: 2px solid var(--ui-border-default);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-enter-active {
  transition: all 0.2s ease-out;
}
.dialog-leave-active {
  transition: all 0.15s ease-in;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .p-dialog {
  transform: scale(0.9);
}
</style>
