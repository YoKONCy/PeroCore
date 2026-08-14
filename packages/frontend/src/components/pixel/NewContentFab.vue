<script setup lang="ts">
/**
 * NewContentFab — 「新动态 ↓」浮动按钮
 *
 * 与 useTabAutoFollow 搭配使用：当 hasNewContent 为 true 时由使用方渲染。
 * 组件自身不决定绝对定位（由外层容器控制），只负责视觉与交互。
 *
 * @props visible - 是否显示（同时控制过渡动画）
 * @emits click - 点击按钮（通常调用 scrollToBottom() 吸底）
 */
import PixelIcon from './PixelIcon.vue'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  click: []
}>()

function onClick() {
  emit('click')
}
</script>

<template>
  <Transition name="new-content-fab">
    <button
      v-if="visible"
      class="new-content-fab pixel-border-moe"
      aria-label="查看新动态"
      @click="onClick"
    >
      <!-- 提示文案 -->
      <span class="new-content-fab__label">新动态</span>
      <!-- 向下箭头图标 -->
      <PixelIcon name="chevron-down" size="sm" />
    </button>
  </Transition>
</template>

<style scoped>
/* 圆形毛玻璃按钮，使用 Moe 主色与像素边框 */
.new-content-fab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  cursor: pointer;
  border-radius: var(--ui-radius-full, 9999px);
  /* 毛玻璃背景：Moe 主色半透明 + 模糊 */
  background: color-mix(in srgb, var(--color-moe-primary, #f9a8d4) 70%, transparent);
  backdrop-filter: blur(8px);
  color: var(--color-moe-cocoa);
  font-size: 12px;
  font-weight: 700;
  transition:
    transform var(--ui-duration-fast, 0.15s),
    box-shadow var(--ui-duration-fast, 0.15s);
  z-index: 10;
}

.new-content-fab:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--color-moe-primary, #f9a8d4) 85%, transparent);
}

.new-content-fab:active {
  transform: translate(1px, 1px);
}

/* 进入/离开：淡入淡出 + 底部上浮，时长 180ms */
.new-content-fab-enter-active,
.new-content-fab-leave-active {
  transition:
    opacity 180ms ease,
    translate 180ms ease;
}

.new-content-fab-enter-from,
.new-content-fab-leave-to {
  opacity: 0;
  translate: 0 12px;
}
</style>
