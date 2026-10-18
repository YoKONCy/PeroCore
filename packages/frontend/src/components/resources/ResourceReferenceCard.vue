<script setup lang="ts">
import { computed, ref } from 'vue'
import ResourceGlyph from './ResourceGlyph.vue'
import { openResourceLink } from '../../composables/resources/useResources'
import { resourceLinkKind } from '../../lib/resourceLinks'
import { useNotificationStore } from '../../stores'
const props = defineProps<{ source: string; label?: string; agentId: string; threadId: string }>()
const pending = ref(false)
const notification = useNotificationStore()
const name = computed(() => props.label || props.source.split(/[\\/]/).pop() || '文件')
async function open() {
  if (pending.value) return
  pending.value = true
  try {
    await openResourceLink(props.source, props)
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : '无法打开资源', { type: 'error' })
  } finally {
    pending.value = false
  }
}
</script>
<template>
  <button
    type="button"
    class="resource-reference"
    :disabled="pending"
    :title="source"
    @click="open"
  >
    <ResourceGlyph :kind="resourceLinkKind(source)" />
    <span class="resource-reference__name">{{ name }}</span>
    <span class="resource-reference__mark" aria-hidden="true">{{ pending ? '···' : '↗' }}</span>
  </button>
</template>
<style scoped>
.resource-reference {
  --resource-accent: var(--ui-accent-purple);
  display: flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  max-width: min(100%, 360px);
  padding: 9px 13px 10px 11px;
  margin: 8px 0;
  border: 1px solid color-mix(in srgb, var(--resource-accent) 28%, var(--ui-border-default));
  border-radius: 0;
  color: var(--ui-text-primary);
  background:
    linear-gradient(
      120deg,
      color-mix(in srgb, var(--resource-accent) 7%, transparent),
      transparent 75%
    ),
    color-mix(in srgb, var(--ui-bg-surface) 88%, transparent);
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 12%, transparent),
    2px 3px 0 color-mix(in srgb, var(--resource-accent) 15%, var(--ui-bg-surface));
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    transform 130ms steps(2, end),
    border-color 130ms,
    box-shadow 130ms;
}
.resource-reference:hover {
  transform: translateY(-2px);
  border-color: var(--resource-accent);
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 16%, transparent),
    2px 5px 0 color-mix(in srgb, var(--resource-accent) 18%, var(--ui-bg-surface));
}
.resource-reference:active {
  transform: translate(1px, 1px);
}
.resource-reference :deep(.resource-glyph) {
  width: 23px;
  height: 27px;
}
.resource-reference__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.resource-reference__mark {
  color: var(--resource-accent);
  margin-left: 12px;
  font-family: var(--ui-font-pixel);
}
@media (prefers-reduced-motion: reduce) {
  .resource-reference {
    transition: none;
  }
}
</style>
