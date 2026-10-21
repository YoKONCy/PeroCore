<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed } from 'vue'
import type { MessageResource } from '@infos/shared'
import ResourceGlyph from './ResourceGlyph.vue'
import ResourceInlinePreview from './ResourceInlinePreview.vue'
import { resourcePreviewKind } from '../../lib/resourceLinks'
import { t } from '../../i18n'
import { PixelIcon } from '../pixel'
import {
  openResource,
  previewResource,
  resourceSize,
  resourceUrl,
} from '../../composables/resources/useResources'
const props = withDefaults(
  defineProps<{ resource: MessageResource; label?: string; active?: boolean }>(),
  { active: true, label: undefined },
)
const kind = computed(() => resourcePreviewKind(props.resource))
const format = computed(
  () =>
    props.resource.name.split('.').pop()?.slice(0, 7).toUpperCase() ||
    props.resource.kind.toUpperCase(),
)
</script>
<template>
  <article class="resource-card" :class="`resource-card--${kind}`">
    <ResourceInlinePreview :resource="resource" :active="active" @open="openResource(resource)" />
    <div class="resource-card__body">
      <ResourceGlyph v-if="kind !== 'image' && kind !== 'video'" :kind="kind" />
      <div class="resource-card__copy">
        <button
          type="button"
          class="resource-card__name"
          :title="resource.name"
          @click="openResource(resource)"
        >
          {{ label || resource.name }}
        </button>
        <span class="resource-card__meta">
          {{ format }}
          <span v-if="resource.sizeBytes">· {{ resourceSize(resource.sizeBytes) }}</span>
        </span>
      </div>
      <button
        type="button"
        class="resource-card__action"
        :title="t('ui.resource-preview', '放大预览')"
        :aria-label="t('ui.resource-preview', '放大预览')"
        @click="previewResource(resource)"
      >
        <PixelIcon name="maximize" size="xs" />
      </button>
      <a
        v-if="resourceUrl(resource, true)"
        class="resource-card__action"
        :href="resourceUrl(resource, true)"
        :download="resource.name"
        :target="!resource.id && resource.origin?.type === 'url' ? '_blank' : undefined"
        rel="noopener noreferrer"
        :title="__t('ui.resources', '下载')"
        :aria-label="__t('ui.resources', '下载文件')"
      >
        <PixelIcon name="download" size="xs" />
      </a>
    </div>
    <p v-if="resource.caption" class="resource-card__caption" :title="resource.caption">
      {{ resource.caption }}
    </p>
    <button
      v-if="
        resource.origin &&
        resource.origin.type !== 'application' &&
        !(resource.origin.type === 'workspace' && resource.origin.taskId)
      "
      type="button"
      class="resource-card__source"
      @click="openResource(resource, true)"
    >
      <PixelIcon name="link" size="xs" />
      {{
        resource.origin.type === 'workspace'
          ? __t('ui.resources', '源文件')
          : __t('ui.resources', '来源')
      }}
      <span>↗</span>
    </button>
  </article>
</template>
<style scoped>
.resource-card {
  --resource-accent: var(--ui-accent-sky);
  position: relative;
  isolation: isolate;
  width: min(100%, 380px);
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
