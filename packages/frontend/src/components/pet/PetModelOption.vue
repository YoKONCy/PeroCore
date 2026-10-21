<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import PetHudIcon from './PetHudIcon.vue'

defineProps<{
  name: string
  thumbnail?: string
  selected?: boolean
  loading?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ (event: 'select'): void }>()
</script>

<template>
  <button
    type="button"
    class="model-option"
    :class="{ 'is-selected': selected, 'is-loading': loading }"
    :title="name"
    :aria-label="name"
    :aria-pressed="!!selected"
    :aria-busy="!!loading"
    :disabled="disabled"
    @click="emit('select')"
  >
    <span class="model-thumb">
      <img v-if="thumbnail" :src="thumbnail" alt="" />
      <PetHudIcon v-else name="wardrobe" size="lg" class="model-placeholder" />
      <span v-if="selected || loading" class="model-mark" aria-hidden="true">
        <PetHudIcon :name="loading ? 'thought' : 'check'" size="xs" />
      </span>
    </span>
    <span class="model-name">{{ loading ? __t('ui.pet', '换装中…') : name }}</span>
  </button>
</template>

<style scoped>
/* 头像与名字位于同一块轻薄造型格中，保留一格亮边和短侧面。 */
.model-option {
  --model-side: var(--pet-side);
  --model-depth:
    inset 1px 1px 0 var(--pet-highlight), inset -1px -2px 0 var(--pet-shade),
    1px 2px 0 var(--model-side);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 4px 8px;
  border: 0;
  border-radius: 0;
  background: var(--pet-control-fill);
  box-shadow: var(--model-depth);
  color: var(--pet-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    transform 0.12s steps(2),
    color 0.12s steps(2),
    box-shadow 0.12s steps(2);
}
.model-option:hover:not(:disabled) {
  background: var(--pet-control-fill);
  transform: translateY(-1px);
  box-shadow:
    var(--model-depth),
    1px 3px 0 var(--pet-cast);
}
.model-option:active:not(:disabled) {
  transform: translate(1px, 2px);
  box-shadow:
    var(--pet-pressed-shadow),
    1px 1px 0 var(--model-side);
}
.model-option:focus-visible {
  outline: 1px solid var(--pet-accent);
  outline-offset: 3px;
}
.model-thumb {
  position: relative;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  background: linear-gradient(transparent, var(--pet-divider));
}
.model-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: pixelated;
}
.model-placeholder {
  color: var(--pet-accent);
  filter: drop-shadow(1px 2px 0 var(--pet-shade));
}
.model-name {
  width: 100%;
  padding-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
  font-size: 11px;
}
.model-option.is-selected {
  color: var(--pet-text);
  background: var(--pet-control-fill);
  box-shadow:
    var(--model-depth),
    0 0 0 1px var(--pet-pink);
}
.model-mark {
  position: absolute;
  right: 2px;
  top: 2px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 0;
  background: transparent;
  color: var(--pet-pink);
}
.model-option:disabled {
  opacity: 0.5;
  cursor: wait;
}
.model-option.is-loading {
  opacity: 1;
  color: var(--pet-accent);
}
.is-loading .model-mark {
  color: var(--pet-accent);
}
@media (prefers-reduced-motion: reduce) {
  .model-option {
    transition: none;
  }
}
</style>
