<script setup lang="ts">
/**
 * TerminalPanel — 系统日志终端
 *
 * 通过 ipcAdapter 与 Electron IPC 通信，浏览器模式自动降级。
 *
 * 功能：
 * - 实时接收后端进程日志 (backend-log / backend-log-batch)
 * - 拦截前端 console.log/warn/error 并展示
 * - CRT 扫描线效果
 * - 日志标签染色 ([AGENT] [LLM] [ERROR] 等)
 * - 自动滚动 + 手动暂停
 * - 最大保留 2000 条 (防止内存膨胀)
 *
 * @module packages/frontend/src/components/terminal/TerminalPanel
 */
import { ref, shallowRef, onMounted, onUnmounted, nextTick } from 'vue'
import { PixelIcon, PButton, PSwitch } from '../pixel'
import { useSystemLogStream } from '../../composables/system/useSystemLogStream'
import { useNotificationStore } from '../../stores'

const notif = useNotificationStore()

// ── 类型定义 ──

type LogSource = 'backend' | 'frontend' | 'system'
type LogType = 'stdout' | 'stderr' | 'info' | 'warn' | 'error' | 'system'

interface LogEntry {
  source: LogSource
  type: LogType
  message: string
  timestamp: string
}

// ── 状态 ──

const logs = shallowRef<LogEntry[]>([])
const logContainer = ref<HTMLDivElement | null>(null)
const autoScroll = ref(true)

// 批量缓冲 (100ms 聚合一次，减轻渲染压力)
let pendingLogs: LogEntry[] = []
let updateTimer: ReturnType<typeof setTimeout> | null = null

// 原始 console 引用
const origLog = console.log
const origWarn = console.warn
const origError = console.error

// ── 日志类型→样式映射 ──

const LOG_TYPE_CLASS: Record<string, string> = {
  error: 'log-error',
  stderr: 'log-error',
  warn: 'log-warn',
  info: 'log-info',
  stdout: 'log-default',
  system: 'log-system',
}

const SOURCE_CLASS: Record<string, string> = {
  backend: 'src-backend',
  frontend: 'src-frontend',
  system: 'src-system',
}

// 标签染色表
const TAG_COLORS: Record<string, string> = {
  AGENT: '#ff88aa',
  VOICE: '#a0c4ff',
  PROCESS: '#a8e6cf',
  LLM: '#bdb2ff',
  MEMORY: '#ffd1dc',
  MCP: '#9cdcfe',
  SYSTEM: '#c586c0',
  ERROR: '#f48771',
  WARN: '#cca700',
  GATEWAY: '#56d4bc',
  IPC: '#d4a056',
  SCHEDULER: '#7dd3fc',
}

// ── 工具函数 ──

/** 从日志文本中提取时间戳，找不到则使用当前时间 */
function extractTimestamp(msg: string): string {
  const m = msg.match(/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/)
  return m ? m[1]! : new Date().toLocaleTimeString()
}

