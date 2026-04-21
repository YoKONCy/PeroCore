<script setup lang="ts">
/**
 * SocialAdapterTerminal — 社交适配器交互终端
 *
 * 平台无关的社交适配器管理终端 (Layer 1/2 适配)。
 * 社交适配器终端，支持任意适配器。
 *
 * 功能:
 * - 适配器连接状态面板 (通过 /api/social/status)
 * - Electron 模式: 进程日志 IPC (napcat-log / adapter-log)
 * - Browser 模式: 通过 Gateway WebSocket 获取事件流
 * - 命令输入行 (调试用)
 *
 * @module packages/frontend/src/components/terminal/SocialAdapterTerminal
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { PixelIcon, PButton } from '../pixel'
import { invoke, listen } from '../../utils/ipcAdapter'
import { socialApi } from '../../api/modules/socialApi'
import type { AdapterStatus as ApiAdapterStatus } from '../../api/modules/socialApi'

// ── 类型定义 ──

interface AdapterLogEntry {
  id: number
  time: string
  content: string
  level: 'info' | 'warn' | 'error' | 'debug'
}

interface AdapterStatus {
  platform: string
  connected: boolean
  displayName: string
  error?: string
}

interface DownloadProgress {
  active: boolean
  percent: number
  status: string
  error: boolean
  completed: boolean
}

// ── 状态 ──

const logs = ref<AdapterLogEntry[]>([])
const adapters = ref<AdapterStatus[]>([])
const inputValue = ref('')
const logContainer = ref<HTMLDivElement | null>(null)
const isLoading = ref(false)
const downloadProgress = ref<DownloadProgress>({
  active: false,
  percent: 0,
  status: '',
  error: false,
  completed: false,
})

let unlistenLog: (() => void) | null = null
let unlistenProgress: (() => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

// ── ANSI 颜色映射 ──

const ANSI_COLORS: Record<number, string> = {
  0: 'reset',
  30: '#64748b',
  31: '#f87171',
  32: '#34d399',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#22d3ee',
  37: '#e2e8f0',
  90: '#475569',
}

function ansiToHtml(text: string): string {
  if (!text) return ''
  let result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\[(\d+)m/g, (_match, code: string) => {
    const num = parseInt(code, 10)
    const color = ANSI_COLORS[num]
    if (color === 'reset') return '</span>'
    if (color) return `<span style="color: ${color};">`
    return ''
  })
  return result
}

// ── 工具函数 ──

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

function parseLogLevel(content: string): 'info' | 'warn' | 'error' | 'debug' {
  if (content.includes('[ERROR]') || content.includes('[错误]')) return 'error'
  if (content.includes('[WARN]') || content.includes('[警告]')) return 'warn'
  if (content.includes('[DEBUG]')) return 'debug'
  return 'info'
}

/** 通过 socialApi 获取适配器状态 */
async function fetchAdapterStatus(): Promise<void> {
  try {
    const res = await socialApi.getStatus()
    if (res.data?.adapters) {
      adapters.value = res.data.adapters.map((a: ApiAdapterStatus) => ({
        ...a,
        displayName: getAdapterDisplayName(a.platform),
      }))
    }
  } catch {
    // API 不可用时静默 (可能在 Electron 模式)
  }
}

function getAdapterDisplayName(platform: string): string {
  const names: Record<string, string> = {
    qq: 'QQ (NapCat)',
    discord: 'Discord',
    telegram: 'Telegram',
  }
  return names[platform] ?? platform
}

async function sendCommand(): Promise<void> {
  const cmd = inputValue.value.trim()
  if (!cmd) return

  try {
    // 先尝试 Electron IPC, 后备 socialApi
    await invoke('send-napcat-command', { command: cmd }).catch(async () => {
      await socialApi.send(cmd)
    })

    logs.value.push({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      content: `> ${cmd}`,
      level: 'info',
    })
    inputValue.value = ''
  } catch (e) {
    logs.value.push({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      content: `[Error] 发送指令失败: ${e}`,
      level: 'error',
    })
  }
}

// 自动滚动
watch(logs, () => scrollToBottom(), { deep: true })

// ── 生命周期 ──

