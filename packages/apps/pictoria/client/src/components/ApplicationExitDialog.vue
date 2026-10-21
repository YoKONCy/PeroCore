<script setup lang="ts">
import { t as __t } from '../i18n'

import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './PictoriaIcon.vue'

const props = defineProps<{
  busy: boolean
  progress: string
  error: string
  exited: boolean
  embedded: boolean
  hosted: boolean
}>()
const emit = defineEmits<{ cancel: []; confirm: []; closePage: [] }>()
const dialog = ref<HTMLElement | null>(null)
const previousFocus = document.activeElement
function cancel() {
  if (!props.busy && !props.exited) emit('cancel')
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [],
  )
  if (!controls.length) {
    event.preventDefault()
    dialog.value?.focus()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === controls[0] || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    controls.at(-1)?.focus()
  } else if (
    !event.shiftKey &&
    (document.activeElement === controls.at(-1) || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    controls[0]?.focus()
  }
}
onMounted(() => dialog.value?.focus())
onBeforeUnmount(() => {
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
})
</script>

<template>
  <div class="application-exit-backdrop" data-ui @pointerdown.self="cancel">
    <section
      ref="dialog"
      class="application-exit-dialog floating-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-exit-title"
      :aria-busy="busy"
      tabindex="-1"
      @keydown="keyboard"
    >
      <span class="application-exit-symbol">
        <Icon :name="exited ? 'check' : 'power'" :size="24" />
      </span>
      <h2 id="application-exit-title">
        {{
          exited
            ? __t('apps.pictoria.ui', 'Pictoria 已退出')
            : __t('apps.pictoria.ui', '退出 Pictoria？')
        }}
      </h2>
      <p>
        {{
          exited
            ? hosted
              ? __t('apps.pictoria.ui', 'infOS 仍在运行。')
              : __t('apps.pictoria.ui', '可以关闭此页面。')
            : __t('apps.pictoria.ui', '保存编辑并停止后台。')
        }}
      </p>
      <p v-if="error" class="application-exit-error" role="alert">{{ error }}</p>
      <footer v-if="!exited">
        <button class="quiet-button" :disabled="busy" @click="cancel">
          {{ __t('apps.pictoria.ui', '取消') }}
        </button>
        <button class="create-button" :disabled="busy" @click="emit('confirm')">
          <Icon :name="busy ? 'refresh' : 'power'" :size="16" :class="{ 'exit-spinner': busy }" />
          {{ busy ? progress : __t('apps.pictoria.ui', '保存并退出') }}
        </button>
      </footer>
      <footer v-else-if="embedded">
        <button class="create-button" @click="emit('closePage')">
          {{ __t('apps.pictoria.ui', '关闭标签页') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.application-exit-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--canvas) 65%, transparent);
  backdrop-filter: blur(9px);
  color: var(--text);
}
.application-exit-dialog {
  width: min(380px, 100%);
  border-radius: 20px;
  padding: 28px;
  outline: none;
}
.application-exit-symbol {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--line-bright);
  border-radius: 15px;
  color: var(--accent);
  background: var(--accent-soft);
}
h2 {
  margin: 19px 0 8px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.4px;
}
p {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--muted);
}
p.application-exit-error {
  margin-top: 16px;
  color: var(--danger);
  overflow-wrap: anywhere;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 25px;
}
footer .quiet-button {
  padding: 10px 16px;
}
footer .create-button {
  min-height: 40px;
  padding: 0 15px;
  font-size: 13px;
}
.exit-spinner {
  animation: exit-spin 1.2s linear infinite;
}
.application-exit-enter-active,
.application-exit-leave-active {
  transition:
    opacity 0.2s ease,
    backdrop-filter 0.2s ease;
}
.application-exit-enter-active .application-exit-dialog,
.application-exit-leave-active .application-exit-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.application-exit-enter-from,
.application-exit-leave-to {
  opacity: 0;
  backdrop-filter: blur(0);
}
.application-exit-enter-from .application-exit-dialog,
.application-exit-leave-to .application-exit-dialog {
  opacity: 0;
  transform: translateY(9px) scale(0.98);
}
@keyframes exit-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .application-exit-enter-active,
  .application-exit-leave-active,
  .application-exit-enter-active .application-exit-dialog,
  .application-exit-leave-active .application-exit-dialog {
    transition: none;
  }
  .exit-spinner {
    animation: none;
  }
}
</style>
