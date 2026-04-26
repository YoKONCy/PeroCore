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
        class="fixed z-[1000] -translate-x-1/2 select-none cursor-move"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
        @mousedown="onMouseDown"
      >
        <!-- 拖拽手柄 -->
        <div
          class="flex justify-center py-0.5 text-slate-400 opacity-0 transition-opacity hover:opacity-100"
        >
          <PixelIcon name="grip" size="xs" />
        </div>

        <div
          class="px-6 py-2.5 bg-slate-900/85 border-2 border-sky-500 text-white text-sm font-bold max-w-[600px] text-center backdrop-blur-[12px]"
        >
          <!-- 思考状态 -->
          <div v-if="isThinking" class="flex items-center gap-2">
            <span class="flex gap-1">
              <span class="w-1.5 h-1.5 bg-sky-300 lyric-dot" />
              <span class="w-1.5 h-1.5 bg-sky-300 lyric-dot lyric-dot-2" />
              <span class="w-1.5 h-1.5 bg-sky-300 lyric-dot lyric-dot-3" />
            </span>
            <span class="text-xs tracking-[0.15em] opacity-90">{{ thinkingMessage }}</span>
          </div>

          <!-- 文字 -->
          <div v-else class="truncate">{{ text }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
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

/* 圆点脉冲 */
@keyframes lyric-dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}

.lyric-dot {
  animation: lyric-dot-pulse 1.4s infinite;
}
.lyric-dot-2 {
  animation-delay: 0.2s;
}
.lyric-dot-3 {
  animation-delay: 0.4s;
}
</style>
