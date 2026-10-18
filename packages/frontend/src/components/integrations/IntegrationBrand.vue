<script setup lang="ts">
import { PixelIcon } from '../pixel'
defineProps<{ brand?: string; fallback?: string }>()
const assets: Record<string, string> = {
  deepwiki: '/integration-brands/deepwiki.svg',
  sciverse: '/integration-brands/sciverse.ico',
  mineru: '/integration-brands/mineru.png',
  tavily: '/integration-brands/tavily.png',
  brave: '/integration-brands/brave.png',
  searxng: '/integration-brands/searxng.svg',
}
function assetUrl(path: string | undefined): string {
  return path ? new URL(path.replace(/^\//, ''), document.baseURI).href : ''
}
</script>
<template>
  <span class="integration-brand">
    <img v-if="brand && assets[brand]" :src="assetUrl(assets[brand])" :alt="brand" />
    <PixelIcon v-else :name="fallback || 'search'" size="lg" />
  </span>
</template>
<style scoped>
.integration-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border-default);
  background: #fff;
  color: #596174;
  box-shadow: 2px 2px 0 var(--ui-border-subtle);
}
.integration-brand img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