/** 格式化消息：转义 HTML + URL 链接化 + 标签染色 */
function formatMessage(msg: string): string {
  if (!msg) return ''
  const escaped = msg
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // URL 转为可点击链接（转义后的 &amp; 在 href 中会被浏览器正确解析为 &）
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<>"']+)/gi,
    (url) =>
      `<a href="${url}" class="log-link" data-url="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  )

  // 标签染色 [AGENT] [LLM] 等
  return withLinks.replace(/\[([A-Z0-9_-]+)\]/gi, (_match, tag: string) => {
    const color = TAG_COLORS[tag.toUpperCase()] ?? '#569cd6'
    return `<span style="color: ${color}; font-weight: bold;">[${tag}]</span>`
  })
}

/**
 * 日志区点击事件委托：检测是否点击了链接
 *
 * 使用 window.open 在系统浏览器打开，Electron 和浏览器环境通用。
 */
function handleLogClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const link = target.closest('.log-link') as HTMLAnchorElement | null
  if (link) {
    event.preventDefault()
    // 从 data-url 取原始 URL（避免 HTML 实体编码问题）
    const url = link.dataset.url
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}

/**
 * 日志区右键菜单：有选中文本时直接复制到剪贴板
 *
 * 无选中文本时不阻止默认行为，保留原生右键菜单。
 */
async function handleContextMenu(event: MouseEvent): Promise<void> {
  const selection = window.getSelection()
  const text = selection?.toString().trim()
  if (text) {
    event.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      notif.toast('已复制选中文本', { type: 'success' })
    } catch {
      notif.toast('复制失败', { type: 'error' })
    }
  }
}

// ── 核心逻辑 ──

function addLog(source: LogSource, type: LogType, message: string): void {
  pendingLogs.push({
    source,
    type,
    message,
    timestamp: extractTimestamp(message),
  })

  if (!updateTimer) {
    updateTimer = setTimeout(() => {
      const merged = [...logs.value, ...pendingLogs]
      // 保留最新 2000 条
      logs.value = merged.length > 2000 ? merged.slice(merged.length - 2000) : merged
      pendingLogs = []
      updateTimer = null

      if (autoScroll.value) scrollToBottom()
    }, 100)
  }
}

function scrollToBottom(): void {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

function clearLogs(): void {
  logs.value = []
}

// ── console 拦截 ──

function hookConsole(): void {
  console.log = (...args: unknown[]) => {
    origLog(...args)
    addLog('frontend', 'info', args.map(String).join(' '))
  }
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    addLog('frontend', 'warn', args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    origError(...args)
    addLog('frontend', 'error', args.map(String).join(' '))
  }
}

function unhookConsole(): void {
  console.log = origLog
  console.warn = origWarn
  console.error = origError
}

// ── SSE 连接 (Electron / Browser 通用) ──

const logStream = useSystemLogStream({
  onLog: (event) => {
    const level = event.level?.toLowerCase() ?? 'info'
    const type: LogType =
      level === 'error' || level === 'fatal' ? 'error' : level === 'warn' ? 'warn' : 'info'
    addLog('backend', type, event.line)
  },
  onOpen: (url) => {
    addLog('system', 'system', `日志流已连接: ${url}`)
  },
  onReconnect: () => {
    addLog('system', 'warn', '日志流已断开，5秒后重连...')
  },
})

// ── 生命周期 ──

onMounted(async () => {
  hookConsole()

  // 统一使用 SSE 获取后端实时日志（Electron / Browser 通用）
  logStream.connect()
})

onUnmounted(() => {
  unhookConsole()
  logStream.disconnect()
  if (updateTimer) clearTimeout(updateTimer)
})
</script>

<template>
  <div class="terminal-panel">
    <!-- CRT 扫描线效果 -->
    <div class="terminal-crt" />

    <!-- 头部工具栏 -->
    <div class="terminal-header">
      <div class="terminal-header-left">
        <div class="terminal-icon-pulse">
          <PixelIcon name="terminal" size="sm" />
        </div>
        <span class="terminal-title">实时终端</span>
        <span class="terminal-badge">NATIVE</span>
      </div>
      <div class="terminal-header-right">
        <label class="terminal-auto-scroll">
          <PSwitch v-model="autoScroll" size="sm" />
          <span>自动滚动</span>
        </label>
        <PButton variant="ghost" size="sm" @click="clearLogs">
          <PixelIcon name="trash" size="xs" />
        </PButton>
      </div>
    </div>

    <!-- 日志内容区 -->
    <div
      ref="logContainer"
      class="terminal-body"
      @click="handleLogClick"
      @contextmenu="handleContextMenu"
    >
      <div
        v-for="(log, idx) in logs"
        :key="idx"
        :class="['terminal-log-line', LOG_TYPE_CLASS[log.type] ?? 'log-default']"
      >
        <span class="log-time">[{{ log.timestamp }}]</span>
        <span :class="['log-source', SOURCE_CLASS[log.source] ?? '']">[{{ log.source }}]</span>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span class="log-message" v-html="formatMessage(log.message)" />
      </div>

      <!-- 空状态 -->
      <div v-if="logs.length === 0" class="terminal-empty">
        <PixelIcon name="desktop" size="xl" />
        <span>等待系统日志...</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0c0e14;
  color: #c8ccd4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  overflow: hidden;
  position: relative;
}

/* CRT 扫描线 */
.terminal-crt {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  background:
    linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.08) 50%),
    linear-gradient(90deg, rgba(255, 0, 0, 0.02), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.02));
  background-size:
    100% 3px,
    3px 100%;
}

/* 头部 */
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #141820;
  border-bottom: 2px solid #1e2430;
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.terminal-icon-pulse {
  color: var(--color-sky-hover, #38bdf8);
  animation: termPulse 2s ease-in-out infinite;
}

.terminal-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #e2e8f0;
}

.terminal-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  background: rgba(56, 189, 248, 0.1);
  color: var(--color-sky-hover, #38bdf8);
  border: 1px solid rgba(56, 189, 248, 0.2);
}

.terminal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.terminal-auto-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  cursor: pointer;
}

/* 日志区 */
.terminal-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  position: relative;
  z-index: 5;
  user-select: text;
  cursor: text;
}

.terminal-body::-webkit-scrollbar {
  width: 4px;
}
.terminal-body::-webkit-scrollbar-track {
  background: transparent;
}
.terminal-body::-webkit-scrollbar-thumb {
  background: #2d3748;
}

.terminal-log-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
  font-size: 12px;
  padding: 1px 4px;
  border-left: 2px solid transparent;
  transition: all 0.1s;
}

.terminal-log-line:hover {
  background: rgba(255, 255, 255, 0.03);
  border-left-color: rgba(56, 189, 248, 0.3);
}

.log-time {
  color: #4a5568;
  margin-right: 6px;
  font-size: 11px;
}

.log-source {
  font-weight: 700;
  margin-right: 6px;
  letter-spacing: 0.03em;
}

.src-backend {
  color: #60a5fa;
}
.src-frontend {
  color: #34d399;
}
.src-system {
  color: #c084fc;
}

.log-message {
  flex: 1;
}

/* 日志中的链接 */
.log-link {
  color: #58a6ff;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  border-radius: 2px;
  padding: 0 1px;
  transition: background 0.1s;
}

.log-link:hover {
  background: rgba(88, 166, 255, 0.15);
  color: #79c0ff;
}

.log-link:active {
  color: #a5d6ff;
}

/* 日志类型颜色 */
.log-error {
  color: #f87171;
}
.log-warn {
  color: #fbbf24;
}
.log-info {
  color: #c8ccd4;
}
.log-default {
  color: #94a3b8;
}
.log-system {
  color: #c084fc;
}

/* 空状态 */
.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: #4a5568;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

@keyframes termPulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
</style>
