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
  visible: boolean
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
  'update:visible': [value: boolean]
  confirm: [value?: string]
  cancel: []
}>()

import { ref, watch, useSlots } from 'vue'
import PButton from './PButton.vue'

const slots = useSlots()
const inputValue = ref(props.defaultValue)

watch(
  () => props.visible,
  (val) => { if (val) inputValue.value = props.defaultValue },
)

function handleConfirm() {
  if (props.mode === 'prompt') {
    emit('confirm', inputValue.value)
  } else {
    emit('confirm')
  }
  emit('update:visible', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:visible', false)
}

/** 允许 v-model 用法 */
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="p-dialog-overlay" @click.self="handleCancel">
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
              <PButton variant="secondary" size="sm" @click="handleCancel">{{ cancelText }}</PButton>
              <PButton :variant="confirmVariant" size="sm" @click="handleConfirm">{{ confirmText }}</PButton>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.p-dialog-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px);
}

.p-dialog {
  min-width: 340px; max-width: 560px;
  background: var(--color-bg-primary);
  border: 3px solid var(--color-border);
  box-shadow: 6px 6px 0 rgba(0, 0, 0, 0.15);
}

.p-dialog-header {
  padding: 12px 16px;
  border-bottom: 2px solid var(--color-border);
  font-weight: 700; font-size: 15px;
  color: var(--color-text-primary);
  display: flex; justify-content: space-between; align-items: center;
}

.p-dialog-close {
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); font-size: 14px; padding: 2px 6px;
  transition: color 0.15s;
}
.p-dialog-close:hover { color: var(--color-text-primary); }

.p-dialog-body { padding: 16px; }
.p-dialog-message { font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); margin-bottom: 12px; }

.p-dialog-input {
  width: 100%; padding: 6px 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace; font-size: 14px; outline: none;
}
.p-dialog-input:focus { border-color: var(--color-blue-500); }

.p-dialog-footer {
  padding: 12px 16px;
  border-top: 2px solid var(--color-border);
  display: flex; justify-content: flex-end; gap: 8px;
}

.dialog-enter-active { transition: all 0.2s ease-out; }
.dialog-leave-active { transition: all 0.15s ease-in; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .p-dialog { transform: scale(0.9); }
</style>
