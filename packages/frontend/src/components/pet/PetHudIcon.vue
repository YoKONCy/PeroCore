<script setup lang="ts">
import { computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'

const props = withDefaults(defineProps<{ name: string; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), {
  size: 'md',
})

// 桌宠专用像素图案沿用设计素材的整数轮廓，亮面和短侧面随主题配色。
const paths: Record<string, string> = {
  chat: 'M4 3h16v2h2v12h-2v2H10v2H8v2H6v-4H4v-2H2V5h2z M6 7v2h12V7z M6 11v2h8v-2z',
  mic: 'M10 2h4v2h2v8h-2v2h-4v-2H8V4h2z M4 9h2v5h2v2h8v-2h2V9h2v7h-2v2h-5v3h4v2H7v-2h4v-3H6v-2H4z',
  wardrobe: 'M7 3h3v2h4V3h3v2h2v2h3v6h-5v9H7v-9H2V7h3V5h2z',
  heart: 'M4 4h5v2h2v2h2V6h2V4h5v2h2v7h-2v3h-3v3h-3v3h-4v-3H7v-3H4v-3H2V6h2z',
  wave: 'M10 2h2v10h1V1h2v11h1V3h2v10h1V6h2v11h-2v3h-3v2H9v-2H7v-3H5v-2H3v-3h3l3 3V5h1z',
  settings: 'M9 2h6v3h3v3h3v7h-3v3h-3v3H9v-3H6v-3H3V8h3V5h3z M10 8v2H8v4h2v2h4v-2h2v-4h-2V8z',
  thought:
    'M7 2h10v2h4v3h2v8h-2v3h-4v2H7v-2H3v-3H1V7h2V4h4z M5 21h3v3H5z M10 20h2v2h-2z M6 9v3h3V9z M11 9v3h3V9z M16 9v3h3V9z',
  expand: 'M2 2h8v2H4v6H2z M14 2h8v8h-2V4h-6z M2 14h2v6h6v2H2z M20 14h2v8h-8v-2h6z',
  close: 'M4 3h3v3h3v3h4V6h3V3h3v4h-3v3h-3v4h3v3h3v4h-3v-3h-3v-3h-4v3H7v3H4v-4h3v-3h3v-4H7V7H4z',
  sparkle: 'M10 1h4v6h3v3h6v4h-6v3h-3v6h-4v-6H7v-3H1v-4h6V7h3z M3 2h2v3H2V3h1z M20 19h2v3h-3v-2h1z',
  check: 'M2 11h3v3h3v3h3v-3h3v-3h3V8h3V5h3v5h-3v3h-3v3h-3v3h-3v3H8v-3H5v-3H2z',
  'chevron-right': 'M7 3h3v3h3v3h3v3h3v3h-3v3h-3v3h-3v3H7v-4h3v-3h3v-3h-3v-3H7z',
}
const path = computed(() => paths[props.name])
const pixels = computed(() => ({ xs: 14, sm: 20, md: 26, lg: 32 })[props.size])
</script>

<template>
  <svg
    v-if="path"
    class="pet-hud-icon"
    viewBox="0 0 26 26"
    :width="pixels"
    :height="pixels"
    fill="none"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path :d="path" fill-rule="evenodd" transform="translate(1 2)" fill="var(--pet-icon-shadow)" />
    <path
      :d="path"
      fill-rule="evenodd"
      transform="translate(1 0)"
      fill="var(--pet-icon-highlight)"
    />
    <path :d="path" fill-rule="evenodd" transform="translate(1 1)" fill="currentColor" />
  </svg>
  <PixelIcon v-else :name="name" :size="size" aria-hidden="true" />
</template>

<style scoped>
.pet-hud-icon {
  display: block;
  flex-shrink: 0;
}
</style>
