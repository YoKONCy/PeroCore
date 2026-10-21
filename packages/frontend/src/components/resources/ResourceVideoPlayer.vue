<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import '@infos/shared/i18n/catalogs/mediaPlayer'
import { t } from '../../i18n'
import { PixelIcon } from '../pixel'
import { useMediaPlayer } from '../../composables/resources/useMediaPlayer'
import ResourceMediaControls from './ResourceMediaControls.vue'

const props = withDefaults(
  defineProps<{ src: string; name?: string; active?: boolean; expanded?: boolean }>(),
  {
    name: '',
    active: true,
    expanded: false,
  },
)
const root = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const controller = useMediaPlayer(
  video,
  () => props.src,
  () => props.active,
)
const { state } = controller
const fullscreen = ref(false)
const fullscreenError = ref(false)
const tr = (source: string) => t('ui.media-player', source)
const hasFullscreen = computed(() =>
  Boolean(
    document.fullscreenEnabled ||
    (video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)
      ?.webkitEnterFullscreen,
  ),
)
function syncFullscreen() {
  fullscreen.value = document.fullscreenElement === root.value
}
async function toggleFullscreen() {
  fullscreenError.value = false
  try {
    if (document.fullscreenElement === root.value) await document.exitFullscreen()
    else if (root.value?.requestFullscreen && document.fullscreenEnabled)
      await root.value.requestFullscreen()
    else
      (
        video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      )?.webkitEnterFullscreen?.()
  } catch {
    fullscreenError.value = true
  }
}
onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreen))
</script>
<template>
  <section
    ref="root"
    class="resource-video resource-media"
    :class="{ 'resource-video--expanded': expanded }"
    tabindex="0"
    :aria-label="name || tr('视频')"
    :aria-description="tr('播放快捷键：空格播放或暂停，方向键快进或后退，M静音')"
    @keydown="controller.keyboard"
  >
    <div class="resource-video__stage">
      <video
        ref="video"
        :src="src"
        :aria-label="name || tr('视频')"
        playsinline
        preload="metadata"
        v-on="controller.events"
        @click="controller.toggle"
        @dblclick="toggleFullscreen"
      />
      <button
        v-if="!state.playing && !state.error && !state.waiting"
        type="button"
        class="resource-video__play"
        :disabled="!active"
        :aria-label="tr('播放')"
        @click="controller.toggle"
      >
        <PixelIcon name="play" size="lg" />
      </button>
      <div v-if="state.waiting" class="resource-video__buffer" role="status">
        <span class="media-spinner" aria-hidden="true" />
        {{ tr('缓冲中…') }}
      </div>
      <div v-if="state.error" class="resource-video__unavailable" aria-hidden="true">
        <PixelIcon name="alert" size="xl" />
        <span>{{ tr('暂时无法播放') }}</span>
      </div>
    </div>
    <div class="resource-video__controls">
      <ResourceMediaControls
        :controller="controller"
        :active="active"
        :can-fullscreen="hasFullscreen"
        :fullscreen="fullscreen"
        @fullscreen="toggleFullscreen"
      />
      <small v-if="fullscreenError" role="status">{{ tr('无法全屏，请放大预览') }}</small>
    </div>
  </section>
</template>
<style scoped>
.resource-video {
  --media-accent: var(--resource-accent, var(--ui-accent-purple));
  background: var(--ui-bg-surface-soft);
}
.resource-video__stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #101218;
}
.resource-video video {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  position: absolute;
  inset: 0;
  object-fit: contain;
  cursor: pointer;
}
.resource-video__play {
  position: absolute;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  padding: 0 0 0 3px;
  border: 1px solid color-mix(in srgb, var(--media-accent) 65%, white);
  border-radius: 15px;
  color: white;
  background: color-mix(in srgb, var(--media-accent) 30%, #171825b3);
  backdrop-filter: blur(8px);
  box-shadow: 3px 4px 0 #0003;
  cursor: pointer;
  transition:
    transform 150ms,
    background 150ms;
}
.resource-video__play:hover {
  transform: scale(1.07);
  background: color-mix(in srgb, var(--media-accent) 55%, #171825);
}
.resource-video__play:active {
  transform: scale(0.96);
}
.resource-video__play:disabled {
  opacity: 0.5;
  cursor: default;
}
.resource-video__buffer {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid #ffffff26;
  border-radius: 8px;
  color: #fff;
  background: #101218c9;
  font-size: 12px;
  pointer-events: none;
}
.resource-video__unavailable {
  position: absolute;
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  color: #c9c5d5;
  font-size: 12px;
  pointer-events: none;
}
.resource-video__controls {
  padding: 4px 12px 12px;
  border-top: 1px solid var(--ui-border-subtle);
}
.resource-video__controls small {
  display: block;
  margin-top: 10px;
  color: var(--ui-text-secondary);
  font-size: 11px;
}
.resource-video--expanded .resource-video__stage {
  max-height: 49vh;
}
.resource-video:fullscreen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 0;
  background: #101218;
}
.resource-video:fullscreen .resource-video__stage {
  flex: 1;
  min-height: 0;
  max-height: none;
  aspect-ratio: auto;
}
.resource-video:fullscreen .resource-video__controls {
  flex-shrink: 0;
  padding: 4px max(20px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom))
    max(20px, env(safe-area-inset-left));
  background: var(--ui-bg-surface);
}
@media (prefers-reduced-motion: reduce) {
  .resource-video__play {
    transition: none;
  }
}
</style>
