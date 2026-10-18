<template>
  <div class="parallax-code-stream-container" ref="containerRef">
    <!-- 3D 舞台区域，受鼠标/陀螺仪倾角动态控制 -->
    <div class="code-stage" :style="stageStyle">
      <!-- 第 1 列代码瀑布（向下流动） -->
      <div class="code-column col-down">
        <div class="code-track">
          <div class="code-content" v-html="codeSnippet1"></div>
          <div class="code-content" v-html="codeSnippet1"></div>
        </div>
      </div>

      <!-- 第 2 列代码瀑布（向上流动，速度较慢） -->
      <div class="code-column col-up col-primary">
        <div class="code-track">
          <div class="code-content" v-html="codeSnippet2"></div>
          <div class="code-content" v-html="codeSnippet2"></div>
        </div>
      </div>

      <!-- 第 3 列代码瀑布（向下流动，带有微弱偏移） -->
      <div class="code-column col-down-slow">
        <div class="code-track">
          <div class="code-content" v-html="codeSnippet3"></div>
          <div class="code-content" v-html="codeSnippet3"></div>
        </div>
      </div>
    </div>

    <!-- 萌动渐变遮罩层，营造柔和与虚化边缘 -->
    <div class="vignette-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const containerRef = ref<HTMLElement | null>(null)

// 鼠标/陀螺仪目标位置与当前平滑插值位置 (-1 ~ 1)
const targetX = ref(0)
const targetY = ref(0)
const currentX = ref(0)
const currentY = ref(0)

// 自然呼吸微动时间戳
let time = 0
let animFrameId: number | null = null

// 运行与视口感知状态
let isVisible = true
let observer: IntersectionObserver | null = null

// 鼠标移动监听
const handleMouseMove = (e: MouseEvent) => {
  if (typeof window === 'undefined' || !isVisible) return
  const { innerWidth, innerHeight } = window
  // 计算归一化坐标 (-1 到 1)
  targetX.value = (e.clientX / innerWidth - 0.5) * 2
  targetY.value = (e.clientY / innerHeight - 0.5) * 2
}

// 移动端设备陀螺仪监听
const handleOrientation = (e: DeviceOrientationEvent) => {
  if (!isVisible) return
  if (e.gamma !== null && e.beta !== null) {
    targetX.value = Math.min(Math.max(e.gamma / 30, -1), 1)
    targetY.value = Math.min(Math.max((e.beta - 45) / 30, -1), 1)
  }
}

// 逐帧线性插值 (LERP) 与呼吸摆动
const updateMotion = () => {
  if (!isVisible) {
    animFrameId = null
    return
  }

  time += 0.015

  // 基础自然微晃，即便鼠标不动也能有悬浮生机感
  const idleX = Math.sin(time * 0.7) * 0.08
  const idleY = Math.cos(time * 0.5) * 0.06

  const finalTargetX = targetX.value + idleX
  const finalTargetY = targetY.value + idleY

  // 缓动插值，实现类似果冻漂浮的柔和惯性跟随
  currentX.value += (finalTargetX - currentX.value) * 0.06
  currentY.value += (finalTargetY - currentY.value) * 0.06

  animFrameId = requestAnimationFrame(updateMotion)
}

function startAnimation() {
  if (!animFrameId && isVisible) {
    animFrameId = requestAnimationFrame(updateMotion)
  }
}

function stopAnimation() {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
}

const handleVisibilityChange = () => {
  if (typeof document === 'undefined') return
  if (document.hidden) {
    stopAnimation()
  } else if (isVisible) {
    startAnimation()
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('deviceorientation', handleOrientation, { passive: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // 视口交叉检测：离开屏幕时完全暂停动画与重绘
    if ('IntersectionObserver' in window && containerRef.value) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            isVisible = entry.isIntersecting
            if (isVisible) {
              startAnimation()
            } else {
              stopAnimation()
            }
          }
        },
        { threshold: 0.05 }
      )
      observer.observe(containerRef.value)
    } else {
      startAnimation()
    }
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('deviceorientation', handleOrientation)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    stopAnimation()
  }
})

// 计算 3D 舞台倾角
const stageStyle = computed(() => {
  const rotY = currentX.value * 14 - 10 // 偏向侧方形成立体折角
  const rotX = -currentY.value * 10 + 6
  return {
    transform: `rotateY(${rotY.toFixed(2)}deg) rotateX(${rotX.toFixed(2)}deg) translateZ(0)`
  }
})

// === 真实的 infOS TypeScript + NIT 萌动浪漫核心代码片段（带语法高亮样式） ===
const codeSnippet1 = `
<span class="c-comment">// 🌸 主 Agent 认知检索与状态感知</span>
<span class="c-kw">const</span> memories = <span class="c-kw">await</span> <span class="c-fn">triviumdb</span>.<span class="c-fn">searchAdvanced</span>({
  query: <span class="c-str">'雨天听音乐'</span>,
  sa_ppr: { depth: <span class="c-num">3</span>, restart_prob: <span class="c-num">0.15</span> },
  dpp: { diversity: <span class="c-num">0.85</span> },
  fista: { threshold: <span class="c-num">0.05</span> }
});

<span class="c-kw">const</span> context = <span class="c-kw">await</span> <span class="c-fn">contextCompiler</span>.<span class="c-fn">compile</span>({
  principal: <span class="c-str">'pero'</span>,
  channel: <span class="c-str">'desktop'</span>,
  activeMemories: memories.canonical
});

<span class="c-comment">// 检查点与三层记忆门控提纯</span>
<span class="c-kw">await</span> <span class="c-fn">memoryGate</span>.<span class="c-fn">reviewCandidate</span>({
  importance: <span class="c-num">0.96</span>,
  provenance: <span class="c-str">'user_interaction_392'</span>
});
`

