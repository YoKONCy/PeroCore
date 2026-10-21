<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { AgentToolDisplay } from '../../api/modules/agentApi'
import type { PetActivity } from '../../composables/pet/usePetActivity'
import {
  resolveToolDisplay,
  toolDisplayIcon,
  toolDisplayLabel,
} from '../../composables/tools/useToolDisplay'
import '@infos/shared/i18n/catalogs/petActivity'
import { t } from '../../i18n'
import PetHudIcon from './PetHudIcon.vue'

const props = defineProps<{ activity: PetActivity }>()
const metadata = shallowRef<Record<string, AgentToolDisplay>>({})
const trace = ref<HTMLOListElement | null>(null)
const tr = (source: string, values: readonly unknown[] = []) => t('ui.pet-activity', source, values)
const label = computed(() =>
  tr(
    props.activity.phase === 'generating'
      ? '正在整理回复'
      : props.activity.phase === 'retrying'
        ? '稍等，再试一下'
        : props.activity.phase === 'tools'
          ? props.activity.steps.some((step) => step.state === 'running')
            ? '正在帮你处理'
            : props.activity.steps.length &&
                props.activity.steps.every(
                  (step) => step.state === 'completed' || step.state === 'failed',
                )
              ? '正在整理回复'
              : '正在准备工具'
          : '让我想一想',
  ),
)
const states = { pending: '准备中', running: '进行中', completed: '已完成', failed: '未完成' }
watch(
  () => props.activity.steps.map((step) => step.name),
  async (names) => {
    const entries = await Promise.all(
      [...new Set(names)]
        .filter(Boolean)
        .map(async (name) => [name, await resolveToolDisplay(name)] as const),
    )
    metadata.value = { ...metadata.value, ...Object.fromEntries(entries) }
  },
  { immediate: true },
)
watch(
  () => [props.activity.phase, ...props.activity.steps.map((step) => `${step.id}:${step.state}`)],
  async () => {
    await nextTick()
    const running = trace.value?.querySelector<HTMLElement>('.is-running')
    if (trace.value && running)
      trace.value.scrollTop = Math.max(0, running.offsetTop - trace.value.clientHeight / 2)
  },
)
</script>

