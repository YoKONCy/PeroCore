<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspacePreviewKind } from '@infos/shared'
const props = defineProps<{ kind: WorkspacePreviewKind }>()
const paths: Record<WorkspacePreviewKind, string> = {
  image: 'M1 2h14v12H1z M3 10h2V8h2v2h2V6h2v2h2v4H3z M4 4h2v2H4z',
  svg: 'M6 1h4v3H6z M6 12h4v3H6z M1 6h3v4H1z M12 6h3v4h-3z M4 7h8v2H4z M7 4h2v8H7z',
  pdf: 'M3 1h7v2h2v2h1v10H3z M9 2v4h3 M5 8h6 M5 11h6',
  audio: 'M6 3h8v2H8v7H6z M11 4h3v8h-2V6h-1z M3 11h5v3H3z M9 11h5v3H9z',
  video: 'M1 2h14v12H1z M3 3v2 M3 7v2 M3 11v2 M13 3v2 M13 7v2 M13 11v2 M6 5h2v1h2v4H8v1H6z',
  text: 'M5 3H3v2H1v2h2v2h2 M11 3h2v2h2v2h-2v2h-2 M8 2 6 13',
  file: 'M3 1h7v2h2v2h1v10H3z M9 2v4h3',
}
const path = computed(() => paths[props.kind])
</script>
<template>
  <svg
    class="workspace-file-glyph"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>
<style scoped>
.workspace-file-glyph {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--ui-accent-sky);
}
</style>
