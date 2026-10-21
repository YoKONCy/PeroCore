<script setup lang="ts">
import { t as __t } from '../i18n'

import { onBeforeUnmount, onMounted, ref } from 'vue'
import ProviderSettings from './ProviderSettings.vue'
import Icon from './PictoriaIcon.vue'
defineProps<{ agentId: string; online: boolean }>()
const emit = defineEmits<{ close: []; updated: [] }>()
const error = ref(''),
  dialog = ref<HTMLElement | null>(null),
  previous = document.activeElement
onMounted(() => dialog.value?.focus())
onBeforeUnmount(() => {
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
})
function trap(event: KeyboardEvent) {
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea,summary,[tabindex="0"]',
    ) || [],
  ).filter((item) => item.getClientRects().length)
  if (!controls.length) {
    event.preventDefault()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === controls[0] || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    controls.at(-1)?.focus()
  } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
    event.preventDefault()
    controls[0]?.focus()
  }
}
</script>
<template>
  <div class="recovery-backdrop" data-ui @pointerdown.self="emit('close')">
    <section
      ref="dialog"
      class="provider-dialog floating-panel"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="__t('apps.pictoria.ui', '模型供应商')"
      @keydown.esc.stop="emit('close')"
      @keydown.tab="trap"
    >
      <header>
        <strong>{{ __t('apps.pictoria.ui', '模型供应商') }}</strong>
        <button
          class="icon-button"
          :aria-label="__t('apps.pictoria.ui', '关闭')"
          @click="emit('close')"
        >
          <Icon name="close" :size="18" />
        </button>
      </header>
      <ProviderSettings
        :agent-id="agentId"
        :online="online"
        @updated="
          () => {
            error = ''
            emit('updated')
          }
        "
        @error="error = $event"
      />
      <p v-if="error" class="workflow-field-error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>
