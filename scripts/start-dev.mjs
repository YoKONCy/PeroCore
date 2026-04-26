/**
 * 一键启动脚本 — 并行启动后端 + Electron (含前端)
 *
 * 特性:
 * - 后端就绪后再启动 Electron（监听 "已就绪" 信号）
 * - 任一进程退出时联动杀掉另一个（防止幽灵进程）
 * - Windows 下使用 taskkill /T 杀整棵进程树
 * - Ctrl+C 优雅退出
 *
 * 用法: node scripts/start-dev.mjs
 * 或:   pnpm start
 */

import { spawn, execSync } from 'node:child_process'

const isWin = process.platform === 'win32'

// 颜色代码
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function prefix(name, color, data) {
  const lines = data.toString().split('\n').filter(Boolean)
  for (const line of lines) {
    process.stdout.write(`${color}[${name}]${RESET} ${line}\n`)
  }
}

/** 杀掉进程树（Windows 用 taskkill /T，其他用 SIGTERM） */
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return
  try {
    if (isWin) {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {
    // 进程可能已经退出
  }
}

let backend = null
let electron = null
let isShuttingDown = false

function shutdown(exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`\n${DIM}正在清理所有进程...${RESET}`)
  killTree(electron)
  killTree(backend)

  // 给一点时间让进程退出
  setTimeout(() => process.exit(exitCode), 500)
}

// ── 启动后端 ──
backend = spawn('pnpm', ['dev'], {
  cwd: process.cwd(),
  shell: isWin,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_OPTIONS: '--no-warnings=DEP0040' },
})
backend.stdout.on('data', (d) => prefix('backend', BLUE, d))
backend.stderr.on('data', (d) => prefix('backend', BLUE, d))
backend.on('exit', (code) => {
  console.log(`${DIM}[backend] 进程退出 (code: ${code})${RESET}`)
  if (!isShuttingDown) shutdown(code ?? 1)
})

// ── 等后端就绪后启动 Electron ──
let electronStarted = false

function tryStartElectron() {
  if (electronStarted || isShuttingDown) return
  electronStarted = true

  console.log(`\n${MAGENTA}[electron]${RESET} 后端已就绪，正在启动 Electron...\n`)

  electron = spawn('pnpm', ['dev:electron'], {
    cwd: process.cwd(),
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--no-warnings=DEP0040' },
  })
  electron.stdout.on('data', (d) => prefix('electron', MAGENTA, d))
  electron.stderr.on('data', (d) => prefix('electron', MAGENTA, d))
  electron.on('exit', (code) => {
    console.log(`${DIM}[electron] 进程退出 (code: ${code})${RESET}`)
    if (!isShuttingDown) shutdown(code ?? 0)
  })
}

// 监听后端 stdout，等 "已就绪" 信号
const outputChunks = []
backend.stdout.on('data', (data) => {
  outputChunks.push(data.toString())
  if (outputChunks.join('').includes('已就绪')) {
    tryStartElectron()
  }
})

// 超时兜底: 15 秒后强制启动 Electron
setTimeout(() => {
  if (!electronStarted) {
    console.log(`\n${MAGENTA}[electron]${RESET} 等待后端超时，强制启动 Electron...\n`)
    tryStartElectron()
  }
}, 15000)

// ── Ctrl+C / 信号处理 ──
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
// Windows: 控制台关闭事件
if (isWin) {
  process.on('SIGHUP', () => shutdown(0))
}
