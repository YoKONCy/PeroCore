<template>
  <div
    class="flex flex-col h-full bg-slate-950 text-slate-300 font-mono text-sm overflow-hidden relative group/terminal pixel-border-dark"
  >
    <!-- CRT 扫描线效果 -->
    <div
      class="absolute inset-0 pointer-events-none z-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))]"
      style="
        background-size:
          100% 3px,
          3px 100%;
      "
    ></div>

    <div
      class="flex items-center justify-between px-4 py-2 bg-slate-900 border-b-2 border-slate-800 shrink-0 relative z-20"
    >
      <div class="flex items-center gap-2 font-bold text-slate-200">
        <div class="animate-pulse">
          <PixelIcon name="terminal" size="sm" class="text-moe-sky" />
        </div>
        <span class="tracking-wider pixel-font">实时终端 (Native Terminal)</span>
      </div>
      <div class="flex items-center gap-4">
        <label
          class="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-moe-sky transition-colors group/check"
        >
          <div
            class="w-4 h-4 border-2 border-slate-600 flex items-center justify-center transition-colors group-hover/check:border-moe-sky pixel-border-sm-dark"
            :class="autoScroll ? 'bg-moe-sky border-moe-sky' : 'bg-transparent'"
          >
            <PixelIcon v-if="autoScroll" name="check" size="xs" class="text-white" />
          </div>
          <input v-model="autoScroll" type="checkbox" class="hidden" />
          <span class="font-bold pixel-font">自动滚动</span>
        </label>
        <button
          class="p-1.5 hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors group active:scale-90 pixel-border-sm-transparent hover:pixel-border-sm-dark"
          title="清空"
          @click="clearLogs"
        >
          <PixelIcon name="trash" size="xs" class="group-hover:shake" />
        </button>
      </div>
    </div>

    <div ref="logContainer" class="flex-1 overflow-y-auto p-4 custom-scrollbar relative z-0">
      <div
        v-for="(log, index) in logs"
        :key="index"
        class="break-all whitespace-pre-wrap leading-none text-[13px] font-mono hover:bg-white/5 transition-colors px-1 border-l-2 border-transparent hover:border-moe-sky/30 pl-2 -ml-2"
        :class="getLogClass(log.type)"
      >
        <span class="text-slate-500 mr-2 opacity-70">[{{ log.timestamp }}]</span>
        <span class="mr-2 font-bold tracking-wider" :class="getSourceClass(log.source)"
          >[{{ log.source }}]</span
        >
        <span class="message" v-html="formatMessage(log.message)"></span>
      </div>

      <!-- 空状态 -->
      <div
        v-if="logs.length === 0"
        class="flex flex-col items-center justify-center h-full text-slate-600 gap-3 opacity-50"
      >
        <PixelIcon name="desktop" size="xl" class="text-moe-sky/50" />
        <span class="text-xs tracking-widest uppercase pixel-font">等待系统日志...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onUnmounted, nextTick } from 'vue'
import PixelIcon from '../ui/PixelIcon.vue'
import { listen } from '@/utils/ipcAdapter'
import { getRuntimeCapabilities } from '@/utils/runtimeCapabilities'
// 引入调用函数
import { invoke } from '@/utils/ipcAdapter'

const logs = shallowRef([])
const logContainer = ref(null)
const autoScroll = ref(true)
let unlistenFn = null
let pendingLogs = []
let updateTimer = null
const runtimeCapabilities = getRuntimeCapabilities()

const getLogClass = (type) => {
  switch (type) {
    case 'error':
      return 'text-red-400'
    case 'warn':
      return 'text-amber-400'
    case 'info':
      return 'text-slate-300'
    default:
      return 'text-slate-400'
  }
}

const getSourceClass = (source) => {
  return source === 'backend' ? 'text-blue-400' : 'text-emerald-400'
}

