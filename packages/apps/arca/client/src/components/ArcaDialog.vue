<script setup lang="ts">
import { t as __t } from '../i18n'

import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { openDialogs } from '../services/dialogState'
import { activateSurface, retireSurface } from '../services/surfaceMotion'
const props = defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const titleId = useId()
const dialog = ref<HTMLElement>()
let previous: HTMLElement | null = null
let registered = false
function release() {
  if (registered) {
    openDialogs.value--
    registered = false
  }
}
function close() {
  if (!props.busy) emit('close')
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
  if (event.key !== 'Tab') return
  const elements = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ) ?? []),
  ].filter((item) => item.getClientRects().length)
  const first = elements[0],
    last = elements.at(-1)
  if (!first) {
    event.preventDefault()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!registered) {
        openDialogs.value++
        registered = true
      }
      await nextTick()
      if (props.open)
        (
          dialog.value?.querySelector<HTMLElement>(
            'input:not([type="hidden"]), textarea, [data-autofocus]',
          ) ??
          dialog.value?.querySelector<HTMLElement>('button') ??
          dialog.value
        )?.focus()
    } else {
      release()
      await nextTick()
      if (!props.open && previous?.isConnected) previous.focus()
    }
  },
  { immediate: true },
)
onBeforeUnmount(release)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" @before-enter="activateSurface" @before-leave="retireSurface">
      <div v-if="open" class="dialog-scrim" @click.self="close">
        <section
          ref="dialog"
          class="arca-dialog"
          :class="{ wide }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-busy="busy"
          tabindex="-1"
          @keydown="keys"
        >
          <header>
            <h2 :id="titleId">{{ title }}</h2>
            <button
              class="icon-button"
              type="button"
              :aria-label="__t('apps.arca.ui', '关闭对话框')"
              :disabled="busy"
              @click="close"
            >
              ×
            </button>
          </header>
          <div class="dialog-body"><slot /></div>
          <footer v-if="$slots.footer"><slot name="footer" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
