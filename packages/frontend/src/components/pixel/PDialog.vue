<script setup lang="ts">
/**
 * PDialog — 像素风通用确认/输入对话框
 *
 * 迁移自 v1 CustomDialog，支持：
 * - 确认模式 (confirm)
 * - 输入模式 (prompt)
 */
import { ref, watch } from 'vue'
import PButton from './PButton.vue'

interface Props {
  visible: boolean
  title?: string
  message?: string
  /** confirm | prompt */
  mode?: 'confirm' | 'prompt'
  confirmText?: string
  cancelText?: string
  /** prompt 模式的输入占位符 */
  placeholder?: string
  /** prompt 模式的默认值 */
  defaultValue?: string
  /** 确认按钮变体 */
  confirmVariant?: 'primary' | 'danger'
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
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [value?: string]
  cancel: []
}>()

const inputValue = ref(props.defaultValue)

watch(
  () => props.visible,
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
  emit('update:visible', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:visible', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="p-dialog-overlay" @click.self="handleCancel">
        <div class="p-dialog">
          <div class="p-dialog-header">
            {{ title }}
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
            <slot />
          </div>

          <div class="p-dialog-footer">
            <PButton variant="secondary" size="sm" @click="handleCancel">
              {{ cancelText }}
            </PButton>
            <PButton :variant="confirmVariant" size="sm" @click="handleConfirm">
              {{ confirmText }}
            </PButton>
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
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.p-dialog {
  min-width: 340px;
  max-width: 480px;
  background: var(--color-bg-primary);
  border: 3px solid var(--color-border);
  box-shadow: 6px 6px 0 rgba(0, 0, 0, 0.15);
}

.p-dialog-header {
  padding: 12px 16px;
  border-bottom: 2px solid var(--color-border);
  font-weight: 700;
  font-size: 15px;
  color: var(--color-text-primary);
}

.p-dialog-body {
  padding: 16px;
}

.p-dialog-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.p-dialog-input {
  width: 100%;
  padding: 6px 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: var(--font-pixel), monospace;
  font-size: 14px;
  outline: none;
}
.p-dialog-input:focus {
  border-color: var(--color-blue-500);
}

.p-dialog-footer {
  padding: 12px 16px;
  border-top: 2px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 动画 */
.dialog-enter-active { transition: all 0.2s ease-out; }
.dialog-leave-active { transition: all 0.15s ease-in; }
.dialog-enter-from,
.dialog-leave-to { opacity: 0; }
.dialog-enter-from .p-dialog { transform: scale(0.9); }
</style>
