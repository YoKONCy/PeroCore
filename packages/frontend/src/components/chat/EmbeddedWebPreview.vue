<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { createClientUuid } from '../../lib/clientPlatform'

/**
 * EmbeddedWebPreview.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildEmbeddedWebDocument } from '../../lib/embeddedWebPreview'

const props = withDefaults(defineProps<{ source: string; active?: boolean }>(), { active: true })
const channel = `preview-${createClientUuid()}`
const iframe = ref<HTMLIFrameElement>()
const height = ref(180)
const loaded = ref(false)
const srcdoc = computed(() =>
  props.active ? buildEmbeddedWebDocument(props.source, channel) : undefined,
)

function handleMessage(event: MessageEvent): void {
  if (!props.active || event.source !== iframe.value?.contentWindow) return
  const data = event.data as { type?: string; channel?: string; height?: number }
  if (data?.type !== 'infos-embedded-resize' || data.channel !== channel) return
  if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
  height.value = Math.min(720, Math.max(96, Math.ceil(data.height)))
}

onMounted(() => window.addEventListener('message', handleMessage))
onBeforeUnmount(() => window.removeEventListener('message', handleMessage))
watch([() => props.active, () => props.source], ([active]) => {
  if (active) loaded.value = false
})
</script>

<template>
  <section class="embedded-web-preview" :class="{ 'is-loaded': loaded }">
    <div class="embedded-web-preview__hint">
      <span class="embedded-web-preview__signal" />
      <span>{{ __t('ui.chat', '隔离预览') }}</span>
    </div>
    <iframe
      v-if="active"
      ref="iframe"
      :srcdoc="srcdoc"
      :style="{ height: `${height}px` }"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :title="__t('ui.chat', '隔离的内嵌网页预览')"
      @load="loaded = true"
    />
    <div v-else class="embedded-web-preview__placeholder" :style="{ height: `${height}px` }" />
  </section>
</template>

<style scoped>
.embedded-web-preview {
  position: relative;
  margin: 10px 0 9px;
  overflow: visible;
  background: transparent;
}
.embedded-web-preview__hint {
  display: inline-flex;
  min-height: 16px;
  align-items: center;
  gap: 5px;
  margin: 0 0 3px 4px;
  color: var(--ui-text-muted);
  font:
    8px var(--font-mono),
    monospace;
  letter-spacing: 0.04em;
  opacity: 0.66;
}
.embedded-web-preview__signal {
  width: 4px;
  height: 4px;
  background: var(--ui-text-muted);
}
.embedded-web-preview.is-loaded .embedded-web-preview__signal {
  background: var(--ui-accent-sky);
}
.embedded-web-preview iframe {
  display: block;
  width: 100%;
  min-height: 96px;
  max-height: 720px;
  border: 0;
  background: transparent;
  transition: height 0.12s ease-out;
}
.embedded-web-preview__placeholder {
  min-height: 96px;
  max-height: 720px;
}
</style>
