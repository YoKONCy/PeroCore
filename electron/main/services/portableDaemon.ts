/**
 * 内置 Daemon — 打包发行版统一运行时拉起
 *
 * 所有打包发行形态（标准安装版、Steam 版、便携版）都随包携带同一份 Daemon：
 *   1. 探测业务端口 :9120，已运行则复用；
 *   2. 未运行则用 Electron 自带 Node 运行时执行 resources/daemon/daemon.mjs；
 *   3. 显式注入 PERO_DATA_DIR / PERO_APP_ROOT，确保 Electron 与后端共享路径；
 *   4. Steam 版额外注入 Steam API 返回的全部 Workshop 安装目录；
 *   5. 开发模式继续使用独立 dev:daemon，不由 Electron 重复拉起。
 *
 * @module electron/main/services/portableDaemon
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import { app } from 'electron'
import { isDev, paths } from '../utils/env'
import { getWorkshopInstallations } from './steam'
import { logger } from '../utils/logger'

/** 业务 HTTP 端口（与 backend SERVER_PORT 一致） */
const BUSINESS_PORT = Number(process.env.PERO_PORT ?? 9120)

/** 就绪轮询间隔（ms） */
const READY_POLL_INTERVAL_MS = 500

/** 就绪超时（ms） */
const READY_TIMEOUT_MS = 30_000

/** 内置 Daemon bundle 在 resources 下的相对路径 */
const DAEMON_BUNDLE_RELPATH = path.join('daemon', 'daemon.mjs')

/** 由本模块拉起的 Daemon 子进程（用于退出时回收） */
let daemonChild: ChildProcess | null = null

export interface DaemonStartupStatus {
  ready: boolean
  running: boolean
  attempted: boolean
  logPath: string
  error?: string
  logTail?: string
}

let startupStatus: DaemonStartupStatus = {
  ready: false,
  running: false,
  attempted: false,
  logPath: '',
}

/** 返回启动状态与日志尾部，供 Launcher 直接展示真实错误。 */
export function getPortableDaemonStatus(): DaemonStartupStatus {
  const status = { ...startupStatus }
  if (status.logPath && fs.existsSync(status.logPath)) {
    try {
      const content = fs.readFileSync(status.logPath, 'utf8')
      status.logTail = content.slice(-4000)
    } catch {
      // 日志可能正被子进程占用，保留已有状态。
    }
  }
  return status
}

/** 是否已尝试拉起（避免重复） */
let ensureStarted = false

/** 探测 TCP 端口是否可连接 */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** 轮询等待业务端口就绪 */
async function waitForBusinessReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probePort(BUSINESS_PORT)) {
      startupStatus = { ...startupStatus, ready: true, running: true }
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS))
  }
  return false
}

/** 回收本模块拉起的 Daemon 子进程 */
export function stopPortableDaemon(): void {
  if (!daemonChild) return
  logger.info('PortableDaemon', '正在停止本模块拉起的 Daemon...')
  daemonChild.kill()
  daemonChild = null
}

/**
 * 确保 Daemon 可用
 *
 * 便携模式：探测 :9120，未就绪则拉起内置 Daemon（仅一次）。
 * 非便携模式：仅做有限等待，Daemon 由外部管理，未就绪不阻塞启动
 * （capabilityProvider 自带重连兜底）。
 *
 * @returns 是否成功等待到 Daemon 就绪
 */
