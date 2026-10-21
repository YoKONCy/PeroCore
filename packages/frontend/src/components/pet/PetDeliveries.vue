<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { MessageResource } from '@infos/shared'
import '@infos/shared/i18n/catalogs/petActivity'
import { t } from '../../i18n'
import { resourcePreviewKind } from '../../lib/resourceLinks'
import { resourceUrl } from '../../composables/resources/useResources'
import PetDeliveryCard from './PetDeliveryCard.vue'
import PetHudIcon from './PetHudIcon.vue'
import type { PetUiRect } from '../../composables/pet/usePetActivity'
import ResourceVideoPlayer from '../resources/ResourceVideoPlayer.vue'

const props = defineProps<{
  items: MessageResource[]
  deliveryKey: string
  active: boolean
  bounds: PetUiRect
  bubble?: PetUiRect | null
  viewport: { width: number; height: number }
}>()
const emit = defineEmits<{
  open: [item: MessageResource]
  collapse: []
  'ui-enter': []
  'ui-leave': []
  'play-media': []
}>()
const tr = (source: string, values: readonly unknown[] = []) => t('ui.pet-activity', source, values)
const dismissed = ref(new Set<string>())
const page = ref(0)
const preview = ref<MessageResource | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const failed = ref(false)
function resetDismissed(): void {
  dismissed.value = new Set()
  page.value = 0
}
function previewClosed(): void {
  preview.value = null
  emit('ui-leave')
}
function key(item: MessageResource) {
  return item.id || `${item.origin?.type}:${item.origin?.value}`
}
const available = computed(() => props.items.filter((item) => !dismissed.value.has(key(item))))
const lane = computed(() => {
  const { width, height } = props.viewport
  const b = props.bounds
  const gap = 18
  const candidates: Array<PetUiRect> = [
    { left: 12, right: Math.max(12, b.left - gap), top: 12, bottom: height - 12 },
    { left: Math.min(width - 12, b.right + gap), right: width - 12, top: 12, bottom: height - 12 },
    { left: 12, right: width - 12, top: 12, bottom: Math.max(12, b.top - gap) },
    {
      left: 12,
      right: width - 12,
      top: Math.min(height - 12, b.bottom + gap),
      bottom: height - 12,
    },
  ]
  const spaces = candidates.flatMap((rect) => {
    const bubble = props.bubble
    if (
      !bubble ||
      bubble.right + gap <= rect.left ||
      bubble.left - gap >= rect.right ||
      bubble.bottom + gap <= rect.top ||
      bubble.top - gap >= rect.bottom
    )
      return [rect]
    return [
      { ...rect, bottom: Math.max(rect.top, bubble.top - gap) },
      { ...rect, top: Math.min(rect.bottom, bubble.bottom + gap) },
    ]
  })
  const score = (rect: PetUiRect) =>
    Math.min(300, rect.right - rect.left) * Math.min(600, rect.bottom - rect.top)
  const usable = spaces.filter(
    (rect) => rect.right - rect.left >= 150 && rect.bottom - rect.top >= 120,
  )
  const best = usable.sort((a, b) => score(b) - score(a))[0]
  // 极小桌宠窗口只显示一张可滚动的小卡片，并尽量远离气泡和模型中心。
  const region = best || spaces.sort((a, b) => score(b) - score(a))[0] || candidates[0]!
  const w = Math.min(300, Math.max(120, region.right - region.left), Math.max(0, width - 24))
  const h = Math.max(80, region.bottom - region.top)
  return {
    left: Math.max(12, Math.min(region.left, width - w - 12)),
    top: Math.max(12, region.top),
    width: w,
    height: h,
  }
})
const pageSize = computed(() =>
  Math.max(1, Math.min(3, Math.floor((lane.value.height - 40) / 180))),
)
const pages = computed(() => Math.max(1, Math.ceil(available.value.length / pageSize.value)))
const visible = computed(() =>
  available.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value),
)
const placement = computed(() => ({
  left: lane.value.left + 'px',
  top: lane.value.top + 'px',
  width: lane.value.width + 'px',
  maxHeight: lane.value.height + 'px',
}))
watch(pages, (count) => {
  page.value = Math.min(page.value, count - 1)
})
watch(
  () => props.deliveryKey,
  () => {
    dismissed.value = new Set()
    page.value = 0
    closePreview()
  },
)
watch(
  () => props.active,
  (active) => {
    if (!active) closePreview()
  },
)
function close(item: MessageResource) {
  dismissed.value = new Set([...dismissed.value, key(item)])
  if (preview.value && key(preview.value) === key(item)) closePreview()
}
function closePreview() {
  dialog.value?.close()
  preview.value = null
  emit('ui-leave')
}
async function enlarge(item: MessageResource) {
  preview.value = item
  failed.value = false
  await nextTick()
  if (!props.active || preview.value !== item || !dialog.value?.isConnected) return
  if (!dialog.value.open) dialog.value.showModal()
  emit('ui-enter')
}
onBeforeUnmount(closePreview)
</script>

