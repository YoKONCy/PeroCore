<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ kind: string }>()
const shape = computed(
  () =>
    (
      ({
        image: 'M2 3h11v1h1v10H1V4h1z',
        video: 'M2 3h9v2h2V4h2v9h-2v-1h-2v2H1V4h1z',
        audio: 'M4 2h7v1h1v7h-2V5H5v5H3V4h1z M2 8h3v6H2z M10 8h3v6h-3z',
        file: 'M3 1h6v1h2v2h2v11H2V2h1z',
        pdf: 'M3 1h6v1h2v2h2v11H2V2h1z',
      }) as Record<string, string>
    )[props.kind] || 'M3 1h6v1h2v2h2v11H2V2h1z',
)
</script>
<template>
  <svg class="resource-glyph" viewBox="0 0 17 18" aria-hidden="true" shape-rendering="crispEdges">
    <path :d="shape" transform="translate(1 2)" class="resource-glyph__shadow" />
    <path :d="shape" class="resource-glyph__face" />
    <path
      v-if="kind === 'image'"
      d="M3 11h2V9h2v2h2V8h2v4H3z M4 5h2v2H4z"
      class="resource-glyph__mark"
    />
    <path v-else-if="kind === 'video'" d="M5 6h1v1h2v1h1v1H7v1H5z" class="resource-glyph__mark" />
    <path
      v-else-if="kind !== 'audio'"
      d="M9 2v4h3 M4 9h6v1H4z M4 12h4v1H4z"
      class="resource-glyph__mark"
    />
    <path d="M3 3h1v1H3z" class="resource-glyph__light" />
  </svg>
</template>
<style scoped>
.resource-glyph {
  width: 34px;
  height: 38px;
  flex-shrink: 0;
  overflow: visible;
}
.resource-glyph__face {
  fill: var(--resource-accent, var(--ui-accent-sky));
}
.resource-glyph__shadow {
  fill: color-mix(in srgb, var(--resource-accent, var(--ui-accent-sky)) 42%, var(--ui-bg-surface));
}
.resource-glyph__mark {
  fill: var(--ui-bg-surface);
}
.resource-glyph__light {
  fill: #fff;
  opacity: 0.75;
}
</style>