const extractTimestamp = (msg) => {
  // 尝试从消息中提取时间戳 HH:mm:ss (例如 21:35:06)
  // 优先匹配带毫秒的，如 21:35:06.123
  const timeMatch = msg && msg.match(/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/)
  return timeMatch ? timeMatch[1] : new Date().toLocaleTimeString()
}

const addLog = (source, type, message) => {
  const timestamp = extractTimestamp(message)
  pendingLogs.push({
    source, // 'backend' (后端) | 'frontend' (前端)
    type, // 'stdout' (标准输出) | 'stderr' (标准错误) | 'info' (信息) | 'warn' (警告) | 'error' (错误) | 'system' (系统)
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

const unwrapEventPayload = (event) => {
  if (event && typeof event === 'object' && 'payload' in event) {
    return event.payload
  }

  return event
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
    AGENT: '#ff88aa', // 粉色
    VOICE: '#a0c4ff', // 蓝色
    PROCESS: '#a8e6cf', // 绿色
    LLM: '#bdb2ff', // 紫色
    MEMORY: '#ffd1dc', // 浅粉
    MCP: '#9cdcfe', // 浅蓝
    SYSTEM: '#c586c0', // 紫红
    ERROR: '#f48771', // 红色
    WARN: '#cca700' // 黄色
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
    if (!runtimeCapabilities.backendLogHistory && !runtimeCapabilities.backendLogStream) {
      addLog(
        'system',
        'info',
        '当前运行模式不提供内建后端实时日志；如需查看服务端输出，请使用部署平台或宿主环境的 Runtime Logs。'
      )
      return
    }

    // 1. 先拉取历史日志
    if (runtimeCapabilities.backendLogHistory) {
      try {
        const historyLogs = await invoke('get_backend_logs')
        if (Array.isArray(historyLogs)) {
          historyLogs.forEach((logLine) => {
            let type = 'info'
            if (
              logLine.toLowerCase().includes('[err]') ||
              logLine.toLowerCase().includes('error')
            ) {
              type = 'error'
            } else if (logLine.toLowerCase().includes('warn')) {
              type = 'warn'
            }
            logs.value = [
              ...logs.value,
              {
                source: 'backend',
                type,
                message: logLine,
                timestamp: extractTimestamp(logLine)
              }
            ]
          })
          scrollToBottom()
        }
      } catch (err) {
        console.error('获取日志历史失败:', err)
      }
    }

    if (!runtimeCapabilities.backendLogStream) {
      return
    }

    const unlisteners = []

    // 2. 监听来自 Rust 的后端原始日志
    unlisteners.push(
      await listen('backend-log', (event) => {
        const msg = unwrapEventPayload(event) || ''
        let type = 'info'
        if (
          typeof msg === 'string' &&
          (msg.toLowerCase().includes('[err]') || msg.toLowerCase().includes('error'))
        ) {
          type = 'error'
        } else if (typeof msg === 'string' && msg.toLowerCase().includes('warn')) {
          type = 'warn'
        }
        addLog('backend', type, String(msg))
      })
    )

    unlisteners.push(
      await listen('backend-log-batch', (event) => {
        const batchLogs = unwrapEventPayload(event) || []
        if (Array.isArray(batchLogs)) {
          batchLogs.forEach((msg) => {
            let type = 'info'
            if (
              typeof msg === 'string' &&
              (msg.toLowerCase().includes('[err]') || msg.toLowerCase().includes('error'))
            ) {
              type = 'error'
            } else if (typeof msg === 'string' && msg.toLowerCase().includes('warn')) {
              type = 'warn'
            }
            addLog('backend', type, String(msg))
          })
        }
      })
    )

    unlisteners.push(
      await listen('terminal-log', (event) => {
        const log = unwrapEventPayload(event)
        if (log && typeof log === 'object') {
          addLog('backend', log.type || 'info', log.message || '')
        }
      })
    )

    unlistenFn = () => {
      unlisteners.forEach((dispose) => dispose())
    }
  } catch (e) {
    console.error('设置 Tauri 监听器失败', e)
    addLog('system', 'error', '无法连接到后端日志。')
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

/* 日志类型 */
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
