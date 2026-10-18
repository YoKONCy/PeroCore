<script setup lang="ts">
import { computed } from 'vue'
import type { DocumentSemanticDiff, DocumentSnapshot } from '@infos/document-engine'
import { officeChildren, officeContent } from '@infos/document-engine/office'
import OfficeBlock from './OfficeBlock.vue'
import { useDocumentAssets } from '../services/documentAssets'

const props = defineProps<{
  snapshot: DocumentSnapshot
  diff: DocumentSemanticDiff
  showChanges: boolean
}>()
const assets = useDocumentAssets(computed(() => props.snapshot))
const content = computed(() => officeContent(props.snapshot))
const changes = computed(() => {
  const result: Record<string, { before: string; after: string }> = {}
  for (const change of props.diff.textChanges) {
    // 同一段落的连续替换合成最终结果，保留最初的原文。
    result[change.nodeId] = {
      before: result[change.nodeId]?.before ?? change.before,
      after: change.after,
    }
  }
  return result
})
const firstNode = computed(
  () => officeChildren(content.value, props.snapshot.document.rootNodeId)[0],
)
const hasTitle = computed(
  () =>
    firstNode.value?.type === 'heading' &&
    firstNode.value.text?.trim() === content.value.title.trim(),
)
</script>

<template>
  <article class="review-paper">
    <h1 v-if="!hasTitle" class="office-document-title">{{ content.title }}</h1>
    <OfficeBlock
      v-for="node in officeChildren(content, snapshot.document.rootNodeId)"
      :key="node.nodeId"
      :node="node"
      :content="content"
      :writable="false"
      :assets="assets"
      :text-changes="changes"
      :show-changes="showChanges"
    />
  </article>
</template>
