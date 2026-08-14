<script setup lang="ts">
/**
 * SpotlightMask — SVG 聚光灯遮罩
 *
 * 在全屏半透明遮罩上挖一个矩形孔，高亮目标元素。
 * 独立抽出以便 Onboarding 和其他引导场景复用。
 *
 * @props selector - CSS 选择器 (null 时不显示)
 * @props padding - 高亮区域内边距 (px)
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

interface Props {
  selector: string | null
  padding?: number
}

const props = withDefaults(defineProps<Props>(), {
  padding: 8,
})

interface SpotRect {
  x: number
  y: number
  width: number
  height: number
}

const rect = ref<SpotRect | null>(null)

/** 计算目标元素位置 */
function updateRect() {
  if (!props.selector) {
    rect.value = null
    return
  }
  const el = document.querySelector(props.selector)
  if (el) {
    const r = el.getBoundingClientRect()
    rect.value = { x: r.x, y: r.y, width: r.width, height: r.height }
  } else {
    rect.value = null
  }
}

function handleLayoutChange() {
  void nextTick(updateRect)
  window.setTimeout(updateRect, 80)
}

watch(() => props.selector, handleLayoutChange)

onMounted(() => {
  updateRect()
  window.addEventListener('resize', updateRect)
  window.addEventListener('scroll', updateRect, true)
  window.addEventListener('onboarding-layout-change', handleLayoutChange)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateRect)
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('onboarding-layout-change', handleLayoutChange)
})

defineExpose({ rect, updateRect })
</script>

<template>
  <svg v-if="rect" class="spotlight-svg">
    <defs>
      <mask id="spot-cutout">
        <rect width="100%" height="100%" fill="white" />
        <rect
          :x="rect.x - padding"
          :y="rect.y - padding"
          :width="rect.width + padding * 2"
          :height="rect.height + padding * 2"
          rx="8"
          fill="black"
        />
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="rgba(15,23,42,0.58)" mask="url(#spot-cutout)" />
    <rect
      :x="rect.x - padding - 2"
      :y="rect.y - padding - 2"
      :width="rect.width + padding * 2 + 4"
      :height="rect.height + padding * 2 + 4"
      rx="9"
      fill="none"
      stroke="var(--ui-accent-primary)"
      stroke-width="2"
    />
    <rect
      :x="rect.x - padding + 3"
      :y="rect.y - padding + 3"
      :width="rect.width + padding * 2 - 6"
      :height="rect.height + padding * 2 - 6"
      rx="5"
      fill="none"
      stroke="var(--ui-accent-sky)"
      stroke-width="1"
      stroke-dasharray="3 5"
    />
  </svg>
</template>

<style scoped>
.spotlight-svg {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
