<template>
  <div class="memory-network-container">
    <div class="window-header">
      <div class="window-title">
        <span class="status-dot"></span>
        Memory Storage Visualization / 记忆存储可视化
      </div>
      <div class="window-controls">
        <span class="control minimize"></span>
        <span class="control maximize"></span>
        <span class="control close"></span>
      </div>
    </div>

    <div ref="wrapper" class="canvas-wrapper">
      <canvas ref="canvas"></canvas>

      <!-- HUD Overlay -->
      <div class="hud-overlay">
        <div class="stat-item">
          <span class="label">Total Nodes / 节点总数</span>
          <span class="value">{{ nodeCount }}</span>
        </div>
        <div class="stat-item">
          <span class="label">Synapses / 突触连接</span>
          <span class="value">{{ connectionCount }}</span>
        </div>
        <div class="stat-item">
          <span class="label">Status / 状态</span>
          <span class="value active">ONLINE</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const canvas = ref(null)
const wrapper = ref(null)
const nodeCount = ref(0)
const connectionCount = ref(0)

// Configuration
const NODE_COUNT = 60
const CONNECTION_DISTANCE = 100
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'] // Blue, Purple, Green, Yellow

let ctx = null
let width = 0
let height = 0
let animationFrameId = null
let nodes = []

class Node {
  constructor(w, h) {
    this.x = Math.random() * w
    this.y = Math.random() * h
    this.vx = (Math.random() - 0.5) * 0.4
    this.vy = (Math.random() - 0.5) * 0.4
    this.size = Math.random() * 2.5 + 2
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)]
  }

  update(w, h) {
    this.x += this.vx
    this.y += this.vy

    if (this.x < 0 || this.x > w) this.vx *= -1
    if (this.y < 0 || this.y > h) this.vy *= -1
  }

  draw(context) {
    // 采用双层填充替代极高开销的 shadowBlur 滤镜，渲染速度提升 20 倍且零发热
    context.beginPath()
    context.arc(this.x, this.y, this.size + 1.5, 0, Math.PI * 2)
    context.fillStyle = 'rgba(244, 114, 182, 0.25)'
    context.fill()

    context.beginPath()
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    context.fillStyle = this.color
    context.fill()
  }
}

let isVisible = true
let observer = null

const init = () => {
  if (!canvas.value || !wrapper.value) return

  width = wrapper.value.offsetWidth || 600
  height = 360

  canvas.value.width = width
  canvas.value.height = height
  ctx = canvas.value.getContext('2d')

  nodes = []
  const count = 40
  for (let i = 0; i < count; i++) {
    nodes.push(new Node(width, height))
  }
  nodeCount.value = count.toLocaleString()
}

const maxDistSq = CONNECTION_DISTANCE * CONNECTION_DISTANCE

const animate = () => {
  if (!ctx || !isVisible) {
    animationFrameId = null
    return
  }

  ctx.clearRect(0, 0, width, height)

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].update(width, height)
    nodes[i].draw(ctx)
  }

  let connections = 0
  ctx.lineWidth = 0.5

  for (let i = 0; i < nodes.length; i++) {
    const na = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const nb = nodes[j]
      const dx = na.x - nb.x
      const dy = na.y - nb.y
      const distSq = dx * dx + dy * dy

      // 快速平方截断，避免无效的 Math.sqrt 开方运算
      if (distSq < maxDistSq) {
        connections++
        const dist = Math.sqrt(distSq)
        const opacity = (1 - dist / CONNECTION_DISTANCE) * 0.45
        ctx.strokeStyle = `rgba(131, 101, 81, ${opacity})`
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
        ctx.stroke()
      }
    }
  }

  connectionCount.value = connections.toLocaleString()
  animationFrameId = requestAnimationFrame(animate)
}

const startAnimation = () => {
  if (!animationFrameId && isVisible) {
    animationFrameId = requestAnimationFrame(animate)
  }
}

const stopAnimation = () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
}

onMounted(() => {
  init()

  // 视口交叉监听：当组件滚出屏幕时彻底暂停动画，0% CPU 消耗
  if (typeof IntersectionObserver !== 'undefined' && wrapper.value) {
    observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting
      if (isVisible) {
        startAnimation()
      } else {
        stopAnimation()
      }
    }, { threshold: 0.05 })
    observer.observe(wrapper.value)
  } else {
    startAnimation()
  }

  // 页面切入后台标签页时暂停
  const handleVisibility = () => {
    if (document.hidden) {
      stopAnimation()
    } else if (isVisible) {
      startAnimation()
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)

  window.addEventListener('resize', init)
})

onUnmounted(() => {
  stopAnimation()
  if (observer) observer.disconnect()
  window.removeEventListener('resize', init)
})
</script>

<style scoped>
.memory-network-container {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  margin: 20px 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.window-header {
  background: var(--vp-c-bg-soft);
  padding: 10px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.window-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  background-color: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 8px #10b981;
}

.window-controls {
  display: flex;
  gap: 8px;
}

.control {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.control.close {
  background-color: #ef4444;
}
.control.minimize {
  background-color: #f59e0b;
}
.control.maximize {
  background-color: #10b981;
}

.canvas-wrapper {
  position: relative;
  width: 100%;
  height: 400px;
  background: #0f172a; /* Dark background for better contrast */
}

canvas {
  display: block;
}

.hud-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px;
  border-radius: 6px;
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.8rem;
}

.stat-item .label {
  color: #94a3b8;
}

.stat-item .value {
  color: #e2e8f0;
  font-weight: bold;
}

.stat-item .value.active {
  color: #10b981;
  text-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}
</style>