const codeSnippet2 = `
<span class="c-comment">// 🐾 NIT 原生工具多步编排引擎</span>
<span class="c-kw">await</span> <span class="c-fn">nit</span>.<span class="c-fn">execute</span>(<span class="c-str">\`
  $mood = get_agent_mood()
  if ($mood == 'happy') {
    pet_3d.play_animation("ear_flutter")
    say("主人主人，今天代码跑得超级顺畅喵~！")
  } else {
    tap_window_glass(intensity: 0.6)
  }
\`</span>, { sandbox: <span class="c-str">'audited'</span> });

<span class="c-comment">// ⚡ Hono + Protobuf Gateway 流式同步</span>
<span class="c-fn">gateway</span>.<span class="c-fn">broadcast</span>(<span class="c-str">'pero@desktop'</span>, {
  motion: <span class="c-str">'tail_wag'</span>,
  physics: { bounce: <span class="c-num">1.2</span> },
  tts: { emotion: <span class="c-str">'gentle_warm'</span> }
});
`

const codeSnippet3 = `
<span class="c-comment">// 🏠 据点多角色协同 (Stronghold)</span>
<span class="c-kw">const</span> room = <span class="c-kw">await</span> <span class="c-fn">stronghold</span>.<span class="c-fn">getRoom</span>(<span class="c-str">'living_room'</span>);
<span class="c-kw">await</span> room.<span class="c-fn">dispatchGroupThread</span>({
  members: [<span class="c-str">'pero'</span>, <span class="c-str">'carola'</span>],
  topic: <span class="c-str">'讨论今天的红茶与代码'</span>
});

<span class="c-comment">// 🎮 Steam 创意工坊与云存档互联</span>
<span class="c-kw">await</span> <span class="c-fn">steamworks</span>.<span class="c-fn">workshop</span>.<span class="c-fn">syncSubscribedItems</span>({
  type: <span class="c-str">'character_skin'</span>,
  author: <span class="c-str">'YoKONCy'</span>
});
`
</script>

<style scoped>
.parallax-code-stream-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 640px;
  overflow: hidden;
  pointer-events: none;
  perspective: 1000px;
  z-index: 0;
}

/* 3D 变换视差舞台 */
.code-stage {
  position: absolute;
  top: -20%;
  left: -15%;
  width: 130%;
  height: 140%;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 36px;
  transform-style: preserve-3d;
  will-change: transform;
}

/* 单列代码瀑布容器 */
.code-column {
  position: relative;
  width: 380px;
  max-width: 32vw;
  height: 100%;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(244, 114, 182, 0.25);
  box-shadow: 0 8px 32px rgba(244, 114, 182, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  opacity: 0.85;
}

/* 主列具有更清晰的层次 */
.col-primary {
  background: rgba(255, 255, 255, 0.94);
  border-color: rgba(167, 216, 240, 0.45);
  box-shadow: 0 12px 40px rgba(167, 216, 240, 0.15);
  opacity: 0.95;
  transform: translateZ(30px);
}

/* 跑马灯流动轨道 */
.code-track {
  display: flex;
  flex-direction: column;
}

/* 代码文本排版 */
.code-content {
  font-family: 'Consolas', 'Fira Code', 'Monaco', monospace;
  font-size: 11.5px;
  line-height: 1.7;
  padding: 24px;
  white-space: pre;
  user-select: none;
  color: #3b2a2d;
}

/* 滚动动画：向下滚动 */
.col-down .code-track {
  animation: scrollDown 38s linear infinite;
}

/* 滚动动画：向上滚动 */
.col-up .code-track {
  animation: scrollUp 42s linear infinite;
}

/* 滚动动画：向下滚动（较慢） */
.col-down-slow .code-track {
  animation: scrollDown 48s linear infinite;
}

@keyframes scrollDown {
  0% {
    transform: translateY(-50%);
  }
  100% {
    transform: translateY(0%);
  }
}

@keyframes scrollUp {
  0% {
    transform: translateY(0%);
  }
  100% {
    transform: translateY(-50%);
  }
}

/* 边缘羽化虚化遮罩 */
.vignette-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 50% 45%,
    transparent 20%,
    rgba(252, 250, 255, 0.5) 60%,
    var(--vp-c-bg, #fcfaff) 92%
  );
}

/* 代码高亮配色（萌动科技马卡龙调色盘） */
:deep(.c-comment) {
  color: #a08890;
  font-style: italic;
}
:deep(.c-kw) {
  color: #ec4899; /* 樱花粉关键字 */
  font-weight: 600;
}
:deep(.c-fn) {
  color: #0284c7; /* 晴空蓝函数名 */
  font-weight: 600;
}
:deep(.c-str) {
  color: #ca8a04; /* 暖黄琥珀字符串 */
}
:deep(.c-num) {
  color: #9333ea; /* 梦幻紫数字 */
}

@media (max-width: 768px) {
  .parallax-code-stream-container {
    height: 520px;
  }
  .code-stage {
    gap: 16px;
    left: -10%;
    width: 120%;
  }
  .code-column:nth-child(3) {
    display: none; /* 移动端隐藏第 3 列以保障流畅度 */
  }
}
</style>
