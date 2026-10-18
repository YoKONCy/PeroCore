<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentSnapshot, SemanticDocument } from '@infos/document-engine'
import { nodeText, orderedDocumentNodes } from '../services/documentDisplay'
import { useWorkbenchStore } from '../stores/workbench'
import ArcaIcon from './ArcaIcon.vue'
import { useDocumentAssets } from '../services/documentAssets'

const props = defineProps<{ document: SemanticDocument }>()
const emit = defineEmits<{ loaded: [snapshot: DocumentSnapshot] }>()
const store = useWorkbenchStore()
const snapshot = ref<DocumentSnapshot>()
const assets = useDocumentAssets(snapshot, 3)
const state = ref<'loading' | 'ready' | 'unavailable'>('loading')
let sequence = 0
const blocks = computed(() =>
  snapshot.value
    ? orderedDocumentNodes(snapshot.value)
        .filter(
          (node) =>
            node.type === 'asset' ||
            (nodeText(node).trim() &&
              !(node.type === 'heading' && nodeText(node).trim() === props.document.title.trim())),
        )
        .slice(0, 7)
    : [],
)
const dateLabel = computed(() => {
  const date = new Date(props.document.updatedAt)
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? date.getFullYear() + ' / ' + String(date.getMonth() + 1).padStart(2, '0')
    : ''
})
watch(
  () =>
    [
      props.document.documentId,
      props.document.headRevisionId,
      store.transport,
      store.connection,
    ] as const,
  async () => {
    const current = ++sequence
    snapshot.value = undefined
    state.value = 'loading'
    const cached = store.activeDocument?.snapshot
    if (
      cached?.documentId === props.document.documentId &&
      cached.revisionId === props.document.headRevisionId
    ) {
      snapshot.value = cached
      state.value = 'ready'
      emit('loaded', cached)
      return
    }
    if (!store.transport || store.connection !== 'ready') {
      state.value = 'unavailable'
      return
    }
    try {
      const result = (await store.transport.invoke('document.inspect', {
        documentId: props.document.documentId,
      })) as DocumentSnapshot
      if (current !== sequence) return
      snapshot.value = result
      state.value = 'ready'
      emit('loaded', result)
    } catch {
      if (current === sequence) state.value = 'unavailable'
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  sequence++
})
</script>

<template>
  <div class="document-cover document-book" :aria-busy="state === 'loading'">
    <div class="book-back" aria-hidden="true" />
    <div class="book-page-edges" aria-hidden="true" />
    <div class="book-paper">
      <h2>{{ document.title }}</h2>
      <div class="cover-content">
        <template v-if="state === 'ready' && blocks.length">
          <template v-for="node in blocks" :key="node.nodeId">
            <div v-if="node.type === 'asset'" class="cover-image">
              <img
                v-if="assets[String(node.attributes.blobId)]"
                :src="assets[String(node.attributes.blobId)]"
                :alt="String(node.attributes.alt ?? '')"
              />
              <template v-else>
                <ArcaIcon name="image" :size="25" />
                <span>{{ node.attributes.caption || node.attributes.alt || '图片' }}</span>
              </template>
            </div>
            <h3 v-else-if="node.type === 'heading'">{{ nodeText(node) }}</h3>
            <blockquote v-else-if="node.type === 'quote'">{{ nodeText(node) }}</blockquote>
            <p
              v-else
              :class="{
                'cover-list-item': node.type === 'list-item',
                'cover-table-cell': node.type === 'table-cell',
              }"
            >
              {{ nodeText(node) }}
            </p>
          </template>
        </template>
        <p v-else class="cover-empty">
          {{
            state === 'loading' ? '读取中…' : state === 'unavailable' ? '预览暂不可用' : '空白文稿'
          }}
        </p>
      </div>
    </div>
    <div class="book-front" aria-hidden="true">
      <div class="book-front-face">
        <span class="book-imprint">Arca</span>
        <span class="book-cover-rule" />
        <h2>{{ document.title }}</h2>
        <span class="book-cover-type">文稿</span>
        <div class="book-cover-footer">
          <span>
            {{
              state === 'loading' ? '读取中…' : state === 'unavailable' ? '预览不可用' : dateLabel
            }}
          </span>
          <ArcaIcon name="file" :size="15" />
        </div>
      </div>
      <div class="book-front-inner" />
    </div>
  </div>
</template>
