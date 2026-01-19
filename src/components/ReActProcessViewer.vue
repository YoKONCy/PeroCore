<template>
  <div class="react-viewer">
    <!-- 顶部工具栏：暂停/继续 (仅 Live 模式) -->
    <div class="toolbar" v-if="isLive">
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
         {{ isLive ? '等待思考数据...' : '无思考过程记录' }}
       </div>
       <div v-else v-for="(segment, index) in segments" :key="index" class="monitor-segment">
        <!-- 普通文本 -->
        <div v-if="segment.type === 'text'" class="segment-text">{{ segment.content }}</div>
        
        <!-- 动作描述 -->
        <div v-else-if="segment.type === 'action'" class="segment-action">* {{ segment.content }} *</div>
        
        <!-- 思考过程 -->
        <div v-else-if="segment.type === 'thinking'" class="segment-thinking">
          <div class="thinking-label">🤔 思考链 (Chain of Thought)</div>
          <div class="thinking-content">{{ segment.content }}</div>
        </div>

        <!-- 错误信息 (新增) -->
        <div v-else-if="segment.type === 'error'" class="segment-error">
          <div class="error-label">❌ 错误</div>
          <div class="error-content">{{ segment.content }}</div>
        </div>

        <!-- 反思/修正 (新增) -->
        <div v-else-if="segment.type === 'reflection'" class="segment-reflection">
          <div class="reflection-label">💡 自我反思</div>
          <div class="reflection-content">{{ segment.content }}</div>
        </div>
      </div>
    </div>

    <!-- 底部指令注入区 (仅 Live 模式) -->
    <div class="injection-panel" v-if="isLive">
      <input 
        v-model="injectionInput" 
        @keyup.enter="sendInjection"
        :placeholder="`发送指令干预 ${AGENT_NAME} 的思考 (例如: 停下，换个方向)...`"
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
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { AGENT_NAME } from '../config'

const props = defineProps({
  segments: {
    type: Array,
    default: () => []
  },
  isLive: {
    type: Boolean,
    default: false
  }
})

const isTaskPaused = ref(false)
const injectionInput = ref('')
const isSendingInjection = ref(false)
const scrollArea = ref(null)

// 自动滚动到底部
watch(() => props.segments, () => {
  nextTick(() => {
    if (scrollArea.value) {
      scrollArea.value.scrollTop = scrollArea.value.scrollHeight
    }
  })
}, { deep: true })

// --- 任务控制逻辑 ---
const checkTaskStatus = async () => {
  if (!props.isLive) return
  try {
    const res = await fetch(`http://localhost:9120/api/task/default/status`)
    if (res.ok) {
      const data = await res.json()
      isTaskPaused.value = data.status === 'paused'
    }
  } catch (e) {
    // silent fail
  }
}

let statusTimer = null
onMounted(() => {
  if (props.isLive) {
    checkTaskStatus()
    statusTimer = setInterval(checkTaskStatus, 2000)
  }
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
})

const toggleTaskPause = async () => {
  const action = isTaskPaused.value ? 'resume' : 'pause'
  try {
    const res = await fetch(`http://localhost:9120/api/task/default/${action}`, { method: 'POST' })
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
    const res = await fetch(`http://localhost:9120/api/task/default/inject`, {
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
.react-viewer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fdfdfd;
  overflow: hidden;
}

.toolbar {
  padding: 10px 15px;
  border-bottom: 1px solid #f1f3f5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  flex-shrink: 0;
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
  padding: 20px;
  background: #f8f9fa;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.monitor-segment {
  font-size: 14px;
  line-height: 1.6;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.segment-text {
  color: #343a40;
  background: white;
  padding: 10px 15px;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.segment-action {
  color: #868e96;
  font-style: italic;
  font-size: 13px;
  text-align: left;
  padding: 4px 15px;
  margin: 2px 0;
}

.segment-thinking {
  background: #f0f7ff;
  border: 1px solid #d0e6ff;
  border-radius: 8px;
  padding: 12px 15px;
  border-left: 4px solid #339af0;
}

.thinking-label {
  font-size: 12px;
  color: #339af0;
  margin-bottom: 6px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.thinking-content {
  color: #495057;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  font-size: 13px;
}

/* 新增样式 */
.segment-error {
  background: #fff5f5;
  border: 1px solid #ffc9c9;
  border-radius: 8px;
  padding: 12px 15px;
  border-left: 4px solid #fa5252;
}

.error-label {
  font-size: 12px;
  color: #fa5252;
  margin-bottom: 6px;
  font-weight: 700;
}

.error-content {
  color: #c92a2a;
  font-family: monospace;
}

.segment-reflection {
  background: #fff9db;
  border: 1px solid #ffec99;
  border-radius: 8px;
  padding: 12px 15px;
  border-left: 4px solid #fcc419;
}

.reflection-label {
  font-size: 12px;
  color: #f59f00;
  margin-bottom: 6px;
  font-weight: 700;
}

.reflection-content {
  color: #e67700;
}

.injection-panel {
  padding: 15px;
  background: white;
  border-top: 1px solid #e9ecef;
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.injection-input {
  flex: 1;
  padding: 10px 15px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.injection-input:focus {
  border-color: #339af0;
  box-shadow: 0 0 0 3px rgba(51, 154, 240, 0.1);
}

.send-btn {
  padding: 0 20px;
  background: #339af0;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
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
  margin-top: 60px;
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