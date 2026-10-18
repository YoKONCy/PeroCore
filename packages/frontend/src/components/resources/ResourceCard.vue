<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MessageResource } from '@infos/shared'
import ResourceGlyph from './ResourceGlyph.vue'
import ResourceAudioPlayer from './ResourceAudioPlayer.vue'
import { PixelIcon } from '../pixel'
import { openResource, resourceSize, resourceUrl } from '../../composables/resources/useResources'
const props = defineProps<{ resource: MessageResource }>()
const url = computed(() => resourceUrl(props.resource))
const mediaFailed = ref(false)
const format = computed(
  () =>
    props.resource.name.split('.').pop()?.slice(0, 7).toUpperCase() ||
    props.resource.kind.toUpperCase(),
)
</script>
<template>
  <article class="resource-card" :class="`resource-card--${resource.kind}`">
    <button
      v-if="resource.kind === 'image' || resource.kind === 'video'"
      type="button"
      class="resource-card__preview"
      :aria-label="`查看${resource.name}`"
      @click="openResource(resource)"
    >
      <img
        v-if="resource.kind === 'image' && !mediaFailed"
        :src="url"
        :alt="resource.name"
        loading="lazy"
        @error="mediaFailed = true"
      />
      <video
        v-else-if="resource.kind === 'video' && !mediaFailed"
        :src="url"
        preload="metadata"
        muted
        aria-hidden="true"
        @error="mediaFailed = true"
      />
      <ResourceGlyph v-else :kind="resource.kind" />
      <span v-if="resource.kind === 'video'" class="resource-card__play" aria-hidden="true">▶</span>
      <span class="resource-card__format">{{ format }}</span>
    </button>
    <div class="resource-card__body">
      <ResourceGlyph
        v-if="resource.kind !== 'image' && resource.kind !== 'video'"
        :kind="resource.kind"
      />
      <div class="resource-card__copy">
        <button
          type="button"
          class="resource-card__name"
          :title="resource.name"
          @click="openResource(resource)"
        >
          {{ resource.name }}
        </button>
        <span class="resource-card__meta">
          {{ format }}
          <span v-if="resource.sizeBytes">· {{ resourceSize(resource.sizeBytes) }}</span>
        </span>
      </div>
      <a
        class="resource-card__action"
        :href="resourceUrl(resource, true)"
        :download="resource.name"
        :target="!resource.id && resource.origin?.type === 'url' ? '_blank' : undefined"
        rel="noopener noreferrer"
        title="下载"
        aria-label="下载文件"
      >
        <PixelIcon name="download" size="xs" />
      </a>
    </div>
    <ResourceAudioPlayer v-if="resource.kind === 'audio'" :src="url" class="resource-card__audio" />
    <p v-if="resource.caption" class="resource-card__caption" :title="resource.caption">
      {{ resource.caption }}
    </p>
    <button
      v-if="resource.origin"
      type="button"
      class="resource-card__source"
      @click="openResource(resource, true)"
    >
      <PixelIcon name="link" size="xs" />
      {{ resource.origin.type === 'workspace' ? '源文件' : '来源' }}
      <span>↗</span>
    </button>
  </article>
</template>
<style scoped>
.resource-card {
  --resource-accent: var(--ui-accent-sky);
  position: relative;
  isolation: isolate;
  width: min(100%, 340px);
  overflow: hidden;
  margin: 10px 0 12px;
  color: var(--ui-text-primary);
  border: 1px solid color-mix(in srgb, var(--resource-accent) 26%, var(--ui-border-default));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--resource-accent) 7%, transparent),
      transparent 58%
    ),
    color-mix(in srgb, var(--ui-bg-surface) 90%, transparent);
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 13%, transparent),
    inset -1px -1px color-mix(in srgb, black 9%, transparent),
    2px 3px 0 color-mix(in srgb, var(--resource-accent) 12%, var(--ui-bg-surface));
  animation: resource-arrive 230ms steps(4, end) both;
  transition:
    border-color 160ms,
    box-shadow 160ms;
}
.resource-card::before {
  position: absolute;
  top: 0;
  left: 13px;
  width: 22px;
  height: 2px;
  background: var(--resource-accent);
  content: '';
  z-index: 2;
}
.resource-card:hover {
  border-color: color-mix(in srgb, var(--resource-accent) 65%, var(--ui-border-default));
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 16%, transparent),
    2px 4px 0 color-mix(in srgb, var(--resource-accent) 17%, var(--ui-bg-surface));
}
.resource-card--audio {
  --resource-accent: var(--ui-accent-primary);
}
.resource-card--video {
  --resource-accent: var(--ui-accent-purple);
}
.resource-card__body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 12px 12px;
}
.resource-card__copy {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.resource-card__name {
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.resource-card__name:hover {
  color: var(--resource-accent);
}
.resource-card__meta {
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-mono);
}
.resource-card__action {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  color: var(--ui-text-secondary);
  border: 1px solid var(--ui-border-subtle);
  text-decoration: none;
  background: color-mix(in srgb, var(--ui-bg-surface) 80%, transparent);
  transition:
    color 130ms,
    transform 130ms steps(2, end);
}
.resource-card__action:hover {
  color: var(--resource-accent);
  transform: translateY(-1px);
}
.resource-card__preview {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 166px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--ui-border-subtle);
  overflow: hidden;
  background: color-mix(in srgb, var(--resource-accent) 5%, var(--ui-bg-surface));
  cursor: zoom-in;
}
.resource-card__preview img,
.resource-card__preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 220ms ease;
}
.resource-card__preview:hover img,
.resource-card__preview:hover video {
  transform: scale(1.025);
}
.resource-card__format {
  position: absolute;
  right: 9px;
  bottom: 8px;
  padding: 2px 5px;
  background: rgba(14, 18, 30, 0.76);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font: 9px var(--ui-font-mono);
}
.resource-card__play {
  position: absolute;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  background: color-mix(in srgb, var(--ui-bg-surface) 86%, transparent);
  border: 1px solid var(--resource-accent);
  color: var(--resource-accent);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.25);
  font-size: 14px;
}
.resource-card__caption {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0 13px 10px;
  color: var(--ui-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.resource-card__source {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-top: 1px solid var(--ui-border-subtle);
  background: color-mix(in srgb, var(--resource-accent) 3%, transparent);
  color: var(--ui-text-tertiary);
  font: 10px var(--ui-font-pixel);
  cursor: pointer;
}
.resource-card__source span {
  margin-left: auto;
  color: var(--resource-accent);
}
.resource-card__source:hover {
  color: var(--resource-accent);
}
.resource-card__audio {
  margin: -2px 12px 12px;
  width: calc(100% - 24px);
}
@keyframes resource-arrive {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .resource-card {
    animation: none;
  }
  .resource-card,
  .resource-card * {
    transition: none;
  }
}
</style>