export async function ensurePortableDaemon(): Promise<boolean> {
  // 已在运行（或外部 Daemon）：直接确认就绪
  if (await probePort(BUSINESS_PORT)) {
    startupStatus = { ...startupStatus, ready: true, running: true }
    return true
  }

  // 开发模式继续使用独立 dev:daemon，避免热开发时 Electron 重复拉起打包 bundle。
  if (isDev) {
    logger.info(
      'PortableDaemon',
      `开发模式，跳过内置 Daemon 拉起（:${BUSINESS_PORT} 未就绪，请运行 dev:daemon）`,
    )
    return false
  }

  // 打包发行版：拉起内置 Daemon（幂等，只尝试一次）
  if (ensureStarted) {
    logger.info('PortableDaemon', '已尝试过拉起内置 Daemon，等待其就绪...')
    return waitForBusinessReady(READY_TIMEOUT_MS)
  }
  ensureStarted = true
  startupStatus = { ...startupStatus, attempted: true }

  const bundlePath = path.join(process.resourcesPath, DAEMON_BUNDLE_RELPATH)
  if (!fs.existsSync(bundlePath)) {
    const error = `未找到内置 Daemon bundle: ${bundlePath}`
    startupStatus = { ...startupStatus, error }
    logger.warn('PortableDaemon', `${error}，桌面能力将不可用`)
    return false
  }

  // Electron 与后端共享同一个业务数据目录；标准/Steam 位于 userData/data，便携位于 exe/data。
  const dataDir = paths.data
  // 后端运行时根 = resources/backend（内置 prompts/agents/presets 均在此）。
  const backendRoot = path.join(process.resourcesPath, 'backend')
  // Steam API 返回真实安装目录，兼容多磁盘和跨平台；非 Steam 版自然为空。
  const workshopDirs = getWorkshopInstallations().map((item) => item.folder)

  logger.info('PortableDaemon', `打包版拉起内置 Daemon: ${bundlePath}`)
  logger.info('PortableDaemon', `  数据目录: ${dataDir}`)
  logger.info('PortableDaemon', `  后端根:   ${backendRoot}`)
  logger.info('PortableDaemon', `  Workshop: ${workshopDirs.length} 个订阅目录`)

  // Daemon 在窗口隐藏模式下运行，必须持久化 stdout/stderr，否则启动早期异常会完全丢失。
  fs.mkdirSync(paths.logs, { recursive: true })
  const daemonLogPath = path.join(paths.logs, 'daemon-bootstrap.log')
  startupStatus = { ...startupStatus, logPath: daemonLogPath, running: true, error: undefined }
  let daemonLogFd: number | null = null
  try {
    daemonLogFd = fs.openSync(daemonLogPath, 'a')
    fs.writeSync(daemonLogFd, `\n[${new Date().toISOString()}] 启动内置 Daemon\n`)
    daemonChild = spawn(process.execPath, [bundlePath], {
      env: {
        ...process.env,
        // 用 exe 自带的 Node 运行时执行 daemon（无需额外安装 node）
        ELECTRON_RUN_AS_NODE: '1',
        // 数据目录一锤定音，确保数据库、Agent、Workspace、扩展和 Skills 全部同根。
        PERO_DATA_DIR: dataDir,
        // 后端根目录（内置角色/提示词/预设资源位置）。
        PERO_APP_ROOT: backendRoot,
        INFOS_RESOURCES_ROOT: process.resourcesPath,
        // 多个 Workshop item 根以 JSON 传递，避免 Windows 路径分隔与盘符歧义。
        PERO_WORKSHOP_DIRS: JSON.stringify(workshopDirs),
      },
      cwd: path.dirname(app.getPath('exe')),
      stdio: ['ignore', daemonLogFd, daemonLogFd],
      windowsHide: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    startupStatus = { ...startupStatus, running: false, error: `进程启动失败: ${message}` }
    logger.error('PortableDaemon', `内置 Daemon 启动失败: ${message}`)
    return false
  } finally {
    // spawn 已为子进程复制日志句柄，父进程必须立即释放自己的描述符。
    if (daemonLogFd !== null) fs.closeSync(daemonLogFd)
  }

  daemonChild.on('error', (err) => {
    startupStatus = { ...startupStatus, running: false, error: `进程启动失败: ${err.message}` }
    logger.error('PortableDaemon', `内置 Daemon 启动失败: ${err.message}`)
  })
  daemonChild.on('exit', (code, signal) => {
    startupStatus = {
      ...startupStatus,
      running: false,
      error: startupStatus.ready ? undefined : `Daemon 提前退出：code=${code}, signal=${signal}`,
    }
    logger.warn(
      'PortableDaemon',
      `内置 Daemon 退出: code=${code}, signal=${signal}；启动日志: ${daemonLogPath}`,
    )
    daemonChild = null
  })

  // 等待业务端口就绪（最多 30s），失败不阻塞主流程（capabilityProvider 重连兜底）
  const ready = await waitForBusinessReady(READY_TIMEOUT_MS)
  if (ready) {
    startupStatus = { ...startupStatus, ready: true, running: true, error: undefined }
    logger.info('PortableDaemon', `内置 Daemon 已就绪 → :${BUSINESS_PORT}`)
  } else {
    startupStatus = {
      ...startupStatus,
      ready: false,
      error: startupStatus.error ?? `Daemon 启动超时（:${BUSINESS_PORT}）`,
    }
    logger.warn('PortableDaemon', `内置 Daemon 启动超时（:${BUSINESS_PORT}），桌面能力可能暂不可用`)
  }
  return ready
}
