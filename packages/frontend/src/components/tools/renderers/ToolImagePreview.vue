<script setup lang="ts">
import { t as __t } from '../../../i18n/index'

import { computed, nextTick, ref, watch } from 'vue'
import type { MessageResource } from '@infos/shared'
import { attachmentsApi } from '../../../api/modules/attachmentsApi'
import PDialog from '../../pixel/PDialog.vue'
import PixelIcon from '../../pixel/PixelIcon.vue'
import WorkspaceImageViewer from '../../workspace/WorkspaceImageViewer.vue'
import { createPreviewState } from '../../workspace/workspacePreview'

const props = withDefaults(
  defineProps<{
    preview: MessageResource
    active?: boolean
  }>(),
  { active: false },
)
const emit = defineEmits<{ interact: [] }>()
const preview = computed(() => props.preview)
const src = computed(() => (preview.value?.id ? attachmentsApi.contentUrl(preview.value.id) : ''))
const loaded = ref(false)
const failed = ref(false)
const revision = ref(0)
const viewerOpen = ref(false)
const viewerError = ref('')
const dimensions = ref('')
const viewState = ref(createPreviewState())
const previewButton = ref<HTMLButtonElement>()
const viewer = ref<HTMLElement>()

watch([() => preview.value?.id, () => props.active], (next, previous) => {
  viewerOpen.value = false
  viewerError.value = ''
  loaded.value = false
  failed.value = false
  dimensions.value = ''
  if (next[0] !== previous[0]) viewState.value = createPreviewState()
})
watch(viewerOpen, (open, previous, onCleanup) => {
  if (!open) {
    if (previous && props.active) void nextTick(() => previewButton.value?.focus())
    return
  }
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      viewerOpen.value = false
    }
  }
  window.addEventListener('keydown', closeOnEscape)
  void nextTick(() => {
    if (viewerOpen.value) viewer.value?.focus()
  })
  onCleanup(() => window.removeEventListener('keydown', closeOnEscape))
})
function openViewer() {
  emit('interact')
  viewerError.value = ''
  viewerOpen.value = true
}
function imageLoaded(event: Event) {
  const image = event.target as HTMLImageElement
  dimensions.value = `${image.naturalWidth} × ${image.naturalHeight}`
  loaded.value = true
}
function retry() {
  failed.value = false
  loaded.value = false
  revision.value++
}
</script>

<template>
  <section class="tool-image" :aria-label="__t('ui.tools', '图片浏览')">
    <header>
      <PixelIcon name="image" size="sm" />
      <strong :title="preview?.name">{{ preview?.name || __t('ui.tools', '图片') }}</strong>
      <small v-if="dimensions">{{ dimensions }}</small>
    </header>
    <template v-if="preview && active">
      <div v-if="failed" class="tool-image__empty" role="status">
        <span>{{ __t('ui.tools', '图片已不可用') }}</span>
        <button type="button" @click="retry">{{ __t('ui.tools', '重试') }}</button>
      </div>
      <button
        v-else
        ref="previewButton"
        type="button"
        class="tool-image__frame"
        :class="{ loaded }"
        :disabled="!loaded"
        :title="__t('ui.tools', '放大图片')"
        :aria-label="__t('ui.tools', '放大图片')"
        aria-haspopup="dialog"
        @click="openViewer"
      >
        <img
          :key="revision"
          :src="src"
          :alt="preview.name"
          decoding="async"
          loading="lazy"
          draggable="false"
          @load="imageLoaded"
          @error="failed = true"
        />
        <span v-if="!loaded" class="tool-image__loading" role="status">
          {{ __t('ui.tools', '正在加载图片…') }}
        </span>
        <span v-else class="tool-image__expand"><PixelIcon name="search" size="sm" /></span>
      </button>
    </template>
    <PDialog
      v-model="viewerOpen"
      :title="preview?.name || __t('ui.tools', '图片')"
      width="min(1200px, calc(100vw - 32px))"
    >
      <div
        v-if="viewerOpen && preview"
        ref="viewer"
        class="tool-image__viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="preview.name"
        tabindex="-1"
      >
        <p v-if="viewerError" class="tool-image__error">{{ viewerError }}</p>
        <WorkspaceImageViewer
          v-else
          :src="src"
          :name="preview.name"
          :state="viewState"
          :active="viewerOpen"
          @state="viewState = { ...viewState, ...$event }"
          @error="viewerError = $event"
        />
      </div>
      <template #footer>
        <small class="tool-image__hint">
          {{ dimensions }} {{ __t('ui.tools', '· 滚轮缩放 · 拖动平移 · 双击切换原始尺寸') }}
        </small>
      </template>
    </PDialog>
  </section>
</template>

<style scoped>
.tool-image {
  background: var(--ui-bg-surface);
}
.tool-image > header {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-border-default);
  color: var(--ta-accent, var(--ui-accent-sky));
}
.tool-image > header strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-primary);
  font-size: 12px;
}
.tool-image > header small,
.tool-image__hint {
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.tool-image__frame {
  position: relative;
  display: grid;
  place-items: center;
  width: calc(100% - 24px);
  min-height: 100px;
  margin: 12px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--ui-border-default);
  background-color: var(--ui-bg-surface-soft);
  background-image: conic-gradient(
    var(--ui-border-subtle) 25%,
    transparent 0 50%,
    var(--ui-border-subtle) 0 75%,
    transparent 0
  );
  background-size: 16px 16px;
  cursor: zoom-in;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.tool-image__frame:disabled {
  cursor: progress;
}
.tool-image__frame:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  outline-offset: 2px;
}
.tool-image__frame:hover:not(:disabled) {
  border-color: var(--ta-accent, var(--ui-accent-sky));
  box-shadow: inset 0 0 0 1px var(--ui-border-subtle);
}
.tool-image__frame img {
  display: block;
  max-width: 100%;
  max-height: 340px;
  object-fit: contain;
  opacity: 0;
  transition: opacity 180ms ease;
}
.tool-image__frame.loaded img {
  opacity: 1;
}
.tool-image__loading {
  position: absolute;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}
.tool-image__expand {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--ui-border-default);
  color: var(--ui-text-primary);
  background: var(--ui-bg-surface);
}
.tool-image__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}
.tool-image__empty button {
  color: var(--ui-accent-sky);
  cursor: pointer;
}
.tool-image__error {
  padding: 10px 12px;
  margin: 0;
  color: var(--ui-danger);
  font-size: 12px;
}
.tool-image__viewer {
  display: flex;
  height: min(72vh, 840px);
  min-height: 180px;
}
@media (prefers-reduced-motion: reduce) {
  .tool-image__frame,
  .tool-image__frame img {
    transition: none;
  }
}
</style>
