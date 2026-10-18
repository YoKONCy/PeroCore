<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ src: string }>()
const emit = defineEmits<{ ready: [src: string]; error: [src: string] }>()
const ready = ref(false)
watch(
  () => props.src,
  () => {
    ready.value = false
  },
  { flush: 'sync' },
)
function handleLoad(event: Event): void {
  if ((event.target as HTMLImageElement).getAttribute('src') !== props.src) return
  ready.value = true
  emit('ready', props.src)
}
function handleError(event: Event): void {
  if ((event.target as HTMLImageElement).getAttribute('src') !== props.src) return
  ready.value = false
  emit('error', props.src)
}
</script>

<template>
  <div class="app-wallpaper" :class="{ 'app-wallpaper--ready': ready }" aria-hidden="true">
    <img :key="src" :src="src" alt="" draggable="false" @load="handleLoad" @error="handleError" />
    <div class="app-wallpaper__veil" />
  </div>
</template>

<style scoped>
.app-wallpaper {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  visibility: hidden;
}
.app-wallpaper--ready {
  visibility: visible;
}
.app-wallpaper img {
  position: absolute;
  inset: calc(var(--app-image-blur, 0px) * -2);
  width: calc(100% + var(--app-image-blur, 0px) * 4);
  height: calc(100% + var(--app-image-blur, 0px) * 4);
  max-width: none;
  object-fit: var(--app-image-fit, cover);
  object-position: var(--app-image-position, 50% 50%);
  opacity: var(--app-image-opacity, 1);
  filter: blur(var(--app-image-blur, 0px)) brightness(var(--app-image-brightness, 1))
    saturate(var(--app-image-saturation, 1)) contrast(var(--app-image-contrast, 1));
}
.app-wallpaper__veil {
  position: absolute;
  inset: 0;
  background: color-mix(
    in srgb,
    var(--ui-bg-canvas) calc(var(--app-image-overlay, 0.18) * 100%),
    transparent
  );
}
</style>