onMounted(async () => {
  isLoading.value = true

  try {
    // 1. 获取适配器状态
    await fetchAdapterStatus()

    // 2. 拉取历史日志 (Electron IPC)
    try {
      const history = (await invoke('get-napcat-logs')) as string[] | null
      if (Array.isArray(history) && history.length > 0) {
        logs.value = history.map((line) => ({
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString(),
          content: line,
          level: parseLogLevel(line),
        }))
      }
    } catch {
      // 非 Electron 环境
      logs.value.push({
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        content: '[系统] 社交适配器终端已就绪 (API 模式)',
        level: 'info',
      })
    }

    // 3. 监听新日志 (Electron IPC + Gateway)
    try {
      unlistenLog = await listen('napcat-log', (payload) => {
        const logLine =
          typeof payload === 'string'
            ? payload
            : ((payload as { payload?: string })?.payload ?? String(payload))

        logs.value.push({
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString(),
          content: logLine,
          level: parseLogLevel(logLine),
        })

        if (logs.value.length > 500) logs.value.shift()
      })
    } catch {
      // 非 Electron 环境
    }

    // 4. 监听下载进度 (Electron IPC)
    try {
      unlistenProgress = await listen('napcat-download-progress', (payload) => {
        const p = payload as {
          percent?: number
          status?: string
          error?: boolean
          completed?: boolean
        }
        downloadProgress.value = {
          active: true,
          percent: p.percent ?? 0,
          status: p.status ?? '',
          error: p.error ?? false,
          completed: p.completed ?? false,
        }
        if (p.completed || p.error) {
          setTimeout(() => {
            downloadProgress.value.active = false
          }, 5000)
        }
      })
    } catch {
      // 非 Electron 环境
    }

    // 5. 定时轮询适配器状态
    pollTimer = setInterval(fetchAdapterStatus, 30000)
  } catch (e) {
    logs.value.push({
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      content: `[系统] 初始化失败: ${e}`,
      level: 'error',
    })
  } finally {
    isLoading.value = false
  }
})

