<script setup lang="ts">
/**
 * PEmpty — 像素风空状态
 *
 */
import PixelIcon from './PixelIcon.vue'

interface Props {
  description?: string
  /** 是否显示猫爪 */
  showPaw?: boolean
}

withDefaults(defineProps<Props>(), {
  description: '这里空空如也喵...',
  showPaw: true,
})
</script>

<template>
  <div class="p-empty">
    <!-- 图标容器 -->
    <div class="p-empty-icon-wrap">
      <div class="p-empty-icon-box">
        <PixelIcon name="inbox" size="2xl" class="p-empty-icon" />
      </div>
      <!-- 漂浮星星 -->
      <div class="p-empty-star p-empty-star-1"><PixelIcon name="sparkle" size="xs" /></div>
      <div class="p-empty-star p-empty-star-2"><PixelIcon name="sparkle" size="xs" /></div>
    </div>

    <!-- 文字 -->
    <div class="p-empty-text">
      <p class="p-empty-desc">{{ description }}</p>
      <div class="p-empty-hint">
        <span class="p-empty-dot" />
        <span class="p-empty-hint-text">NO DATA FOUND</span>
        <span class="p-empty-dot" />
      </div>
    </div>

    <!-- 操作插槽 -->
    <div v-if="$slots.default" class="p-empty-actions">
      <slot />
    </div>

    <!-- 猫爪 -->
    <div v-if="showPaw" class="p-empty-paw">
      <PixelIcon name="paw" size="lg" />
    </div>
  </div>
</template>

<style scoped>
.p-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--ui-text-tertiary);
  cursor: default;
  transition: transform 0.4s;
}
.p-empty:hover {
  animation: pempty-tilt 0.8s steps(4) forwards;
}

.p-empty-icon-wrap {
  position: relative;
  margin-bottom: 20px;
}

.p-empty-icon-box {
  padding: 24px;
  background: var(--dash-empty-bg);
  border: 2px solid var(--ui-border-default);
  transition: all 0.5s;
  animation: icon-breathe 3s steps(4) infinite;
}
.p-empty:hover .p-empty-icon-box {
  border-color: var(--ui-accent-sky);
  box-shadow: var(--ui-glow-sky);
  animation:
    icon-breathe 3s steps(4) infinite,
    pempty-icon-jiggle 0.4s steps(3);
}

.p-empty-icon {
  opacity: 0.3;
  transition: all 0.5s;
}
.p-empty:hover .p-empty-icon {
  opacity: 0.6;
  color: var(--ui-accent-sky);
  transform: scale(1.1);
}

/* 星星: 默认就可见并持续动画 */
.p-empty-star {
  position: absolute;
  opacity: 0.5;
  transition: opacity 0.5s;
}
.p-empty:hover .p-empty-star {
  opacity: 1;
}
.p-empty-star-1 {
  top: -8px;
  right: -8px;
  animation: pixel-bounce-star 1s steps(2) infinite;
  color: var(--color-sky-hover);
}
.p-empty-star-2 {
  bottom: -4px;
  left: -12px;
  animation: pixel-pulse-star 1.5s steps(3) infinite;
  animation-delay: 0.3s;
  color: var(--color-sky-light);
}

.p-empty-text {
  text-align: center;
}
.p-empty-desc {
  font-size: 14px;
  font-weight: 700;
  font-family: var(--ui-font-pixel);
  color: var(--ui-text-tertiary);
  transition: color 0.5s;
}
.p-empty:hover .p-empty-desc {
  color: var(--color-sky-500);
}

.p-empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  opacity: 0.4;
  transform: translateY(0);
  transition: all 0.7s;
}
.p-empty:hover .p-empty-hint {
  opacity: 1;
}

.p-empty-dot {
  width: 6px;
  height: 6px;
  background: var(--color-sky-light);
  animation: pixel-pulse-star 2s steps(3) infinite;
}
.p-empty-hint-text {
  font-size: 10px;
  font-family: var(--font-pixel), monospace;
  color: var(--color-sky-light);
  font-style: italic;
  letter-spacing: 1px;
}

.p-empty-actions {
  margin-top: 16px;
}

/* 猫爪也加入像素风微动 */
.p-empty-paw {
  margin-top: 12px;
  font-size: 20px;
  opacity: 0.15;
  transition: all 0.5s;
  animation: pixel-paw-wiggle 2.5s steps(4) infinite;
}
.p-empty:hover .p-empty-paw {
  opacity: 0.4;
  color: var(--color-sky-hover);
}

/* ── 像素风专属动画 ── */

@keyframes pixel-bounce-star {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

@keyframes pixel-pulse-star {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

@keyframes icon-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.02);
  }
}

@keyframes pixel-paw-wiggle {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-5deg);
  }
  75% {
    transform: rotate(5deg);
  }
}

/* hover 整体微倾斜 + 呼吸回弹 */
@keyframes pempty-tilt {
  0% {
    transform: rotate(0deg) scale(1);
  }
  30% {
    transform: rotate(-1.5deg) scale(1.02);
  }
  60% {
    transform: rotate(0.5deg) scale(1.01);
  }
  100% {
    transform: rotate(-0.8deg) scale(1.015);
  }
}

/* hover 图标盒子像素抖动 */
@keyframes pempty-icon-jiggle {
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(-2px, 1px);
  }
  50% {
    transform: translate(2px, -1px);
  }
  75% {
    transform: translate(-1px, 2px);
  }
  100% {
    transform: translate(0, 0);
  }
}
</style>
