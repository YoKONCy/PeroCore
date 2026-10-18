<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import PetHudIcon from './PetHudIcon.vue'

const props = defineProps<{
  text: string
  petName?: string
  speaking?: boolean
  conversation?: boolean
  bounds: { left: number; right: number; top: number; bottom: number }
  viewport: { width: number; height: number }
}>()
const emit = defineEmits<{
  (event: 'ui-enter'): void
  (event: 'ui-leave'): void
  (event: 'open-conversation'): void
  (event: 'stop-speech'): void
}>()
const element = ref<HTMLElement | null>(null)
const size = ref({ width: 0, height: 0 })
let observer: ResizeObserver | undefined

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

const layout = computed(() => {
  const leftSpace = props.bounds.left - 28
  const rightSpace = props.viewport.width - props.bounds.right - 28
  const side = leftSpace >= 160 ? 'left' : rightSpace >= 160 ? 'right' : 'above'
  const available =
    side === 'left' ? leftSpace : side === 'right' ? rightSpace : props.viewport.width - 32
  return {
    side,
    maxWidth: Math.max(0, Math.min(248, available, props.viewport.width - 32)),
  }
})

// 用气泡真实尺寸定位，短句自然收窄，长句自然换行，不能按固定卡片宽高偏移。
const placement = computed(() => {
  const { width, height } = size.value
  const left =
    layout.value.side === 'left'
      ? props.bounds.left - width - 12
      : layout.value.side === 'right'
        ? props.bounds.right + 12
        : (props.bounds.left + props.bounds.right - width) / 2
  const top =
    layout.value.side === 'above'
      ? props.bounds.top - height - 14
      : props.bounds.top + (props.bounds.bottom - props.bounds.top) * 0.18
  return {
    left: clamp(left, 16, props.viewport.width - width - 16) + 'px',
    top: clamp(top, 16, props.viewport.height - height - 16) + 'px',
    maxWidth: layout.value.maxWidth + 'px',
    '--bubble-max-height': Math.min(240, Math.max(0, props.viewport.height - 110)) + 'px',
    visibility: width > 0 ? ('visible' as const) : ('hidden' as const),
  }
})

function measure(): void {
  if (!element.value) return
  const width = element.value.offsetWidth
  const height = element.value.offsetHeight
  if (width !== size.value.width || height !== size.value.height) size.value = { width, height }
}
watch(
  () => [props.text, props.petName, layout.value.maxWidth, props.viewport.height],
  () => {
    void nextTick(measure)
  },
  { flush: 'post' },
)
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && element.value) {
    observer = new ResizeObserver(measure)
    observer.observe(element.value)
  }
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div
    ref="element"
    data-pet-ui
    class="pet-speech-bubble"
    :class="['bubble-' + layout.side, { 'has-actions': conversation || speaking }]"
    :style="placement"
    role="status"
    @pointerenter="emit('ui-enter')"
    @pointerleave="emit('ui-leave')"
  >
    <div class="bubble-face" aria-hidden="true" />
    <div v-if="petName" class="bubble-name">
      <span>{{ petName }}</span>
      <PetHudIcon name="heart" size="xs" />
    </div>
    <div class="bubble-content">{{ text }}</div>
    <div v-if="conversation || speaking" class="bubble-actions">
      <button
        v-if="speaking"
        type="button"
        title="停止朗读"
        aria-label="停止朗读"
        @click="emit('stop-speech')"
      >
        <PetHudIcon name="volume-x" size="xs" />
      </button>
      <button
        v-if="conversation"
        type="button"
        title="打开对话"
        aria-label="打开对话"
        @click="emit('open-conversation')"
      >
        <PetHudIcon name="chevron-right" size="xs" />
      </button>
    </div>
  </div>
</template>

<style scoped src="./pet-speech.css" />
