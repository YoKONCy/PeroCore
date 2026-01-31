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
    
    <div class="canvas-wrapper" ref="wrapper">
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
    this.vx = (Math.random() - 0.5) * 0.5
    this.vy = (Math.random() - 0.5) * 0.5
    this.size = Math.random() * 3 + 2
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)]
    this.pulse = Math.random() * Math.PI
  }

  update(w, h) {
    this.x += this.vx
    this.y += this.vy

    // Bounce off walls
    if (this.x < 0 || this.x > w) this.vx *= -1
    if (this.y < 0 || this.y > h) this.vy *= -1
    
    // Pulse animation
    this.pulse += 0.05
  }

  draw(context) {
    context.beginPath()
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    context.fillStyle = this.color
    context.fill()
    
    // Glow effect
    context.shadowBlur = 10
    context.shadowColor = this.color
  }
}

const init = () => {
  if (!canvas.value || !wrapper.value) return
  
  width = wrapper.value.offsetWidth
  height = 400 // Fixed height
  
  canvas.value.width = width
  canvas.value.height = height
  ctx = canvas.value.getContext('2d')
  
  // Create nodes
  nodes = []
  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push(new Node(width, height))
  }
  nodeCount.value = NODE_COUNT.toLocaleString()
}

const animate = () => {
  if (!ctx) return
  
  ctx.clearRect(0, 0, width, height)
  
  // Update and draw nodes
  nodes.forEach(node => {
    node.update(width, height)
    node.draw(ctx)
  })
  
  // Draw connections
  let connections = 0
  ctx.lineWidth = 0.5
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x
      const dy = nodes[i].y - nodes[j].y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      if (distance < CONNECTION_DISTANCE) {
        connections++
        const opacity = 1 - (distance / CONNECTION_DISTANCE)
        ctx.strokeStyle = `rgba(150, 150, 150, ${opacity * 0.5})`
        ctx.beginPath()
        ctx.moveTo(nodes[i].x, nodes[i].y)
        ctx.lineTo(nodes[j].x, nodes[j].y)
        ctx.stroke()
      }
    }
  }
  
  // Reset shadow for lines
  ctx.shadowBlur = 0
  
  connectionCount.value = connections.toLocaleString()
  animationFrameId = requestAnimationFrame(animate)
}

onMounted(() => {
  init()
  animate()
  
  window.addEventListener('resize', init)
})

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
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

.control.close { background-color: #ef4444; }
.control.minimize { background-color: #f59e0b; }
.control.maximize { background-color: #10b981; }

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
