<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MessageResource } from '@infos/shared'
import '@infos/shared/i18n/catalogs/petActivity'
import { t } from '../../i18n'
import { resourcePreviewKind } from '../../lib/resourceLinks'
import { resourceUrl, resourceSize } from '../../composables/resources/useResources'
import { useResourceVisibility } from '../../composables/resources/useResourceVisibility'
import ResourceAudioPlayer from '../resources/ResourceAudioPlayer.vue'
import ResourceVideoPlayer from '../resources/ResourceVideoPlayer.vue'
import ResourceGlyph from '../resources/ResourceGlyph.vue'
import PetHudIcon from './PetHudIcon.vue'

const props = defineProps<{ resource: MessageResource; active: boolean }>()
const emit = defineEmits<{ close: []; open: []; enlarge: [] }>()
const root = ref<HTMLElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const visible = useResourceVisibility(root)
const enabled = computed(() => props.active && visible.value)
const kind = computed(() => resourcePreviewKind(props.resource))
const gif = computed(
  () => props.resource.mimeType === 'image/gif' || /\.gif$/i.test(props.resource.name),
)
const format = computed(
  () => props.resource.name.match(/\.([\w]{1,8})$/)?.[1]?.toUpperCase() || kind.value.toUpperCase(),
)
const source = computed(() => resourceUrl(props.resource))
const failed = ref(false)
const paused = ref(false)
const retry = ref(0)
function retryPreview(): void {
  failed.value = false
  retry.value++
  paused.value = false
}
watch(source, () => {
  failed.value = false
  paused.value = false
})
const tr = (text: string) => t('ui.pet-activity', text)
function freeze() {
  if (!image.value?.complete || !canvas.value || !image.value.naturalWidth) return
  const scale = Math.min(1, 512 / image.value.naturalWidth, 512 / image.value.naturalHeight)
  canvas.value.width = image.value.naturalWidth * scale
  canvas.value.height = image.value.naturalHeight * scale
  const context = canvas.value.getContext('2d')
  if (!context) return
  try {
    context.drawImage(image.value, 0, 0, canvas.value.width, canvas.value.height)
    paused.value = true
  } catch {
    /* 图片尚未解码时保持播放，下一次点击可以重新暂停。 */
  }
}
function imageLoaded() {
  if (gif.value && (paused.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches))
    freeze()
}
</script>

<template>
  <article
    ref="root"
    class="pet-parcel"
    :class="['pet-parcel--' + kind, { 'pet-parcel--gif': gif }]"
  >
    <header class="pet-parcel__heading">
      <PetHudIcon
        :name="
          kind === 'audio'
            ? 'headphones'
            : kind === 'video'
              ? 'play'
              : kind === 'image'
                ? 'image'
                : 'file'
        "
        size="xs"
      />
      <span :title="resource.name">{{ resource.name }}</span>
      <small>{{ format }}</small>
      <button
        v-if="kind === 'video'"
        type="button"
        :title="tr('放大查看')"
        :aria-label="tr('放大查看')"
        @click="emit('enlarge')"
      >
        <PetHudIcon name="expand" size="xs" />
      </button>
      <button type="button" :title="tr('关闭')" :aria-label="tr('关闭')" @click="emit('close')">
        <PetHudIcon name="close" size="xs" />
      </button>
    </header>
    <template v-if="kind === 'image'">
      <button
        class="pet-parcel__photo"
        type="button"
        :aria-label="tr('放大查看')"
        @click="emit('enlarge')"
      >
        <template v-if="enabled && !failed">
          <img
            v-show="!paused"
            :key="retry"
            ref="image"
            :src="source"
            :alt="resource.caption || resource.name"
            @load="imageLoaded"
            @error="failed = true"
          />
          <canvas v-if="gif" v-show="paused" ref="canvas" :aria-label="resource.name" role="img" />
        </template>
        <span v-else-if="failed" class="pet-parcel__error">
          <PetHudIcon name="image" size="sm" />
          {{ tr('预览暂不可用') }}
        </span>
        <PetHudIcon v-if="!failed" class="pet-parcel__zoom" name="expand" size="xs" />
      </button>
      <footer class="pet-parcel__caption">
        <span>{{ resourceSize(resource.sizeBytes) || format }}</span>
        <button v-if="failed" type="button" @click="retryPreview">
          {{ tr('重试') }}
        </button>
        <button
          v-else-if="gif"
          type="button"
          :aria-pressed="!paused"
          @click="paused ? (paused = false) : freeze()"
        >
          <PetHudIcon :name="paused ? 'play' : 'pause'" size="xs" />
          {{ tr(paused ? '播放动图' : '暂停动图') }}
        </button>
        <button v-else type="button" @click="emit('enlarge')">
          {{ tr('放大查看') }}
          <PetHudIcon name="expand" size="xs" />
        </button>
      </footer>
    </template>
    <ResourceAudioPlayer
      v-else-if="kind === 'audio'"
      :src="source"
      :name="resource.name"
      :active="enabled"
      compact
    />
    <ResourceVideoPlayer
      v-else-if="kind === 'video'"
      :src="source"
      :name="resource.name"
      :active="enabled"
    />
    <template v-else>
      <button class="pet-parcel__document" type="button" @click="emit('open')">
        <div class="pet-parcel__cover">
          <ResourceGlyph :kind="kind" />
          <small>{{ format }}</small>
        </div>
        <span>
          <strong>{{ resource.name }}</strong>
          <small>{{ resourceSize(resource.sizeBytes) || format }}</small>
        </span>
      </button>
      <button type="button" class="pet-parcel__read" @click="emit('open')">
        {{ tr('在应用中阅读') }}
        <PetHudIcon name="chevron-right" size="xs" />
      </button>
    </template>
  </article>
</template>

<style scoped src="./pet-delivery-card.css" />
