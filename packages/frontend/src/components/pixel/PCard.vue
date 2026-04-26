<script setup lang="ts">
/**
 * PCard — 像素风卡片容器
 *
 * 支持多种模式：
 * - pixel (默认): 像素风直角 + pixel-border
 * - glass: 毛玻璃 backdrop-blur
 * - variant 色系: purple / pink / orange / green / sky
 * - glow 外发光
 * - hoverable 悬浮交互 (回弹 + sparkle 闪光)
 *
 * 还原 v1 全部功能，使用 v2 BEM + CSS 变量规范
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  /** 像素风模式 (直角 + pixel-border) */
  pixel?: boolean
  /** 毛玻璃效果 */
  glass?: boolean
  /** 有边框 */
  bordered?: boolean
  /** 激活态 (ring 高亮) */
  active?: boolean
  /** 自定义内边距 */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** 是否有阴影 */
  shadow?: boolean
  /** 是否可悬停 (含回弹动画 + sparkle) */
  hoverable?: boolean
  /** 糖果色变体 */
  variant?: 'purple' | 'pink' | 'orange' | 'green' | 'sky'
  /** 外发光 */
  glow?: boolean
  /** 允许溢出 (用于包含下拉框时) */
  overflowVisible?: boolean
  /** 内容区撑满高度 */
  fullHeight?: boolean
}

withDefaults(defineProps<Props>(), {
  pixel: false,
  glass: false,
  bordered: false,
  active: false,
  padding: 'md',
  shadow: true,
  hoverable: false,
  variant: undefined,
  glow: false,
  overflowVisible: false,
  fullHeight: false,
})
</script>

<template>
  <div
    :class="[
      'p-card',
      `p-card-pad-${padding}`,
      {
        'p-card-pixel': pixel,
        'p-card-glass': glass && !pixel,
        'p-card-bordered': bordered,
        'p-card-active': active,
        'p-card-shadow': shadow && !pixel,
        'p-card-hoverable': hoverable,
        'p-card-glow': glow,
        'p-card-overflow': overflowVisible,
        [`p-card-variant-${variant}`]: !!variant,
      },
    ]"
  >
    <!-- 悬停闪光 ✨ -->
    <div v-if="hoverable" class="p-card-sparkle">
      <PixelIcon name="sparkle" size="sm" animation="spin" />
    </div>

    <!-- header 插槽 -->
    <div v-if="$slots.header" class="p-card-header">
      <slot name="header" />
    </div>

    <!-- 默认内容 -->
    <div :class="['p-card-body', { 'p-card-body-full': fullHeight }]">
      <slot />
    </div>

    <!-- 悬浮光晕 -->
    <div v-if="hoverable || glow" class="p-card-glow-orb" />
  </div>
</template>

<style scoped>
/* ── 基础 ── */
.p-card {
  position: relative;
  border-radius: 24px;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  border: 1px solid var(--color-sky-light);
  overflow: hidden;
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.p-card-overflow {
  overflow: visible;
}

/* ── pixel 模式 ── */
.p-card-pixel {
  border-radius: 0;
  border: 3px solid var(--color-border);
  box-shadow: 4px 4px 0 var(--color-shadow);
  background: var(--color-bg-secondary);
}

.p-card-pixel.p-card-hoverable:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 var(--color-shadow);
}

.p-card-pixel.p-card-hoverable:active {
  transform: translate(0, 0);
  box-shadow: 4px 4px 0 var(--color-shadow);
}

.p-card-pixel.p-card-active {
  background: var(--color-sky-50);
}

/* ── glass 模式 ── */
.p-card-glass {
  background: var(--color-bg-secondary);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-sky-100);
}

/* ── 阴影 ── */
.p-card-shadow {
  box-shadow:
    0 4px 16px var(--color-sky-50),
    0 2px 6px var(--color-shadow);
}

/* ── bordered ── */
.p-card-bordered {
  border-width: 2px;
  border-color: var(--color-border);
}

/* ── active ── */
.p-card-active:not(.p-card-pixel) {
  box-shadow:
    0 0 0 4px var(--color-sky-100),
    0 4px 16px var(--color-sky-50);
  background: var(--color-sky-50);
}

/* ── variant 色系 (颜色引用 tokens.css) ── */
.p-card-variant-purple {
  background: color-mix(in srgb, var(--color-purple-light) 30%, white);
  border-color: var(--color-purple-light);
}
.p-card-variant-pink {
  background: color-mix(in srgb, var(--color-pink-light) 30%, white);
  border-color: var(--color-pink-light);
}
.p-card-variant-orange {
  background: color-mix(in srgb, var(--color-orange-light) 30%, white);
  border-color: var(--color-orange-light);
}
.p-card-variant-green {
  background: color-mix(in srgb, var(--color-emerald-light) 30%, white);
  border-color: var(--color-emerald-light);
}
.p-card-variant-sky {
  background: color-mix(in srgb, var(--color-sky-light) 30%, white);
  border-color: var(--color-sky-light);
}

/* ── glow 外发光 (颜色引用 tokens.css) ── */
.p-card-glow.p-card-variant-purple {
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-purple-face) 15%, transparent);
}
.p-card-glow.p-card-variant-pink {
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-pink-face) 15%, transparent);
}
.p-card-glow.p-card-variant-orange {
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-orange-face) 15%, transparent);
}
.p-card-glow.p-card-variant-green {
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-emerald-face) 15%, transparent);
}
.p-card-glow.p-card-variant-sky,
.p-card-glow:not([class*='p-card-variant-']) {
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-sky-face) 15%, transparent);
}

/* ── hoverable ── */
.p-card-hoverable {
  cursor: pointer;
}

.p-card-hoverable:not(.p-card-pixel):hover {
  transform: translateY(-6px);
  box-shadow:
    0 12px 32px var(--color-sky-100),
    0 4px 12px var(--color-shadow);
  background: var(--color-bg-primary);
}

.p-card-hoverable:not(.p-card-pixel):active {
  transform: translateY(-2px) scale(0.98);
}

/* ── sparkle 闪光 ── */
.p-card-sparkle {
  position: absolute;
  top: 12px;
  right: 12px;
  opacity: 0;
  transform: scale(0);
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 20;
  pointer-events: none;
  color: var(--color-sky-face);
  filter: drop-shadow(0 0 6px var(--color-sky-100));
}

.p-card-hoverable:hover .p-card-sparkle {
  opacity: 1;
  transform: scale(1.2);
}

/* ── 光晕 ── */
.p-card-glow-orb {
  position: absolute;
  top: -16px;
  right: -16px;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--color-sky-50);
  filter: blur(40px);
  pointer-events: none;
  transition: background 0.3s;
}

.p-card-hoverable:hover .p-card-glow-orb {
  background: var(--color-sky-100);
}

/* ── header 插槽 ── */
.p-card-header {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-border);
}

/* ── body ── */
.p-card-body {
  position: relative;
  z-index: 10;
}

.p-card-body-full {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ── 内边距 ── */
.p-card-pad-none {
  padding: 0;
}
.p-card-pad-sm {
  padding: var(--spacing-sm);
}
.p-card-pad-md {
  padding: var(--spacing-md);
}
.p-card-pad-lg {
  padding: var(--spacing-lg);
}
</style>