onUnmounted(() => {
  unlistenLog?.()
  unlistenProgress?.()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="sa-terminal">
    <!-- CRT 扫描线 -->
    <div class="sa-crt" />

    <!-- 头部 -->
    <div class="sa-header">
      <div class="sa-header-left">
        <div class="sa-icon-pulse">
          <PixelIcon name="terminal" size="sm" />
        </div>
        <span class="sa-title">社交适配器终端</span>
        <span class="sa-badge">SOCIAL</span>
      </div>
      <div class="sa-header-right">
        <!-- 适配器状态指示 -->
        <div v-for="adapter in adapters" :key="adapter.platform" class="sa-adapter-chip">
          <span :class="['sa-dot', adapter.connected ? 'sa-dot-on' : 'sa-dot-off']" />
          <span class="sa-adapter-name">{{ adapter.displayName }}</span>
        </div>
        <PButton variant="ghost" size="sm" @click="fetchAdapterStatus">
          <PixelIcon name="refresh" size="xs" />
        </PButton>
        <PButton variant="ghost" size="sm" @click="clearLogs">
          <PixelIcon name="trash" size="xs" />
        </PButton>
      </div>
    </div>

    <!-- 日志区 -->
    <div ref="logContainer" class="sa-body">
      <!-- 下载进度条 -->
      <div v-if="downloadProgress.active" class="sa-progress">
        <div class="sa-progress-info">
          <span class="sa-progress-label">
            <PixelIcon name="download" size="xs" />
            {{ downloadProgress.status }}
          </span>
          <span class="sa-progress-pct">{{ downloadProgress.percent }}%</span>
        </div>
        <div class="sa-progress-track">
          <div
            :class="['sa-progress-bar', { 'sa-progress-error': downloadProgress.error }]"
            :style="{ width: `${downloadProgress.percent}%` }"
          />
        </div>
      </div>

      <!-- 日志行 -->
      <div v-for="log in logs" :key="log.id" :class="['sa-log-line', `sa-log-${log.level}`]">
        <span class="sa-time">[{{ log.time }}]</span>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span class="sa-content" v-html="ansiToHtml(log.content)" />
      </div>

      <!-- 空状态 -->
      <div v-if="logs.length === 0 && !isLoading" class="sa-empty">
        <PixelIcon name="terminal" size="xl" />
        <span>等待社交适配器输出...</span>
        <span class="sa-empty-hint">适配器连接后日志将自动显示</span>
      </div>
    </div>

    <!-- 命令输入行 -->
    <div class="sa-input-area">
      <div class="sa-input-box">
        <PixelIcon name="chevron-right" size="xs" class="sa-input-prefix" />
        <input
          v-model="inputValue"
          class="sa-input"
          placeholder="输入调试指令并回车..."
          spellcheck="false"
          @keyup.enter="sendCommand"
        />
        <span v-if="inputValue" class="sa-input-hint">PRESS ENTER</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 终端专用暗色令牌 (基于 tokens.css 体系扩展) ── */
.sa-terminal {
  --sa-bg: #0c0e14;
  --sa-bg-header: #141820;
  --sa-bg-hover: rgba(255, 255, 255, 0.03);
  --sa-border: #1e2430;
  --sa-border-subtle: #2d3748;
  --sa-accent: #a78bfa;
  --sa-accent-dim: rgba(167, 139, 250, 0.4);
  --sa-accent-bg: rgba(167, 139, 250, 0.1);
  --sa-text: #c8ccd4;
  --sa-text-bright: var(--text-primary, #e2e8f0);
  --sa-text-dim: var(--text-muted, #4a5568);
  --sa-text-subtle: #374151;
  --sa-success: var(--emerald-face, #34d399);
  --sa-error: var(--color-red-400, #f87171);
  --sa-warn: var(--amber-face, #fbbf24);
  --sa-info: var(--color-sky-hover, #38bdf8);

  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sa-bg);
  color: var(--sa-text);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  overflow: hidden;
  position: relative;
}

.sa-crt {
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
.sa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--sa-bg-header);
  border-bottom: var(--pixel-border-width) solid var(--sa-border);
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}
.sa-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.sa-icon-pulse {
  color: var(--sa-accent);
  animation: saPulse 2s ease-in-out infinite;
}
.sa-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--sa-text-bright);
}
.sa-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  background: var(--sa-accent-bg);
  color: var(--sa-accent);
  border: 1px solid rgba(167, 139, 250, 0.2);
}
.sa-header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* 适配器状态指示 */
.sa-adapter-chip {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 2px var(--spacing-sm);
  background: var(--sa-bg-hover);
  border: 1px solid var(--sa-border-subtle);
  font-size: 10px;
  font-weight: 700;
}
.sa-dot {
  width: 6px;
  height: 6px;
  border-radius: 0;
  flex-shrink: 0;
}
.sa-dot-on {
  background: var(--sa-success);
  animation: saPulse 2s infinite;
}
.sa-dot-off {
  background: var(--sa-text-dim);
}
.sa-adapter-name {
  color: var(--text-secondary, #94a3b8);
}

/* 日志区 */
.sa-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px var(--spacing-md);
  position: relative;
  z-index: 0;
}
.sa-body::-webkit-scrollbar {
  width: 4px;
}
.sa-body::-webkit-scrollbar-track {
  background: transparent;
}
.sa-body::-webkit-scrollbar-thumb {
  background: var(--sa-border-subtle);
}

/* 进度条 */
.sa-progress {
  margin-bottom: 12px;
  background: #1a1e2a;
  padding: 10px 12px;
  border: var(--pixel-border-width) solid var(--sa-border-subtle);
}
.sa-progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 6px;
}
.sa-progress-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--sa-accent);
}
.sa-progress-pct {
  color: var(--sa-info);
}
.sa-progress-track {
  width: 100%;
  height: 8px;
  background: var(--sa-bg);
  border: 1px solid var(--sa-border-subtle);
  padding: 1px;
}
.sa-progress-bar {
  height: 100%;
  background: var(--sa-accent);
  transition: width var(--transition-normal);
}
.sa-progress-error {
  background: var(--color-danger, #ef4444);
}

/* 日志行 */
.sa-log-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
  font-size: 12px;
  padding: 1px var(--spacing-xs);
}
.sa-log-line:hover {
  background: var(--sa-bg-hover);
}
.sa-log-error {
  color: var(--sa-error);
}
.sa-log-warn {
  color: var(--sa-warn);
}
.sa-log-debug {
  opacity: 0.6;
}
.sa-time {
  color: var(--sa-text-dim);
  margin-right: 6px;
  font-size: 11px;
}
.sa-content {
  flex: 1;
}

/* 空状态 */
.sa-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--sa-text-dim);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
.sa-empty-hint {
  font-size: 10px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--sa-text-subtle);
}

/* 输入区 */
.sa-input-area {
  padding: var(--spacing-sm) 12px;
  background: var(--sa-bg-header);
  border-top: var(--pixel-border-width) solid var(--sa-border);
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}
.sa-input-box {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: var(--sa-bg);
  border: var(--pixel-border-width) solid var(--sa-border);
  padding: 6px 10px;
  transition: border-color 0.15s;
}
.sa-input-box:focus-within {
  border-color: var(--sa-accent-dim);
}
.sa-input-prefix {
  color: var(--sa-accent);
  flex-shrink: 0;
}
.sa-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--sa-accent);
  font-family: inherit;
  font-size: 12px;
}
.sa-input::placeholder {
  color: var(--sa-text-dim);
}
.sa-input-hint {
  font-size: 9px;
  color: var(--sa-accent-dim);
  font-weight: 700;
  animation: saPulse 1.5s ease-in-out infinite;
}

@keyframes saPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>
