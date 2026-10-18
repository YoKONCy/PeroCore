<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ src: string }>()
const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const position = ref(0)
const duration = ref(0)
const failed = ref(false)
const progress = computed(() => (duration.value ? (position.value / duration.value) * 100 : 0))
function time(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
function metadata() {
  const value = audio.value?.duration || 0
  duration.value = Number.isFinite(value) ? value : 0
}
async function toggle() {
  if (!audio.value) return
  try {
    if (playing.value) audio.value.pause()
    else await audio.value.play()
  } catch {
    failed.value = true
  }
}
function seek(event: Event) {
  if (audio.value) audio.value.currentTime = Number((event.target as HTMLInputElement).value)
}
watch(
  () => props.src,
  () => {
    audio.value?.pause()
    position.value = 0
    duration.value = 0
    failed.value = false
    playing.value = false
  },
)
onBeforeUnmount(() => audio.value?.pause())
</script>
<template>
  <div class="resource-audio">
    <audio
      ref="audio"
      :src="src"
      preload="metadata"
      @loadedmetadata="metadata"
      @timeupdate="position = audio?.currentTime || 0"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @error="failed = true"
    />
    <button
      type="button"
      class="resource-audio__button"
      :disabled="failed"
      :aria-label="playing ? '暂停' : '播放'"
      @click="toggle"
    >
      <svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <path
          :d="playing ? 'M3 3h3v10H3z M9 3h3v10H9z' : 'M4 2h2v2h2v2h2v2h-2v2H6v2H4z'"
          fill="currentColor"
        />
      </svg>
    </button>
    <div class="resource-audio__track" :class="{ playing }">
      <i
        v-for="index in 24"
        :key="index"
        aria-hidden="true"
        :style="{ '--bar': `${8 + ((index * 7) % 15)}px`, '--delay': `${index * 37}ms` }"
      />
      <input
        type="range"
        min="0"
        :max="duration || 1"
        step="0.1"
        :value="position"
        :disabled="!duration"
        aria-label="播放进度"
        @input="seek"
      />
      <span :style="{ width: `${progress}%` }" />
    </div>
    <time>{{ failed ? '不可播放' : time(duration || position) }}</time>
  </div>
</template>
<style scoped>
.resource-audio {
  --player-accent: var(--resource-accent, var(--ui-accent-primary));
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  width: 100%;
}
.resource-audio__button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--player-accent) 35%, var(--ui-border-default));
  color: var(--player-accent);
  background: color-mix(in srgb, var(--player-accent) 9%, var(--ui-bg-surface));
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 14%, transparent),
    1px 2px 0 var(--ui-border-subtle);
  cursor: pointer;
}
.resource-audio__button:active {
  transform: translate(1px, 1px);
  box-shadow: none;
}
.resource-audio__button:disabled {
  opacity: 0.5;
  cursor: default;
}
.resource-audio__button svg {
  width: 15px;
  height: 15px;
}
.resource-audio time {
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-mono);
  white-space: nowrap;
}
.resource-audio__track {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 3px;
  height: 26px;
  flex: 1;
  min-width: 0;
}
.resource-audio__track i {
  flex: 1;
  height: var(--bar);
  background: color-mix(in srgb, var(--player-accent) 28%, var(--ui-border-subtle));
}
.resource-audio__track.playing i {
  animation: resource-wave 850ms steps(4, end) var(--delay) infinite alternate;
}
.resource-audio__track input {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
  margin: 0;
  z-index: 2;
}
.resource-audio__track span {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--player-accent);
  pointer-events: none;
}
.resource-audio__track:focus-within {
  outline: 1px solid var(--player-accent);
  outline-offset: 3px;
}
@keyframes resource-wave {
  to {
    transform: scaleY(0.48);
    opacity: 0.65;
  }
}
@media (prefers-reduced-motion: reduce) {
  .resource-audio__track.playing i {
    animation: none;
  }
}
</style>
