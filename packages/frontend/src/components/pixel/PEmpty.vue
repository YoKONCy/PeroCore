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
  color: var(--color-text-muted);
}

.p-empty-icon-wrap {
  position: relative;
  margin-bottom: 20px;
}

.p-empty-icon-box {
  padding: 24px;
  background: var(--color-bg-hover);
  border: 2px solid var(--color-border);
  transition: all 0.5s;
}
.p-empty:hover .p-empty-icon-box {
  border-color: var(--color-sky-light);
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.1);
}

.p-empty-icon {
  opacity: 0.3;
  transition: all 0.5s;
}
.p-empty:hover .p-empty-icon {
  opacity: 0.6;
  color: var(--color-sky-500);
  transform: scale(1.1);
}

.p-empty-star {
  position: absolute;
  opacity: 0;
  transition: opacity 0.5s;
}
.p-empty:hover .p-empty-star {
  opacity: 1;
}
.p-empty-star-1 {
  top: -8px;
  right: -8px;
  animation: bounce 1s infinite;
  color: var(--color-sky-hover);
}
.p-empty-star-2 {
  bottom: -4px;
  left: -12px;
  animation: pulse 1.5s infinite;
  animation-delay: 0.3s;
  color: var(--color-sky-light);
}

.p-empty-text {
  text-align: center;
}
.p-empty-desc {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-muted);
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
  opacity: 0;
  transform: translateY(8px);
  transition: all 0.7s;
}
.p-empty:hover .p-empty-hint {
  opacity: 1;
  transform: translateY(0);
}

.p-empty-dot {
  width: 6px;
  height: 6px;
  background: var(--color-sky-light);
  border-radius: 50%;
}
.p-empty-hint-text {
  font-size: 10px;
  font-family: var(--font-pixel), monospace;
  color: var(--color-sky-light);
  font-style: italic;
}

.p-empty-actions {
  margin-top: 16px;
}

.p-empty-paw {
  margin-top: 12px;
  font-size: 20px;
  opacity: 0.1;
  transition: all 0.5s;
}
.p-empty:hover .p-empty-paw {
  opacity: 0.3;
  color: var(--color-sky-hover);
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
