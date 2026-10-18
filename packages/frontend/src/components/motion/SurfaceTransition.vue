<script setup lang="ts">
import { computed, inject, provide, ref, shallowRef, toRef } from 'vue'
import { useSurfaceMotion } from '../../composables/ui/useSurfaceMotion'

const props = withDefaults(
  defineProps<{
    identity: string | number
    pending?: boolean
    direction?: number
    variant?: 'page' | 'conversation' | 'panel'
    fill?: boolean
    label?: string
    active?: boolean
    independent?: boolean
  }>(),
  { pending: false, direction: 1, variant: 'page', fill: false, label: '正在切换', active: true },
)
const content = ref<HTMLElement | null>(null)
const mainVisible = inject('infos:main-surface-visible', shallowRef(true))
const material = inject('infos:app-background-active', shallowRef(false))
const ancestorAnimating = inject('infos:surface-motion-active', shallowRef(false))
const active = computed(() => props.active && (props.independent || mainVisible.value))
const { phase, level } = useSurfaceMotion(
  content,
  toRef(props, 'identity'),
  toRef(props, 'pending'),
  active,
  toRef(props, 'direction'),
  toRef(props, 'variant'),
  material,
  ancestorAnimating,
)
provide(
  'infos:surface-motion-active',
  computed(() => phase.value !== 'idle'),
)
</script>

<template>
  <div
    class="surface-transition"
    :class="[
      `surface-transition--${variant}`,
      `is-${phase}`,
      { 'surface-transition--fill': fill, 'surface-transition--material': material },
    ]"
    :data-motion-level="level"
    :aria-busy="pending"
    :style="{ '--surface-shift': `${direction * (variant === 'page' ? 12 : 6)}px` }"
  >
    <div ref="content" class="surface-transition__content" :inert="pending || undefined">
      <slot />
    </div>
    <div class="surface-transition__veil" :class="{ 'is-visible': pending }" aria-hidden="true">
      <div class="surface-transition__trail" />
      <div v-if="variant === 'conversation'" class="surface-transition__conversation">
        <div v-for="row in 3" :key="row" class="surface-transition__message">
          <i class="surface-transition__avatar" />
          <div>
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
      <div v-else class="surface-transition__page">
        <div class="surface-transition__heading">
          <i />
          <i />
        </div>
        <div class="surface-transition__panels">
          <div v-for="panel in 3" :key="panel">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </div>
    <span v-if="pending" class="surface-transition__status" role="status">{{ label }}</span>
  </div>
</template>

<style scoped>
.surface-transition {
  position: relative;
  isolation: isolate;
  min-width: 0;
  min-height: 0;
}
.surface-transition--fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.surface-transition__content {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 0;
}
.surface-transition--fill > .surface-transition__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
}
.is-departing > .surface-transition__content,
.is-waiting > .surface-transition__content {
  opacity: 0.08;
  transform: translate3d(calc(-1 * var(--surface-shift)), 0, 0);
}
.is-departing > .surface-transition__content,
.is-entering > .surface-transition__content {
  will-change: transform, opacity;
}
.surface-transition__veil {
  position: absolute;
  z-index: 2;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  background: var(
    --surface-transition-fill,
    color-mix(in srgb, var(--ui-bg-canvas) 96%, transparent)
  );
  transition: opacity 120ms ease;
}
.surface-transition__veil.is-visible {
  opacity: 1;
  pointer-events: auto;
  /* 短加载只播放页面过渡，不闪现占位；返回内容时立即撤去遮罩。 */
  transition-delay: 100ms;
}
.surface-transition__trail {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ui-accent-primary) 7%, transparent);
}
.surface-transition__trail::after {
  position: absolute;
  inset: 0;
  content: '';
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    var(--ui-accent-primary),
    var(--ui-accent-sky),
    transparent
  );
}
.is-visible > .surface-transition__trail::after {
  animation: surface-travel 1.6s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}
.surface-transition__page {
  width: min(100%, 1100px);
  margin: 0 auto;
  padding: clamp(24px, 4vw, 56px);
}
.surface-transition__heading {
  display: grid;
  gap: 12px;
  margin-bottom: 36px;
}
.surface-transition i {
  display: block;
  height: 9px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-text-primary) 7%, transparent);
}
.surface-transition__heading i:first-child {
  width: 132px;
  height: 18px;
}
.surface-transition__heading i:last-child {
  width: 220px;
  max-width: 80%;
  opacity: 0.5;
}
.surface-transition__panels {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 18px;
}
.surface-transition__panels > div {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 24px;
  min-height: 120px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-md);
  background: var(--surface-transition-panel, var(--ui-bg-surface-soft));
}
.surface-transition__panels > div:first-child {
  grid-row: span 2;
}
.surface-transition__panels i:nth-child(2) {
  width: 80%;
  opacity: 0.65;
}
.surface-transition__panels i:nth-child(3) {
  width: 55%;
  opacity: 0.4;
}
.surface-transition__conversation {
  display: grid;
  gap: 30px;
  padding: 32px 28px;
  max-width: 840px;
  margin: auto;
}
.surface-transition__message {
  display: flex;
  gap: 14px;
  opacity: 0.75;
}
.surface-transition__message:nth-child(2) {
  flex-direction: row-reverse;
  padding-left: 24%;
  opacity: 0.45;
}
.surface-transition__message:nth-child(3) {
  padding-right: 15%;
  opacity: 0.3;
}
.surface-transition__message > div {
  display: grid;
  flex: 1;
  gap: 12px;
  padding-top: 4px;
}
.surface-transition__message i:nth-child(2) {
  width: 85%;
}
.surface-transition__message i:nth-child(3) {
  width: 45%;
}
.surface-transition i.surface-transition__avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 9px;
}
.surface-transition__status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@keyframes surface-travel {
  to {
    transform: translateX(100%);
  }
}
[data-motion-level='reduced'] > .surface-transition__content {
  transform: none;
}
[data-motion-level='reduced'].is-entering > .surface-transition__content,
[data-motion-level='reduced'].is-departing > .surface-transition__content {
  will-change: opacity;
}
.surface-transition--material > .surface-transition__content {
  opacity: 1;
}
.surface-transition--material.is-entering > .surface-transition__content,
.surface-transition--material.is-departing > .surface-transition__content {
  will-change: transform;
}
[data-motion-level='off'] > .surface-transition__content {
  transform: none;
  opacity: 1;
  will-change: auto;
}
[data-motion-level='reduced'] .surface-transition__trail::after,
[data-motion-level='off'] .surface-transition__trail::after {
  animation: none;
}
[data-motion-level='off'] .surface-transition__veil {
  transition: none;
}
[data-motion-level='reduced'] .surface-transition__veil.is-visible {
  transition-duration: 100ms;
  transition-delay: 0ms;
}
@media (prefers-reduced-motion: reduce) {
  .surface-transition__veil,
  .surface-transition__veil.is-visible {
    transition: none;
  }
}
</style>
