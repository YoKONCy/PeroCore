<template>
  <div class="monitor-container">
    <div class="monitor-window">
      <!-- 标题栏 (可拖动) -->
      <div class="window-header">
        <div class="header-left">
          <span class="header-icon">🧠</span>
          <span class="header-title">Pero 思维监控室</span>
        </div>
        <div class="header-controls">
          <button class="win-btn close-btn" @click="close" title="关闭">×</button>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="window-content-wrapper">
        <!-- 顶部工具栏：暂停/继续 -->
        <div class="toolbar">
          <div class="status-indicator">
            <span class="status-dot" :class="{ 'paused': isTaskPaused, 'running': !isTaskPaused }"></span>
            <span class="status-text">{{ isTaskPaused ? '任务已暂停' : '正在思考中...' }}</span>
          </div>
          <button 
            class="control-btn pause-btn" 
            :class="{ active: isTaskPaused }"
            @click="toggleTaskPause"
            :title="isTaskPaused ? '继续任务' : '暂停任务'"
          >
            {{ isTaskPaused ? '▶️ 继续运行' : '⏸️ 暂停思考' }}
          </button>
        </div>

        <!-- 思考内容滚动区 -->
        <div class="content-scroll-area custom-scrollbar" ref="scrollArea">
           <div v-if="segments.length === 0" class="empty-tip">
             暂无思考内容...
           </div>
           <div v-else v-for="(segment, index) in segments" :key="index" class="monitor-segment">
            <!-- 普通文本 -->
            <div v-if="segment.type === 'text'" class="segment-text">{{ segment.content }}</div>
            
            <!-- 动作描述 -->
            <div v-else-if="segment.type === 'action'" class="segment-action">* {{ segment.content }} *</div>
            
            <!-- 思考过程 -->
            <div v-else-if="segment.type === 'thinking'" class="segment-thinking">
              <div class="thinking-label">🤔 思考链</div>
              <div class="thinking-content">{{ segment.content }}</div>
            </div>
          </div>
        </div>

        <!-- 底部指令注入区 -->
        <div class="injection-panel">
          <input 
            v-model="injectionInput" 
            @keyup.enter="sendInjection"
            placeholder="发送指令干预 Pero 的思考 (例如: 停下，换个方向)..."
            :disabled="isSendingInjection"
            class="injection-input"
          />
          <button 
            class="send-btn"
            @click="sendInjection" 
            :disabled="!injectionInput.trim() || isSendingInjection"
          >
            {{ isSendingInjection ? '发送中...' : '发送' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'

const segments = ref([])
const isTaskPaused = ref(false)
const injectionInput = ref('')
const isSendingInjection = ref(false)
const scrollArea = ref(null)

// Electron IPC
const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null

onMounted(() => {
  if (ipcRenderer) {
    // 监听来自主进程的数据更新
    ipcRenderer.on('update-monitor-data', (event, data) => {
      segments.value = data
    })
  }

  // 启动状态轮询
  checkTaskStatus()
  const timer = setInterval(checkTaskStatus, 2000)
  onUnmounted(() => clearInterval(timer))
})

const close = () => {
  if (ipcRenderer) {
    ipcRenderer.send('close-task-monitor')
  }
}

// 自动滚动到底部
watch(segments, () => {
  nextTick(() => {
    if (scrollArea.value) {
      scrollArea.value.scrollTop = scrollArea.value.scrollHeight
    }
  })
}, { deep: true })

// --- 任务控制逻辑 (与 Modal 版保持一致) ---
const checkTaskStatus = async () => {
  try {
    const res = await fetch(`http://localhost:3000/api/task/default/status`)
    if (res.ok) {
      const data = await res.json()
      isTaskPaused.value = data.status === 'paused'
    }
  } catch (e) {
    // silent fail
  }
}

const toggleTaskPause = async () => {
  const action = isTaskPaused.value ? 'resume' : 'pause'
  try {
    const res = await fetch(`http://localhost:3000/api/task/default/${action}`, { method: 'POST' })
    if (res.ok) {
      isTaskPaused.value = !isTaskPaused.value
    }
  } catch (e) {
    console.error('Task control failed', e)
  }
}

const sendInjection = async () => {
  if (!injectionInput.value.trim()) return
  
  isSendingInjection.value = true
  try {
    const res = await fetch(`http://localhost:3000/api/task/default/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: injectionInput.value })
    })
    
    if (res.ok) {
      injectionInput.value = ''
    }
  } catch (e) {
    console.error('Injection failed', e)
  } finally {
    isSendingInjection.value = false
  }
}
</script>

<style scoped>
.monitor-container {
  width: 100%;
  height: 100vh;
  background: rgba(255, 255, 255, 0.95);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.monitor-window {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.window-header {
  height: 40px;
  background: #f1f3f5;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  user-select: none;
  /* 关键：允许拖动整个窗口 */
  -webkit-app-region: drag; 
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #495057;
  font-size: 14px;
}

.header-controls {
  display: flex;
  gap: 6px;
  /* 按钮区域不可拖动，否则无法点击 */
  -webkit-app-region: no-drag; 
}

.win-btn {
  border: none;
  background: transparent;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #868e96;
  transition: all 0.2s;
}

.win-btn:hover {
  background: rgba(0,0,0,0.05);
  color: #343a40;
}

.close-btn:hover {
  background: #ff6b6b;
  color: white;
}

.window-content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f3f5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #666;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
}

.status-dot.running {
  background: #51cf66;
  box-shadow: 0 0 0 2px rgba(81, 207, 102, 0.2);
}

.status-dot.paused {
  background: #fcc419;
  animation: pulse 2s infinite;
}

.control-btn {
  padding: 6px 12px;
  border: 1px solid #e9ecef;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-btn:hover {
  background: #f8f9fa;
  border-color: #ced4da;
}

.control-btn.active {
  background: #fff9db;
  border-color: #fcc419;
  color: #e67700;
}

.content-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: #f8f9fa;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.monitor-segment {
  font-size: 14px;
  line-height: 1.5;
}

.segment-text {
  color: #343a40;
}

.segment-action {
  color: #868e96;
  font-style: italic;
  font-size: 13px;
}

.segment-thinking {
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 8px 12px;
}

.thinking-label {
  font-size: 12px;
  color: #adb5bd;
  margin-bottom: 4px;
  font-weight: 600;
}

.thinking-content {
  color: #495057;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 13px;
}

.injection-panel {
  padding: 12px;
  background: white;
  border-top: 1px solid #e9ecef;
  display: flex;
  gap: 8px;
}

.injection-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.injection-input:focus {
  border-color: #339af0;
}

.send-btn {
  padding: 0 16px;
  background: #339af0;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: #228be6;
}

.send-btn:disabled {
  background: #adb5bd;
  cursor: not-allowed;
}

.empty-tip {
  color: #adb5bd;
  text-align: center;
  margin-top: 40px;
  font-size: 14px;
}

/* 滚动条样式 */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #dee2e6;
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #ced4da;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}
</style>