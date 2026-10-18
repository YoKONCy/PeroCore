<script setup lang="ts">
import type { CanvasGuide } from '../services/canvasGuides'
defineProps<{ guides: CanvasGuide[]; viewport: { x: number; y: number; scale: number } }>()
</script>

<template>
  <svg v-if="guides.length" class="canvas-guides" aria-hidden="true">
    <g v-for="(guide, index) in guides" :key="index" :class="`guide-${guide.kind}`">
      <line
        :x1="viewport.x + guide.x1 * viewport.scale"
        :y1="viewport.y + guide.y1 * viewport.scale"
        :x2="viewport.x + guide.x2 * viewport.scale"
        :y2="viewport.y + guide.y2 * viewport.scale"
      />
      <template v-if="guide.label">
        <path
          :d="
            guide.axis === 'x'
              ? `M${viewport.x + guide.x1 * viewport.scale},${viewport.y + guide.y1 * viewport.scale - 4}v8 M${viewport.x + guide.x2 * viewport.scale},${viewport.y + guide.y2 * viewport.scale - 4}v8`
              : `M${viewport.x + guide.x1 * viewport.scale - 4},${viewport.y + guide.y1 * viewport.scale}h8 M${viewport.x + guide.x2 * viewport.scale - 4},${viewport.y + guide.y2 * viewport.scale}h8`
          "
        />
        <g
          :transform="`translate(${viewport.x + ((guide.x1 + guide.x2) / 2) * viewport.scale},${viewport.y + ((guide.y1 + guide.y2) / 2) * viewport.scale})`"
        >
          <rect
            :x="-(guide.label.length * 7 + 12) / 2"
            y="-9"
            :width="guide.label.length * 7 + 12"
            height="18"
            rx="4"
          />
          <text text-anchor="middle" dominant-baseline="central">{{ guide.label }}</text>
        </g>
      </template>
    </g>
  </svg>
</template>

<style scoped>
.canvas-guides {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
  z-index: 8;
}
.canvas-guides g {
  color: #e66bb0;
}
.canvas-guides line,
.canvas-guides path {
  stroke: currentColor;
  stroke-width: 1;
  fill: none;
}
.canvas-guides .guide-center {
  color: #a28aff;
}
.guide-center line {
  stroke-dasharray: 5 4;
}
.canvas-guides .guide-spacing {
  color: #26b8a5;
}
.canvas-guides .guide-distance {
  color: #8796ac;
}
.guide-distance line,
.guide-grid line {
  stroke-dasharray: 3 4;
}
.canvas-guides .guide-size,
.canvas-guides .guide-grid {
  color: #55a7e9;
}
.canvas-guides rect {
  fill: var(--panel, #20242f);
  stroke: currentColor;
  stroke-width: 0.6;
}
.canvas-guides text {
  fill: currentColor;
  font:
    11px ui-monospace,
    monospace;
}
</style>
