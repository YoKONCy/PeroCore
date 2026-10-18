<script setup lang="ts">
import { computed, inject, shallowRef } from 'vue'
import type { SurfaceNodeId } from '@infos/shared'
import { StreamMarkdownSegmenter } from '../../compositor/markdownSegmentation'
import ChatRichText from '../chat/ChatRichText.vue'

const props = withDefaults(
  defineProps<{
    source: string
    nodeId: SurfaceNodeId
    committed: boolean
    active?: boolean
  }>(),
  { active: true },
)
const mainVisible = inject('infos:main-surface-visible', shallowRef(true))
const segmenter = new StreamMarkdownSegmenter(props.nodeId)
let previous: ReturnType<StreamMarkdownSegmenter['update']> = []
const blocks = computed(() => {
  if (!props.active || !mainVisible.value) return previous
  return (previous = segmenter
    .update(props.source, props.committed)
    .filter((block) => block.source.trim()))
})
</script>

<template>
  <ChatRichText
    v-for="block in blocks"
    :key="block.id"
    :content="block.source"
    :stable="block.stable"
    :cache="block.stable"
    :active="active"
    :web-preview="false"
  />
</template>