<template>
  <section
    v-show="active"
    data-pet-ui
    class="pet-deliveries"
    :style="placement"
    :aria-label="tr('送给你的小成果')"
    @pointerenter="emit('ui-enter')"
    @pointerleave="emit('ui-leave')"
    @focusin="emit('ui-enter')"
    @focusout="emit('ui-leave')"
    @play.capture="emit('play-media')"
  >
    <header class="pet-deliveries__heading">
      <PetHudIcon name="sparkle" size="xs" />
      <span>{{ tr('交付 {0}', [items.length]) }}</span>
      <button
        v-if="dismissed.size"
        type="button"
        :title="tr('重新展开')"
        :aria-label="tr('重新展开')"
        @click="resetDismissed"
      >
        <PetHudIcon name="refresh" size="xs" />
      </button>
      <button
        type="button"
        :title="tr('收起交付')"
        :aria-label="tr('收起交付')"
        @click="emit('collapse')"
      >
        <PetHudIcon name="close" size="xs" />
      </button>
    </header>
    <div class="pet-deliveries__cards">
      <PetDeliveryCard
        v-for="item in visible"
        :key="key(item)"
        :resource="item"
        :active="active && !preview"
        @close="close(item)"
        @open="emit('open', item)"
        @enlarge="enlarge(item)"
      />
    </div>
    <nav v-if="pages > 1" class="pet-deliveries__pages">
      <button type="button" :disabled="page === 0" :aria-label="tr('上一页')" @click="page--">
        <PetHudIcon name="chevron-left" size="xs" />
      </button>
      <span>{{ tr('{0} / {1}', [page + 1, pages]) }}</span>
      <button
        type="button"
        :disabled="page >= pages - 1"
        :aria-label="tr('下一页')"
        @click="page++"
      >
        <PetHudIcon name="chevron-right" size="xs" />
      </button>
    </nav>
  </section>
  <dialog
    ref="dialog"
    data-pet-ui
    class="pet-delivery-preview"
    :aria-label="preview?.name"
    @play.capture="emit('play-media')"
    @cancel.prevent="closePreview"
    @close="previewClosed"
    @pointerenter="emit('ui-enter')"
    @pointerleave="emit('ui-leave')"
    @click="
      (event) => {
        if (event.target === dialog) closePreview()
      }
    "
  >
    <template v-if="preview">
      <header>
        <strong>{{ preview.name }}</strong>
        <button type="button" :aria-label="tr('关闭')" @click="closePreview">
          <PetHudIcon name="close" size="xs" />
        </button>
      </header>
      <ResourceVideoPlayer
        v-if="resourcePreviewKind(preview) === 'video'"
        :src="resourceUrl(preview)"
        :name="preview.name"
        :active="active"
        expanded
      />
      <img
        v-else-if="!failed"
        :src="resourceUrl(preview)"
        :alt="preview.caption || preview.name"
        @error="failed = true"
      />
      <p v-else>{{ tr('预览暂不可用') }}</p>
    </template>
  </dialog>
</template>

<style scoped>
.pet-deliveries {
  position: absolute;
  z-index: 115;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
  box-sizing: border-box;
  padding: 3px;
}
.pet-deliveries__heading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  flex-shrink: 0;
  color: var(--pet-bubble-name);
  background: var(--pet-bubble-fill);
  border: 1px solid var(--pet-bubble-rim);
  border-radius: 5px;
  font-size: 10px;
}
.pet-deliveries__heading span {
  flex: 1;
}
.pet-deliveries button,
.pet-delivery-preview button {
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.pet-deliveries button:focus-visible,
.pet-delivery-preview button:focus-visible {
  outline: 2px solid var(--pet-accent);
}
.pet-deliveries__cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 0 3px 4px 0;
}
.pet-deliveries__cards > * {
  flex-shrink: 0;
}
.pet-deliveries__pages {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 1px 5px;
  background: var(--pet-bubble-fill);
  border: 1px solid var(--pet-bubble-rim);
  border-radius: 4px;
  font-size: 10px;
  flex-shrink: 0;
}
.pet-deliveries button:disabled {
  opacity: 0.3;
  cursor: default;
}
.pet-delivery-preview {
  box-sizing: border-box;
  width: min(560px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  border: 1px solid var(--pet-bubble-rim);
  border-radius: 9px 9px 3px 9px;
  padding: 10px;
  background: var(--pet-bubble-fill);
  color: var(--pet-bubble-ink);
  pointer-events: auto;
  box-shadow: 0 5px 25px var(--pet-cast);
  font: inherit;
}
.pet-delivery-preview::backdrop {
  background: rgba(19, 26, 43, 0.22);
}
.pet-delivery-preview header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}
.pet-delivery-preview strong {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.pet-delivery-preview img {
  display: block;
  width: 100%;
  max-height: calc(100vh - 95px);
  object-fit: contain;
}
.pet-deliveries__cards > * {
  animation: pet-parcel-in 0.22s steps(4) both;
}
@keyframes pet-parcel-in {
  from {
    opacity: 0;
    translate: 0 5px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pet-deliveries__cards > * {
    animation: none;
  }
}
</style>
