<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 应用内危险操作确认框（S06 §12.2 L5阻断层）。
 * 替代Electron系统原生确认框，使用居中Modal、强遮罩和像素按压反馈。
 */
const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()
const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const modal = ref<HTMLElement>()
const cancelButton = ref<HTMLButtonElement>()
const confirmButton = ref<HTMLButtonElement>()
let previousFocus: HTMLElement | null = null

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      cancelButton.value?.focus()
    } else {
      previousFocus?.focus()
      previousFocus = null
    }
  },
)

function cancel() {
  emit('cancel')
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  // 危险操作禁止Enter快捷确认，必须明确点击红色按钮。
  if (event.key === 'Enter' && !props.danger) {
    event.preventDefault()
    emit('confirm')
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [cancelButton.value, confirmButton.value].filter(
    (element): element is HTMLButtonElement => Boolean(element),
  )
  if (!focusable.length) return
  const current = focusable.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.shiftKey
    ? (current - 1 + focusable.length) % focusable.length
    : (current + 1) % focusable.length
  event.preventDefault()
  focusable[next]?.focus()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  previousFocus?.focus()
})
</script>

<template>
  <div v-if="open" class="confirm-scrim">
    <section
      ref="modal"
      class="confirm-modal"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <header class="confirm-head">
        <span class="confirm-glyph" aria-hidden="true">!</span>
        <div>
          <p class="pixel-label">
            {{ danger ? '危险操作' : '确认操作' }}
            <span class="pixel-en">{{ danger ? 'DANGER' : 'CONFIRM' }}</span>
          </p>
          <h2 id="confirm-title">{{ title }}</h2>
        </div>
      </header>
      <p id="confirm-message" class="confirm-message">{{ message }}</p>
      <footer class="confirm-actions">
        <button ref="cancelButton" class="soft-button" type="button" @click="cancel">
          {{ cancelText ?? '取消' }}
        </button>
        <button
          ref="confirmButton"
          class="confirm-accept"
          :class="{ danger }"
          type="button"
          @click="emit('confirm')"
        >
          {{ confirmText ?? '确认' }}
        </button>
      </footer>
    </section>
  </div>
</template>
