<script setup lang="ts">
/**
 * PTooltip — 像素风提示气泡
 *
 */
import { ref, computed, nextTick } from 'vue'

interface Props {
  content: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  placement: 'top',
})

const visible = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })

const positionStyle = computed(() => ({
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
}))

async function updatePosition() {
  if (!triggerRef.value) return
  await nextTick()
  if (!tooltipRef.value) return

  const triggerRect = triggerRef.value.getBoundingClientRect()
  const tooltipRect = tooltipRef.value.getBoundingClientRect()
  const gap = 8

  let top = 0
  let left = 0

  switch (props.placement) {
    case 'top':
      top = triggerRect.top - tooltipRect.height - gap
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
      break
    case 'bottom':
      top = triggerRect.bottom + gap
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
      break
    case 'left':
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      left = triggerRect.left - tooltipRect.width - gap
      break
    case 'right':
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      left = triggerRect.right + gap
      break
  }

  // 边界检查
  const pad = 10
  left = Math.max(pad, Math.min(left, window.innerWidth - tooltipRect.width - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - tooltipRect.height - pad))

  position.value = { top, left }
}

function show() {
  if (!props.content) return
  visible.value = true
  void updatePosition()
}

function hide() {
  visible.value = false
}
</script>

<template>
  <div ref="triggerRef" class="p-tooltip-trigger" @mouseenter="show" @mouseleave="hide">
    <slot />

    <Teleport to="body">
      <Transition name="tooltip">
        <div v-if="visible" ref="tooltipRef" class="p-tooltip" :style="positionStyle">
          {{ content }}
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.p-tooltip-trigger {
  position: relative;
  display: inline-block;
}

.p-tooltip {
  position: fixed;
  z-index: 9999;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-pixel), monospace;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  border: 2px solid var(--color-sky-hover);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.1);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  max-width: 260px;
  word-break: break-word;
}

.tooltip-enter-active {
  transition: all 0.1s ease-out;
}
.tooltip-leave-active {
  transition: all 0.075s ease-in;
}
.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
