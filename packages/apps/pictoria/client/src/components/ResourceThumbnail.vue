<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Asset } from '../types'
import type { CanvasStore } from '../composables/useCanvas'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{ asset: Asset; store: CanvasStore }>()
const element = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (!props.asset.mimeType.startsWith('image/')) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        observer?.disconnect()
        void props.store.ensureThumbnail(props.asset.id).catch(() => {})
      }
    },
    { rootMargin: '100px' },
  )
  if (element.value) observer.observe(element.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <span ref="element" class="resource-thumbnail">
    <img
      v-if="asset.mimeType.startsWith('image/') && store.thumbnails[asset.id]"
      :src="store.thumbnails[asset.id]"
      :alt="asset.meta?.title || asset.name"
      loading="lazy"
      draggable="false"
    />
    <Icon
      v-else
      :name="
        asset.mimeType.startsWith('video/')
          ? 'play'
          : asset.mimeType.startsWith('audio/')
            ? 'sound'
            : 'image'
      "
      :size="28"
    />
  </span>
</template>
