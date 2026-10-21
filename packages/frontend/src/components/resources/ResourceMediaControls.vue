<script setup lang="ts">
import { computed } from 'vue'
import '@infos/shared/i18n/catalogs/mediaPlayer'
import { t } from '../../i18n'
import { PixelIcon } from '../pixel'
import { mediaTime, type useMediaPlayer } from '../../composables/resources/useMediaPlayer'
import './resource-media.css'

const props = withDefaults(
  defineProps<{
    controller: ReturnType<typeof useMediaPlayer>
    active?: boolean
    fullscreen?: boolean
    canFullscreen?: boolean
  }>(),
  { active: true, fullscreen: false, canFullscreen: false },
)
const emit = defineEmits<{ fullscreen: [] }>()
const tr = (source: string, values: readonly unknown[] = []) => t('ui.media-player', source, values)
const state = props.controller.state
const percent = computed(() =>
  state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0,
)
const buffered = computed(() =>
  state.duration ? Math.min(100, (state.buffered / state.duration) * 100) : 0,
)
function seek(event: Event) {
  props.controller.seek(Number((event.target as HTMLInputElement).value))
}
function volume(event: Event) {
  state.volume = Number((event.target as HTMLInputElement).value)
  state.muted = state.volume === 0
}
function rate(event: Event) {
  state.rate = Number((event.target as HTMLSelectElement).value)
}
</script>
<template>
  <div class="media-controls">
    <div class="media-controls__timeline">
      <input
        class="media-range media-controls__seek"
        type="range"
        min="0"
        :max="state.duration || 1"
        step="0.1"
        :value="state.position"
        :disabled="!state.duration || Boolean(state.error)"
        :aria-label="tr('播放进度')"
        :aria-valuetext="tr('{0} / {1}', [mediaTime(state.position), mediaTime(state.duration)])"
        :style="{ '--progress': `${percent}%`, '--buffered': `${buffered}%` }"
        @input="seek"
      />
      <div class="media-controls__times" aria-hidden="true">
        <time>{{ mediaTime(state.position) }}</time>
        <time>{{ mediaTime(state.duration) }}</time>
      </div>
    </div>
    <div class="media-controls__row">
      <div class="media-controls__transport">
        <button
          type="button"
          class="media-button media-controls__skip"
          :disabled="!state.duration || Boolean(state.error)"
          :title="tr('后退10秒')"
          :aria-label="tr('后退10秒')"
          @click="controller.skip(-10)"
        >
          <PixelIcon name="rewind" size="sm" />
        </button>
        <button
          type="button"
          class="media-button media-button--play"
          :disabled="!active || Boolean(state.error)"
          :title="tr(state.playing ? '暂停' : '播放')"
          :aria-label="tr(state.playing ? '暂停' : '播放')"
          @click="controller.toggle"
        >
          <span v-if="state.waiting" class="media-spinner" aria-hidden="true" />
          <PixelIcon v-else :name="state.playing ? 'pause' : 'play'" size="md" />
        </button>
        <button
          type="button"
          class="media-button media-controls__skip"
          :disabled="!state.duration || Boolean(state.error)"
          :title="tr('前进10秒')"
          :aria-label="tr('前进10秒')"
          @click="controller.skip(10)"
        >
          <PixelIcon name="forward" size="sm" />
        </button>
      </div>
      <div class="media-controls__options">
        <button
          type="button"
          class="media-button"
          :class="{ 'media-button--selected': state.loop }"
          :aria-pressed="state.loop"
          :title="tr('循环播放')"
          :aria-label="tr('循环播放')"
          @click="state.loop = !state.loop"
        >
          <PixelIcon name="repeat" size="sm" />
        </button>
        <select
          class="media-controls__rate"
          :value="state.rate"
          :title="tr('播放速度')"
          :aria-label="tr('播放速度')"
          @change="rate"
        >
          <option v-for="speed in [0.5, 0.75, 1, 1.25, 1.5, 2]" :key="speed" :value="speed">
            {{ speed }}×
          </option>
        </select>
        <div class="media-controls__volume">
          <button
            type="button"
            class="media-button"
            :title="tr(state.muted || !state.volume ? '取消静音' : '静音')"
            :aria-label="tr(state.muted || !state.volume ? '取消静音' : '静音')"
            :aria-pressed="state.muted || !state.volume"
            @click="controller.toggleMute"
          >
            <PixelIcon :name="state.muted || !state.volume ? 'volume-off' : 'volume'" size="sm" />
          </button>
          <input
            class="media-range media-controls__volume-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="state.muted ? 0 : state.volume"
            :aria-label="tr('音量')"
            :style="{ '--progress': `${(state.muted ? 0 : state.volume) * 100}%` }"
            @input="volume"
          />
        </div>
        <button
          v-if="canFullscreen"
          type="button"
          class="media-button"
          :title="tr(fullscreen ? '退出全屏' : '全屏')"
          :aria-label="tr(fullscreen ? '退出全屏' : '全屏')"
          @click="emit('fullscreen')"
        >
          <PixelIcon :name="fullscreen ? 'minimize' : 'maximize'" size="sm" />
        </button>
      </div>
    </div>
    <div v-if="state.error" class="media-controls__error" role="alert">
      <PixelIcon name="alert" size="sm" />
      <span>{{ tr(state.error === 'format' ? '格式不支持，可下载后打开' : '暂时无法播放') }}</span>
      <button type="button" :disabled="!active" @click="controller.retry">{{ tr('重试') }}</button>
    </div>
  </div>
</template>
<style scoped>
.media-controls {
  min-width: 0;
}
.media-controls__timeline {
  padding: 2px 0 0;
}
.media-controls__seek {
  display: block;
  width: 100%;
}
.media-controls__times {
  display: flex;
  justify-content: space-between;
  margin-top: -2px;
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-mono);
  font-variant-numeric: tabular-nums;
}
.media-controls__times time:first-child {
  color: var(--media-accent);
}
.media-controls__row,
.media-controls__transport,
.media-controls__options,
.media-controls__volume {
  display: flex;
  align-items: center;
}
.media-controls__row {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.media-controls__transport {
  gap: 4px;
}
.media-controls__options {
  gap: 2px;
  margin-left: auto;
}
.media-controls__rate {
  width: 53px;
  height: 32px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--ui-text-secondary);
  background: transparent;
  font: 10px var(--ui-font-mono);
  cursor: pointer;
}
.media-controls__rate:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-hover);
}
.media-controls__rate option {
  color: var(--ui-text-primary);
  background: var(--ui-bg-surface);
}
.media-controls__volume-range {
  width: 48px;
  margin-left: 2px;
}
.media-controls__error {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  color: var(--ui-danger);
  font-size: 11px;
}
.media-controls__error > span {
  flex: 1;
}
.media-controls__error button {
  flex-shrink: 0;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--ui-border-default);
  border-radius: 4px;
  color: var(--ui-text-primary);
  background: var(--ui-bg-surface);
  cursor: pointer;
}
@container resource-player (max-width: 350px) {
  .media-controls__volume-range {
    display: none;
  }
  .media-controls__transport {
    gap: 0;
  }
  .media-controls__options {
    gap: 0;
  }
}
@media (pointer: coarse) {
  .media-controls__rate {
    min-height: 40px;
  }
  .media-controls__volume-range {
    display: none;
  }
}
</style>
