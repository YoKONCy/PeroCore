<script setup lang="ts">
/**
 * EmbeddedWebPreview.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildEmbeddedWebDocument } from '../../lib/embeddedWebPreview'

const props = defineProps<{ source: string }>()
const channel = `preview-${crypto.randomUUID()}`
const height = ref(180)
const loaded = ref(false)
const srcdoc = computed(() => buildEmbeddedWebDocument(props.source, channel))

function handleMessage(event: MessageEvent): void {
  const data = event.data as { type?: string; channel?: string; height?: number }
  if (data?.type !== 'infos-embedded-resize' || data.channel !== channel) return
  height.value = Math.min(720, Math.max(96, Math.ceil(Number(data.height) || 180)))
}

onMounted(() => window.addEventListener('message', handleMessage))
onBeforeUnmount(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <section class="embedded-web-preview" :class="{ 'is-loaded': loaded }">
    <div class="embedded-web-preview__hint">
      <span class="embedded-web-preview__signal" />
      <span>隔离预览</span>
    </div>
    <iframe
      :srcdoc="srcdoc"
      :style="{ height: `${height}px` }"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      title="隔离的内嵌网页预览"
      @load="loaded = true"
    />
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
</style>