<template>
  <div class="pet-activity" :class="{ 'is-thinking': activity.phase === 'thinking' }">
    <div class="pet-activity__heading" role="status" aria-live="polite">
      <PetHudIcon :name="activity.phase === 'tools' ? 'tool' : 'thought'" size="sm" />
      <span>{{ label }}</span>
      <span class="pet-activity__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
    <template v-if="activity.phase === 'tools' && activity.steps.length">
      <small v-if="activity.nit" class="pet-activity__count">
        {{ tr('NIT · {0} 个工具', [activity.steps.length]) }}
      </small>
      <ol ref="trace" class="pet-activity__trace" :class="{ 'is-chain': activity.nit }">
        <li
          v-for="(step, index) in activity.steps"
          :key="step.id"
          :class="[
            'is-' + step.state,
            {
              'is-reversed': Math.floor(index / 3) % 2 === 1,
              'is-row-end': index % 3 === 2,
              'is-last': index === activity.steps.length - 1,
            },
          ]"
          :style="
            activity.nit
              ? {
                  gridRow: Math.floor(index / 3) + 1,
                  gridColumn: Math.floor(index / 3) % 2 ? 3 - (index % 3) : (index % 3) + 1,
                }
              : undefined
          "
          :title="toolDisplayLabel(step.name, metadata[step.name]) + ' · ' + tr(states[step.state])"
        >
          <span class="pet-activity__node" aria-hidden="true">
            <PetHudIcon
              :name="
                step.state === 'completed'
                  ? 'check'
                  : step.state === 'failed'
                    ? 'alert'
                    : toolDisplayIcon(metadata[step.name])
              "
              size="xs"
            />
            <sup v-if="activity.nit">{{ index + 1 }}</sup>
          </span>
          <span class="pet-activity__name">
            {{ toolDisplayLabel(step.name, metadata[step.name]) }}
          </span>
          <span class="sr-only">{{ tr(states[step.state]) }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.pet-activity {
  min-width: 145px;
  max-width: 100%;
  font-size: 12px;
}
.pet-activity__heading {
  display: flex;
  align-items: center;
  gap: 7px;
  line-height: 1.5;
}
.pet-activity__heading > svg {
  color: var(--pet-accent);
}
.is-thinking .pet-activity__heading > svg {
  animation: pet-ponder 1.6s steps(3) infinite;
}
.pet-activity__dots {
  display: flex;
  gap: 3px;
  margin-left: auto;
  padding-left: 3px;
}
.pet-activity__dots i {
  width: 3px;
  height: 3px;
  background: var(--pet-pink);
  animation: pet-dot 1.2s ease-in-out infinite;
}
.pet-activity__dots i:nth-child(2) {
  animation-delay: 0.16s;
}
.pet-activity__dots i:nth-child(3) {
  animation-delay: 0.32s;
}
.pet-activity__count {
  display: block;
  color: var(--pet-muted);
  font-size: 10px;
  margin-top: 9px;
}
.pet-activity__trace {
  position: relative;
  display: grid;
  gap: 8px 10px;
  padding: 8px 0 0;
  margin: 0;
  list-style: none;
  max-height: 150px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.pet-activity__trace.is-chain {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pet-activity__trace li {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--pet-muted);
}
.pet-activity__trace.is-chain li {
  flex-direction: column;
  gap: 4px;
  text-align: center;
}
.is-chain li:not(.is-row-end):not(.is-last)::after {
  content: '';
  position: absolute;
  top: 13px;
  left: calc(50% + 15px);
  width: calc(100% - 20px);
  border-top: 1px solid var(--pet-bubble-rim);
}
.is-chain li.is-reversed:not(.is-row-end):not(.is-last)::after {
  left: auto;
  right: calc(50% + 15px);
}
.is-chain li.is-row-end:not(.is-last)::after {
  content: '';
  position: absolute;
  top: 30px;
  right: -5px;
  height: 26px;
  width: 5px;
  border-right: 1px solid var(--pet-bubble-rim);
}
.is-chain li.is-row-end.is-reversed:not(.is-last)::after {
  right: auto;
  left: -5px;
  border-right: 0;
  border-left: 1px solid var(--pet-bubble-rim);
}
.pet-activity__node {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--pet-bubble-rim);
  border-radius: 6px 6px 2px 6px;
  background: color-mix(in srgb, var(--pet-accent) 9%, var(--pet-bubble-fill));
}
.pet-activity__node sup {
  position: absolute;
  right: -4px;
  top: -5px;
  font-size: 8px;
  line-height: 1;
  padding: 2px;
  background: var(--pet-bubble-fill);
}
.pet-activity__name {
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
}
.is-running .pet-activity__node {
  color: var(--pet-pink);
  border-color: currentColor;
  animation: pet-step 1.3s ease-in-out infinite;
}
.is-pending .pet-activity__node {
  border-style: dashed;
}
.is-failed .pet-activity__node {
  color: var(--ui-warning, #d59b52);
}
.is-completed .pet-activity__node {
  color: var(--pet-accent);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@keyframes pet-ponder {
  0%,
  100% {
    rotate: -5deg;
  }
  50% {
    rotate: 6deg;
    translate: 0 -2px;
  }
}
@keyframes pet-dot {
  0%,
  75%,
  100% {
    opacity: 0.35;
    translate: 0 0;
  }
  35% {
    opacity: 1;
    translate: 0 -3px;
  }
}
@keyframes pet-step {
  50% {
    translate: 0 -2px;
    box-shadow: 0 2px 5px color-mix(in srgb, var(--pet-pink) 18%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pet-activity * {
    animation: none !important;
  }
}
</style>
