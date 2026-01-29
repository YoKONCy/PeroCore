<template>
  <div class="terminal-panel">
    <div class="terminal-header">
      <div class="title">
        <el-icon><ChatDotSquare /></el-icon> NapCat 交互终端
      </div>
      <div class="actions">
        <el-button size="small" circle @click="clearLogs" title="清空">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
    
    <div class="terminal-content" ref="logContainer">
      <div v-for="log in logs" :key="log.id" class="log-line">
        <span class="timestamp">[{{ log.time }}]</span>
        <span class="message" v-html="ansiToHtml(log.content)"></span>
      </div>
      <div v-if="logs.length === 0" class="empty-state">
         <el-icon class="empty-icon"><Monitor /></el-icon>
         <span>等待 NapCat 进程输出...</span>
      </div>
    </div>

    <div class="terminal-input-area">
        <div class="input-prefix">
            <el-icon><ArrowRight /></el-icon>
        </div>
        <input 
            v-model="inputValue" 
            class="terminal-input"
            placeholder="输入指令并回车..." 
            @keyup.enter="sendCommand"
            spellcheck="false"
        />
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { ChatDotSquare, Delete, Monitor, ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { listen, invoke } from '@/utils/ipcAdapter'
// State
// 状态
const logs = ref([])
const inputValue = ref('')
const logContainer = ref(null)
let unlistenFn = null

// Actions
// 操作
const clearLogs = () => {
  logs.value = []
}

const scrollToBottom = () => {
  if (logContainer.value) {
    nextTick(() => {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    })
  }
}

watch(logs, () => scrollToBottom(), { deep: true })

const sendCommand = async () => {
  if (!inputValue.value.trim()) return
  
  const cmd = inputValue.value
  
  try {
    await invoke('send_napcat_command_wrapper', { command: cmd })
    
    // Mirror the input to the terminal
    // 将输入镜像到终端
    logs.value.push({
      time: new Date().toLocaleTimeString(),
      content: `> ${cmd}`,
      id: Date.now() + Math.random()
    })
    inputValue.value = ''
  } catch (e) {
    console.error(`[Error] Failed to send command: ${e}`)
    ElMessage.error(`发送指令失败: ${e}`)
  }
}

// ANSI to HTML helper
// ANSI 转 HTML 辅助函数
const ansiToHtml = (text) => {
  if (!text) return ''
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // Basic ANSI colors
  // 基本 ANSI 颜色
  const colors = {
    '0': 'reset',
    '30': 'text-slate-500', // black
    '31': 'text-red-400',   // red
    '32': 'text-emerald-400', // green
    '33': 'text-amber-400',  // yellow
    '34': 'text-blue-400',   // blue
    '35': 'text-purple-400', // magenta
    '36': 'text-cyan-400',   // cyan
    '37': 'text-slate-200',  // white
    '90': 'text-slate-600',  // bright black
  }

  // Very basic implementation
  // 非常基础的实现
  result = result.replace(/\x1b\[(\d+)m/g, (match, code) => {
    const className = colors[code]
    if (className === 'reset') return '</span>'
    if (className) return `<span class="${className}">`
    return ''
  })
  
  return result
}

onMounted(async () => {
  try {
      const invoke = (cmd, args) => import('@/utils/ipcAdapter').then(m => m.invoke(cmd, args))
      // 1. Fetch history first to show past logs (including QR code)
      // 1. 首先获取历史记录以显示过去的日志（包括二维码）
      const history = await (await import('@/utils/ipcAdapter')).invoke('get_napcat_logs')
      if (history && history.length > 0) {
          logs.value = history.map(line => ({
            time: new Date().toLocaleTimeString(),
            content: line,
            id: Date.now() + Math.random()
          }))
      }

      // 2. Start listening for new logs
      // 2. 开始监听新日志
      unlistenFn = await listen('napcat_log', (payload) => {
        // 在 Electron 中，payload 就是日志内容本身 (字符串)
        // 在 Tauri 中，payload 可能是 event.payload，但 ipcAdapter 已处理过
        const logLine = typeof payload === 'string' ? payload : (payload.payload || String(payload))
        
        const timestamp = new Date().toLocaleTimeString()
        
        logs.value.push({
          time: timestamp,
          content: logLine,
          id: Date.now() + Math.random()
        })
        
        if (logs.value.length > 500) logs.value.shift()
      })
  } catch (e) {
    console.error('Failed to init napcat logs', e)
  }
})

onUnmounted(() => {
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
  line-height: 1;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Scrollbar */
/* 滚动条 */
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

.message {
  flex: 1;
}

/* Empty State */
/* 空状态 */
.empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #666;
    gap: 10px;
}
.empty-icon {
    font-size: 48px;
    opacity: 0.5;
}

/* Input Area */
/* 输入区域 */
.terminal-input-area {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background-color: #252526;
    border-top: 1px solid #3d3d3d;
}

.input-prefix {
    color: #22c55e; /* emerald-500 */
    margin-right: 8px;
    display: flex;
    align-items: center;
}

.terminal-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #d4d4d4;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
}

.terminal-input::placeholder {
    color: #666;
}

/* Tailwind-like text colors for ANSI */
/* 类似 Tailwind 的 ANSI 文本颜色 */
.text-slate-500 { color: #64748b; }
.text-red-400 { color: #f87171; }
.text-emerald-400 { color: #34d399; }
.text-amber-400 { color: #fbbf24; }
.text-blue-400 { color: #60a5fa; }
.text-purple-400 { color: #c084fc; }
.text-cyan-400 { color: #22d3ee; }
.text-slate-200 { color: #e2e8f0; }
.text-slate-600 { color: #475569; }

</style>