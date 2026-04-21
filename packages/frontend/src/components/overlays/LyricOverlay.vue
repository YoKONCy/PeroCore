<script setup lang="ts">
/**
 * LyricOverlay — 歌词/字幕浮层
 *
 * 可拖拽的悬浮条，显示当前语音回复文本或思考状态。
 * 位置持久化到 localStorage。
 *
 * @props text - 显示文本
 * @props isThinking - 思考中状态
 * @props thinkingMessage - 思考中提示文字
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'

interface Props {
  text: string
  isThinking?: boolean
  thinkingMessage?: string
  /** 文本显示后自动隐藏的时间 (ms)，0 = 不自动隐藏 */
  duration?: number
}

const props = withDefaults(defineProps<Props>(), {
  isThinking: false,
  thinkingMessage: '正在思考中...',
  duration: 8000,
})

const visible = ref(false)
const pos = ref({ x: 0, y: 0 })

// ── 位置持久化 ──
const STORAGE_KEY = 'ppc.lyric_pos'

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      pos.value = JSON.parse(saved)
    } catch {
      /* 忽略 */
    }
  } else {
    pos.value = { x: window.innerWidth / 2, y: window.innerHeight - 80 }
  }
  if (props.text || props.isThinking) {
    visible.value = true
    if (!props.isThinking && props.duration > 0) startFade()
  }
})

// ── 自动隐藏 ──
let fadeTimer: ReturnType<typeof setTimeout> | null = null

function startFade() {
  if (fadeTimer) clearTimeout(fadeTimer)
  if (props.duration <= 0) return
  fadeTimer = setTimeout(() => {
    visible.value = false
  }, props.duration)
}

watch(
  () => props.text,
  (v) => {
    if (v) {
      visible.value = true
      if (!props.isThinking) startFade()
    }
  },
)
watch(
  () => props.isThinking,
  (v) => {
    if (v) {
      visible.value = true
      if (fadeTimer) clearTimeout(fadeTimer)
    } else if (props.text) {
      startFade()
    }
  },
)

onUnmounted(() => {
  if (fadeTimer) clearTimeout(fadeTimer)
})

// ── 拖拽 ──
let isDragging = false
let startX = 0
let startY = 0
let initX = 0
let initY = 0

function onMouseDown(e: MouseEvent) {
  isDragging = true
  startX = e.clientX
  startY = e.clientY
  initX = pos.value.x
  initY = pos.value.y
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging) return
  pos.value.x = initX + (e.clientX - startX)
  pos.value.y = initY + (e.clientY - startY)
}
function onMouseUp() {
  isDragging = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="lyric-fade">
      <div
        v-if="visible"
        class="lyric-overlay"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
        @mousedown="onMouseDown"
      >
        <!-- 拖拽手柄 -->
        <div class="lyric-handle">
          <PixelIcon name="grip" size="xs" />
        </div>

        <div class="lyric-bar">
          <!-- 思考状态 -->
          <div v-if="isThinking" class="lyric-thinking">
            <span class="lyric-dots">
              <span class="lyric-dot" />
              <span class="lyric-dot" />
              <span class="lyric-dot" />
            </span>
            <span class="lyric-thinking-text">{{ thinkingMessage }}</span>
          </div>

          <!-- 文字 -->
          <div v-else class="lyric-text">{{ text }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lyric-overlay {
  position: fixed;
  z-index: 1000;
  transform: translateX(-50%);
  user-select: none;
  cursor: move;
}

.lyric-handle {
  display: flex;
  justify-content: center;
  padding: 2px 0;
  color: var(--color-text-muted);
  opacity: 0;
  transition: opacity 0.2s;
}
.lyric-overlay:hover .lyric-handle {
  opacity: 1;
}

.lyric-bar {
  padding: 10px 24px;
  background: rgba(15, 23, 42, 0.85);
  border: 2px solid var(--color-sky-500);
  color: white;
  font-size: 14px;
  font-weight: 700;
  max-width: 600px;
  text-align: center;
  backdrop-filter: blur(12px);
}

.lyric-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lyric-thinking-text {
  font-size: 12px;
  letter-spacing: 0.15em;
  opacity: 0.9;
}
.lyric-dots {
  display: flex;
  gap: 4px;
}
.lyric-dot {
  width: 6px;
  height: 6px;
  background: var(--color-sky-hover);
  animation: dot-pulse 1.4s infinite;
}
.lyric-dot:nth-child(2) {
  animation-delay: 0.2s;
}
.lyric-dot:nth-child(3) {
  animation-delay: 0.4s;
}

.lyric-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Transition */
.lyric-fade-enter-active,
.lyric-fade-leave-active {
  transition:
    opacity 0.3s,
    transform 0.3s;
}
.lyric-fade-enter-from,
.lyric-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

@keyframes dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}
</style>
