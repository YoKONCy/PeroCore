<template>
  <div class="terminal-panel">
    <div class="terminal-header">
      <div class="title">
        <el-icon><Monitor /></el-icon> 实时终端 (Native Terminal)
      </div>
      <div class="actions">
        <el-checkbox v-model="autoScroll" label="自动滚动" size="small" />
        <el-button size="small" circle @click="clearLogs" title="清空">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
    
    <div class="terminal-content" ref="logContainer">
      <div 
        v-for="(log, index) in logs" 
        :key="index" 
        class="log-line"
        :class="log.type"
      >
        <span class="timestamp">[{{ log.timestamp }}]</span>
        <span class="source" :class="log.source">[{{ log.source }}]</span>
        <span class="message" v-html="formatMessage(log.message)"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Monitor, Delete } from '@element-plus/icons-vue'
import { listen } from '@tauri-apps/api/event'

const logs = shallowRef([])
const logContainer = ref(null)
const autoScroll = ref(true)
let unlistenFn = null
let pendingLogs = []
let updateTimer = null

const addLog = (source, type, message) => {
  const timestamp = new Date().toLocaleTimeString()
  pendingLogs.push({
    source, // 'backend' | 'frontend'
    type,   // 'stdout' | 'stderr' | 'info' | 'warn' | 'error' | 'system'
    message,
    timestamp
  })
  
  if (!updateTimer) {
    updateTimer = setTimeout(() => {
      const newLogs = [...logs.value, ...pendingLogs]
      if (newLogs.length > 2000) {
        logs.value = newLogs.slice(newLogs.length - 2000)
      } else {
        logs.value = newLogs
      }
      pendingLogs = []
      updateTimer = null
      
      if (autoScroll.value) {
        scrollToBottom()
      }
    }, 100) // 100ms 批量更新一次，极大减轻渲染压力
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

const clearLogs = () => {
  logs.value = []
}

const formatMessage = (msg) => {
  if (!msg) return ''
  
  // 转义 HTML 防止 XSS
  let escaped = msg
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // 匹配并染色常见的后端标签 [TAG]
  const tagColors = {
    'Agent': '#ff88aa',    // 粉色
    'VOICE': '#a0c4ff',    // 蓝色
    'PROCESS': '#a8e6cf',  // 绿色
    'LLM': '#bdb2ff',      // 紫色
    'MEMORY': '#ffd1dc',   // 浅粉
    'MCP': '#9cdcfe',      // 浅蓝
    'SYSTEM': '#c586c0',   // 紫红
    'ERROR': '#f48771',    // 红色
    'WARN': '#cca700'      // 黄色
  }

  // 使用正则替换标签
  return escaped.replace(/\[([A-Z0-9_-]+)\]/gi, (match, tagName) => {
    const color = tagColors[tagName.toUpperCase()] || '#569cd6' // 默认蓝色
    return `<span style="color: ${color}; font-weight: bold;">[${tagName}]</span>`
  })
}

// 拦截前端日志
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleError = console.error

const hookConsole = () => {
  console.log = (...args) => {
    originalConsoleLog(...args)
    addLog('frontend', 'info', args.map(String).join(' '))
  }
  console.warn = (...args) => {
    originalConsoleWarn(...args)
    addLog('frontend', 'warn', args.map(String).join(' '))
  }
  console.error = (...args) => {
    originalConsoleError(...args)
    addLog('frontend', 'error', args.map(String).join(' '))
  }
}

const unhookConsole = () => {
  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
  console.error = originalConsoleError
}

onMounted(async () => {
  hookConsole()
  
  try {
    // 监听来自 Rust 的后端原始日志
    unlistenFn = await listen('backend-log', (event) => {
      const msg = event.payload
      let type = 'info'
      if (msg.toLowerCase().includes('[err]') || msg.toLowerCase().includes('error')) {
        type = 'error'
      } else if (msg.toLowerCase().includes('warn')) {
        type = 'warn'
      }
      addLog('backend', type, msg)
    })
    
    // 监听其他系统级日志 (如果需要)
    const unlistenTerminal = await listen('terminal-log', (event) => {
      const log = event.payload
      addLog('backend', log.type, log.message)
    })
    
    // 组合清理函数
    const originalUnlisten = unlistenFn
    unlistenFn = () => {
      originalUnlisten()
      unlistenTerminal()
    }
  } catch (e) {
    console.error('Failed to setup Tauri listener', e)
    addLog('system', 'error', 'Failed to connect to backend logs.')
  }
})

onUnmounted(() => {
  unhookConsole()
  if (unlistenFn) {
    unlistenFn()
  }
})
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #1e1e1e;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  user-select: text;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: #2d2d2d;
  border-bottom: 1px solid #3d3d3d;
  color: #ccc;
  user-select: none;
}

.terminal-header .title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
}

.terminal-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.4;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 滚动条样式 */
.terminal-content::-webkit-scrollbar {
  width: 8px;
}
.terminal-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}
.terminal-content::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 4px;
}
.terminal-content::-webkit-scrollbar-thumb:hover {
  background: #4f4f4f;
}

.log-line {
  margin-bottom: 2px;
  display: flex;
  gap: 8px;
}

.timestamp {
  color: #6a9955;
  flex-shrink: 0;
}

.source {
  font-weight: bold;
  flex-shrink: 0;
  width: 80px;
}

.source.backend {
  color: #569cd6;
}

.source.frontend {
  color: #ce9178;
}

.source.system {
  color: #c586c0;
}

.message {
  flex: 1;
}

/* Log types */
.log-line.stderr .message, 
.log-line.error .message {
  color: #f48771;
}

.log-line.warn .message {
  color: #cca700;
}

.log-line.info .message {
  color: #9cdcfe;
}
</style>