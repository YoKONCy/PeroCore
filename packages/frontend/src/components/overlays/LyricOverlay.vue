<script setup lang="ts">
/**
 * LyricOverlay — 歌词/字幕浮层
 *
 * 可拖拽的悬浮条，显示当前语音回复文本或思考状态。
 * 位置持久化到 localStorage。
 *
 * @props text              - 显示文本
 * @props isThinking        - 思考中状态
 * @props thinkingMessage   - 思考中提示文字
 * @props duration          - 文本显示后自动隐藏的时间 (ms)，0 = 不自动隐藏
 * @props eager             - true: onMounted 时立即根据 text/isThinking 决定是否显示（切换模式丝滑过渡用）
 *                             false（默认）: 通过 v-if 条件控制可见性，由外部控制挂载/卸载
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'
import RunPulse from '../chat/RunPulse.vue'

interface Props {
  text: string
  isThinking?: boolean
  thinkingMessage?: string
  /** 文本显示后自动隐藏的时间 (ms)，0 = 不自动隐藏 */
  duration?: number
  /** 是否在 onMounted 时立即根据 props 显示 */
  eager?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isThinking: false,
  thinkingMessage: '正在思考中...',
  duration: 8000,
  eager: false,
})

const emit = defineEmits<{
  (e: 'ui-enter'): void
  (e: 'ui-leave'): void
}>()

const visible = ref(false)
const pos = ref({ x: 0, y: 0 })

// ── 位置持久化 ──
const STORAGE_KEY = 'ppc.lyric_pos'
const EDGE_PADDING = 24

function clampPosition() {
  pos.value.x = Math.min(Math.max(pos.value.x, EDGE_PADDING), window.innerWidth - EDGE_PADDING)
  pos.value.y = Math.min(Math.max(pos.value.y, EDGE_PADDING), window.innerHeight - EDGE_PADDING)
}

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
  clampPosition()
  window.addEventListener('resize', clampPosition)
  // eager 模式：挂载时立即根据已有内容决定是否显示（用于切换模式丝滑过渡）
  // 非 eager 模式：组件保持挂载，由 watch 响应 prop 变化来控制显示
  if (props.eager && (props.text || props.isThinking)) {
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

// 文字变化 → 显示（或重新开始淡出计时）
watch(
  () => props.text,
  (v) => {
    if (v) {
      visible.value = true
      if (!props.isThinking) startFade()
    } else if (!props.isThinking) {
      if (fadeTimer) clearTimeout(fadeTimer)
      visible.value = false
    }
  },
)

// 思考状态变化
watch(
  () => props.isThinking,
  (v) => {
    if (v) {
      visible.value = true
      if (fadeTimer) clearTimeout(fadeTimer)
    } else if (props.text) {
      startFade()
    } else {
      visible.value = false
    }
  },
)

onUnmounted(() => {
  if (fadeTimer) clearTimeout(fadeTimer)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('resize', clampPosition)
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
  clampPosition()
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
        class="lyric-overlay-container fixed z-[1000] select-none group"
        :style="{ left: pos.x + 'px', top: pos.y + 'px', transform: 'translateX(-50%)' }"
        @mouseenter="emit('ui-enter')"
        @mouseleave="emit('ui-leave')"
      >
        <!-- 拖拽句柄 (平时隐藏, Hover 显示) -->
        <div
          class="drag-handle opacity-0 group-hover:opacity-100 transition-opacity"
          @mousedown.stop="onMouseDown"
        >
          <PixelIcon name="grip" size="xs" />
        </div>

        <div class="lyric-bar">
          <!-- 思考状态 -->
          <RunPulse
            v-if="isThinking"
            state="thinking"
            :label="thinkingMessage"
            compact
            class="lyric-thinking-pulse"
          />

          <!-- 文字内容 -->
          <div v-else class="lyric-text-container">
            <div class="lyric-text" :title="text">{{ text }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 歌词条: 透明背景, 无边框, 发光不被裁切 */
.lyric-bar {
  background: transparent;
  backdrop-filter: none;
  border: none;
  padding: 20px 40px;
  width: max-content;
  max-width: 90vw;
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: visible;
}

/* 歌词文字: 圆润大字 + 粉色外发光 + 漂浮 */
.lyric-text {
  font-family: 'ZCOOL KuaiLe', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 1.8rem;
  font-weight: 400;
  color: #ffffff;
  /* 融合描边阴影与粉色外发光 */
  text-shadow:
    0 0 15px rgba(249, 168, 212, 0.8),
    0 0 30px rgba(249, 168, 212, 0.4),
    3px 3px 0 rgba(45, 27, 30, 0.2);
  white-space: pre-wrap;
  word-break: break-all;
  text-align: center;
  letter-spacing: 0.05em;
  line-height: 1.4;
  padding: 15px 0;
  animation: text-float 3s infinite ease-in-out;
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.5));
}

@keyframes text-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}

/* 拖拽句柄 */
.drag-handle {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 41, 59, 0.8);
  padding: 4px 12px;
  border-radius: 6px;
  cursor: grab;
  color: #f9a8d4;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
}

.drag-handle:active {
  cursor: grabbing;
}

.lyric-thinking-pulse {
  box-shadow:
    0 10px 30px color-mix(in srgb, var(--ui-accent-purple) 18%, transparent),
    0 2px 8px rgba(0, 0, 0, 0.18);
}

/* 进场轻快, 退场缓慢平滑淡出 (歌词韵味) */
.lyric-fade-enter-active {
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.lyric-fade-leave-active {
  transition: all 2.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.lyric-fade-enter-from,
.lyric-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(30px) scale(0.9);
  filter: blur(15px);
}
</style>
