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
import { ref, watch, onMounted, onUnmounted } from 'vue'

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

watch(() => props.selector, updateRect)

onMounted(() => {
  updateRect()
  // 窗口变化时重新计算
  window.addEventListener('resize', updateRect)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateRect)
})

defineExpose({ rect, updateRect })
</script>

<template>
  <svg v-if="rect" class="spot-mask">
    <defs>
      <mask id="spot-cutout">
        <rect width="100%" height="100%" fill="white" />
        <rect
          :x="rect.x - padding"
          :y="rect.y - padding"
          :width="rect.width + padding * 2"
          :height="rect.height + padding * 2"
          fill="black"
        />
      </mask>
    </defs>
    <!-- 半透明背景带切口 -->
    <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#spot-cutout)" />
    <!-- 虚线高亮框 -->
    <rect
      :x="rect.x - padding - 2"
      :y="rect.y - padding - 2"
      :width="rect.width + padding * 2 + 4"
      :height="rect.height + padding * 2 + 4"
      fill="none"
      stroke="var(--color-blue-500)"
      stroke-width="2"
      stroke-dasharray="6 4"
    />
  </svg>
</template>

<style scoped>
.spot-mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
