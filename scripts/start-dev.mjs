/**
 * 一键启动脚本 — 启动 Daemon、子应用界面与 Electron
 *
 * 特性:
 * - 后台与 Pictoria 界面就绪后再启动 Electron
 * - 任一进程退出时清理其余进程（防止幽灵进程）
 * - Windows 下使用 taskkill /T 杀整棵进程树
 * - Ctrl+C 优雅退出
 *
 * 用法: node scripts/start-dev.mjs
 * 或:   pnpm start
 */

import { spawn, execSync } from 'node:child_process'
import electronEnvironment from './electron-environment.cjs'

const { electronProcessEnvironment } = electronEnvironment

const isWin = process.platform === 'win32'
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error('无法定位pnpm CLI，请通过pnpm start启动开发环境')
const spawnPnpm = (args, options) => spawn(process.execPath, [pnpmCli, ...args], options)

// 颜色代码
const CYAN = '\x1b[36m'
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

let daemon = null
let electron = null
let arcaClient = null
let pictoriaClient = null
let isShuttingDown = false
let daemonReady = false
let pictoriaReady = false

function shutdown(exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`\n${DIM}正在清理所有进程...${RESET}`)
  killTree(electron)
  killTree(arcaClient)
  killTree(pictoriaClient)
  killTree(daemon)

  // 给一点时间让进程退出
  setTimeout(() => process.exit(exitCode), 500)
}

// ── 启动Arca Client开发服务 ──
arcaClient = spawnPnpm(['--filter', '@infos/arca', 'dev:client'], {
  cwd: process.cwd(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_OPTIONS: '--no-warnings=DEP0040' },
})
arcaClient.stdout.on('data', (d) => prefix('arca-ui', MAGENTA, d))
arcaClient.stderr.on('data', (d) => prefix('arca-ui', MAGENTA, d))
arcaClient.on('exit', (code) => {
  console.log(`${DIM}[arca-ui] 进程退出 (code: ${code})${RESET}`)
  if (!isShuttingDown) shutdown(code ?? 1)
})

// ── 启动 Pictoria Client 开发服务 ──
pictoriaClient = spawnPnpm(['--filter', '@infos/pictoria', 'dev:client'], {
  cwd: process.cwd(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_OPTIONS: '--no-warnings=DEP0040' },
})
let pictoriaOutput = ''
pictoriaClient.stdout.on('data', (data) => {
  prefix('pictoria-ui', MAGENTA, data)
  pictoriaOutput = (pictoriaOutput + data.toString()).slice(-8000)
  if (pictoriaOutput.replace(/\x1b\[[0-9;]*m/g, '').includes('http://127.0.0.1:7363/')) {
    pictoriaReady = true
    tryStartElectron()
  }
})
pictoriaClient.stderr.on('data', (data) => prefix('pictoria-ui', MAGENTA, data))
pictoriaClient.on('error', (error) => {
  console.error(`${MAGENTA}[pictoria-ui]${RESET} 界面服务启动失败：${error.message}`)
  shutdown(1)
})
pictoriaClient.on('exit', (code) => {
  console.log(`${DIM}[pictoria-ui] 界面服务已退出 (code: ${code})${RESET}`)
  if (!isShuttingDown) shutdown(code || 1)
})

// ── 启动Daemon ──
daemon = spawnPnpm(['dev:daemon'], {
  cwd: process.cwd(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_OPTIONS: '--no-warnings=DEP0040' },
})
daemon.stdout.on('data', (d) => prefix('daemon', CYAN, d))
daemon.stderr.on('data', (d) => prefix('daemon', CYAN, d))
daemon.on('exit', (code) => {
  console.log(`${DIM}[daemon] 进程退出 (code: ${code})${RESET}`)
  if (!isShuttingDown) shutdown(code ?? 1)
})

// ── 等 Daemon 与 Pictoria 界面就绪后启动 Electron ──
let electronStarted = false

function tryStartElectron() {
  if (electronStarted || isShuttingDown || !daemonReady || !pictoriaReady) return
  electronStarted = true

  console.log(`\n${MAGENTA}[electron]${RESET} 后台与子应用界面已就绪，正在启动 Electron...\n`)

  electron = spawnPnpm(['dev:electron'], {
    cwd: process.cwd(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: electronProcessEnvironment(process.env),
  })
  electron.stdout.on('data', (d) => prefix('electron', MAGENTA, d))
  electron.stderr.on('data', (d) => prefix('electron', MAGENTA, d))
  electron.on('exit', (code) => {
    console.log(`${DIM}[electron] 进程退出 (code: ${code})${RESET}`)
    if (!isShuttingDown) shutdown(code ?? 0)
  })
}

// 监听Daemon stdout，等待业务端口和能力通道均就绪
const outputChunks = []
daemon.stdout.on('data', (data) => {
  outputChunks.push(data.toString())
  const output = outputChunks.join('')
  if (output.includes('业务 HTTP 已就绪') && output.includes('CapabilityBridge 已启动')) {
    daemonReady = true
    tryStartElectron()
  }
})

// 超时兜底：30秒后仍不启动Electron，直接结束并保留Daemon日志
setTimeout(() => {
  if (!electronStarted && !isShuttingDown) {
    console.error(`\n${MAGENTA}[electron]${RESET} 开发环境启动超时：${!daemonReady ? '后台 HTTP 与能力通道尚未就绪' : 'Pictoria 界面尚未监听 7363 端口'}。`)
    shutdown(1)
  }
}, 30000)

// ── Ctrl+C / 信号处理 ──
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
// Windows: 控制台关闭事件
if (isWin) {
  process.on('SIGHUP', () => shutdown(0))
}
