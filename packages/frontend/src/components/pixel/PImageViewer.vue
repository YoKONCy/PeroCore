<script setup lang="ts">
/**
 * PImageViewer — 图片全屏查看器
 *
 * 支持多图浏览、键盘导航 (←→Esc)。
 * 使用 Teleport 挂载到 body。
 *
 * @props images - 图片 URL 列表
 * @props visible - 是否显示
 * @props initialIndex - 初始图片索引
 * @emits update:visible - 关闭
 */
import { ref, watch } from 'vue'
import PixelIcon from './PixelIcon.vue'
import { useEventListener } from '../../composables'

interface Props {
  images: string[]
  visible?: boolean
  initialIndex?: number
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  initialIndex: 0,
})

const emit = defineEmits<{
  'update:visible': [val: boolean]
}>()

const currentIndex = ref(props.initialIndex)

watch(
  () => props.initialIndex,
  (v) => {
    currentIndex.value = v
  },
)
watch(
  () => props.visible,
  (v) => {
    if (v) currentIndex.value = props.initialIndex
  },
)

function close() {
  emit('update:visible', false)
}
function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}
function next() {
  if (currentIndex.value < props.images.length - 1) currentIndex.value++
}

/** 键盘导航 */
useEventListener(window, 'keydown', (e: Event) => {
  if (!props.visible) return
  const key = (e as KeyboardEvent).key
  if (key === 'Escape') close()
  if (key === 'ArrowLeft') prev()
  if (key === 'ArrowRight') next()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div v-if="visible" class="piv-overlay" @click.self="close">
        <!-- 关闭 -->
        <button class="piv-close" title="关闭 (Esc)" @click="close">
          <PixelIcon name="close" size="sm" />
        </button>

        <!-- 左箭头 -->
        <button
          v-if="images.length > 1"
          class="piv-nav piv-nav-left"
          :disabled="currentIndex === 0"
          @click.stop="prev"
        >
          <PixelIcon name="chevron-left" size="md" />
        </button>

        <!-- 主图片 -->
        <div class="piv-image-wrap" @click.stop>
          <img :src="images[currentIndex]" class="piv-image" alt="查看图片" />
        </div>

        <!-- 右箭头 -->
        <button
          v-if="images.length > 1"
          class="piv-nav piv-nav-right"
          :disabled="currentIndex === images.length - 1"
          @click.stop="next"
        >
          <PixelIcon name="chevron-right" size="md" />
        </button>

        <!-- 计数器 -->
        <div v-if="images.length > 1" class="piv-counter">
          <span class="piv-counter-current">{{ currentIndex + 1 }}</span>
          <span class="piv-counter-sep">/</span>
          <span>{{ images.length }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.piv-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.piv-close {
  position: absolute;
  top: 24px;
  right: 24px;
  padding: 10px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  z-index: 10;
  transition: all 0.15s;
}
.piv-close:hover {
  color: var(--color-red-face);
  border-color: var(--color-red-300);
}

.piv-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  padding: 16px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  z-index: 10;
  transition: all 0.15s;
}
.piv-nav:hover:not(:disabled) {
  color: var(--color-sky-500);
  border-color: var(--color-sky-hover);
}
.piv-nav:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}
.piv-nav-left {
  left: 24px;
}
.piv-nav-right {
  right: 24px;
}

.piv-image-wrap {
  max-width: calc(100vw - 200px);
  max-height: calc(100vh - 120px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.piv-image {
  max-width: 100%;
  max-height: 85vh;
  object-fit: contain;
  border: 2px solid var(--color-border);
  box-shadow: 0 0 48px rgba(0, 0, 0, 0.5);
}

.piv-counter {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 20px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  z-index: 10;
}
.piv-counter-current {
  color: var(--color-sky-500);
}
.piv-counter-sep {
  color: var(--color-text-muted);
  margin: 0 4px;
}

/* 过渡 */
.viewer-enter-active {
  transition: all 0.3s ease-out;
}
.viewer-leave-active {
  transition: all 0.2s ease-in;
}
.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}
</style>
