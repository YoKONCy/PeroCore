<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PButton, PDialog } from '../pixel'
import ResourceAudioPlayer from './ResourceAudioPlayer.vue'
import ResourceGlyph from './ResourceGlyph.vue'
import {
  openResource,
  resourcePreview,
  resourceTextPreview,
  resourceUrl,
  resourceSize,
} from '../../composables/resources/useResources'
const url = computed(() => (resourcePreview.value ? resourceUrl(resourcePreview.value) : ''))
const text = ref('')
const error = ref('')
const truncated = ref(false)
const loading = ref(false)
let revision = 0
function openSource() {
  const item = resourcePreview.value
  resourcePreview.value = null
  if (item) openResource(item, true)
}
watch(resourcePreview, async (item) => {
  const version = ++revision
  text.value = ''
  error.value = ''
  truncated.value = false
  loading.value = false
  if (!item || item.kind !== 'text') return
  loading.value = true
  try {
    const result = await resourceTextPreview(item)
    if (version === revision) {
      text.value = result.text
      truncated.value = result.truncated
    }
  } catch (failure) {
    if (version === revision)
      error.value = failure instanceof Error ? failure.message : '无法读取文件'
  } finally {
    if (version === revision) loading.value = false
  }
})
</script>
<template>
  <PDialog
    :model-value="Boolean(resourcePreview)"
    :title="resourcePreview?.name"
    :width="
      ['audio', 'file'].includes(resourcePreview?.kind || '')
        ? 'min(460px, calc(100vw - 32px))'
        : 'min(820px, calc(100vw - 32px))'
    "
    @update:model-value="
      (visible) => {
        if (!visible) resourcePreview = null
      }
    "
  >
    <div v-if="resourcePreview" class="resource-preview">
      <img v-if="resourcePreview.kind === 'image'" :src="url" :alt="resourcePreview.name" />
      <video v-else-if="resourcePreview.kind === 'video'" :src="url" controls preload="metadata" />
      <ResourceAudioPlayer v-else-if="resourcePreview.kind === 'audio'" :src="url" />
      <iframe v-else-if="resourcePreview.kind === 'pdf'" :src="url" title="PDF 预览" />
      <template v-else-if="resourcePreview.kind === 'text'">
        <p v-if="loading || error">{{ loading ? '读取中…' : error }}</p>
        <pre v-else>{{ text }}</pre>
        <small v-if="truncated">部分预览</small>
      </template>
      <div v-else class="resource-preview__file">
        <ResourceGlyph kind="file" />
        <small>{{ resourceSize(resourcePreview.sizeBytes) }}</small>
      </div>
    </div>
    <template #footer>
      <PButton
        v-if="resourcePreview?.id && resourcePreview.origin"
        variant="secondary"
        size="sm"
        @click="openSource"
      >
        源文件
      </PButton>
      <PButton
        v-if="resourcePreview"
        variant="secondary"
        size="sm"
        :href="resourceUrl(resourcePreview, true)"
        :download="resourcePreview.name"
        :target="
          !resourcePreview.id && resourcePreview.origin?.type === 'url' ? '_blank' : undefined
        "
        rel="noopener noreferrer"
      >
        下载
      </PButton>
      <PButton variant="secondary" size="sm" @click="resourcePreview = null">关闭</PButton>
    </template>
  </PDialog>
</template>
<style scoped>
.resource-preview {
  display: grid;
  place-items: center;
  min-height: 90px;
  max-height: 66vh;
  overflow: auto;
}
.resource-preview img,
.resource-preview video {
  display: block;
  max-width: 100%;
  max-height: 62vh;
  object-fit: contain;
}
.resource-preview :deep(.resource-audio) {
  width: min(100%, 420px);
}
.resource-preview__file {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 10px;
}
.resource-preview iframe {
  width: 100%;
  height: 62vh;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
}
.resource-preview pre {
  width: 100%;
  margin: 0;
  padding: 14px;
  font: 12px/1.7 var(--ui-font-mono);
  color: var(--ui-text-primary);
  background: var(--ui-bg-surface-soft);
  user-select: text;
  overflow: auto;
  tab-size: 4;
}
.resource-preview small,
.resource-preview p {
  color: var(--ui-text-secondary);
  font-size: 12px;
}
</style>
