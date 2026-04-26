/**
 * @file 后端进程管理
 * @description 负责启动/停止 @perocore/backend 子进程
 *              后端是纯 TypeScript (Hono)，直接用 Node/Bun 启动
 *
 * @platform ELECTRON
 * @module electron/main/services/backendProcess
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { logger } from '../utils/logger'
import { isDev, paths } from '../utils/env'
import { appEvents } from '../events'

/** Dev 模式下后端是否由外部脚本管理 (pnpm start) */
let externalBackendRunning = false

let backendProcess: ChildProcess | null = null
const backendLogs: string[] = []
const MAX_LOG_LINES = 2000

/** 向所有渲染窗口推送后端日志 */
function broadcastLog(line: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('backend-log', line)
    }
  })
}

/** 启动后端子进程 */
export async function startBackend(args?: { enableSocialMode?: boolean }): Promise<void> {
  if (backendProcess) {
    logger.warn('Backend', '后端进程已在运行，跳过启动')
    return
  }

  // 确定后端入口路径
  let entryPoint: string
  if (isDev) {
    // 开发模式: 直接运行 TS (通过 tsx 或 ts-node)
    entryPoint = path.resolve(__dirname, '../../packages/backend/src/app.ts')
  } else {
    // 生产模式: 运行编译后的 JS
    entryPoint = path.join(paths.resources, 'backend', 'dist', 'app.js')
  }

  logger.info('Backend', `后端入口: ${entryPoint}`)

  // 环境变量
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PERO_PORT: '9120',
    PERO_DATA_DIR: paths.data,
    PERO_DATABASE_PATH: path.join(paths.data, 'perocore.db'),
    PERO_RUNTIME: 'electron',
    NODE_ENV: isDev ? 'development' : 'production',
  }

  if (args?.enableSocialMode) {
    env.PERO_SOCIAL_MODE = '1'
  }

  // 启动方式
  // @platform WINDOWS — npx 在 Windows 上需要 shell:true 或使用 npx.cmd
  const runtime = isDev ? 'npx' : process.execPath
  const runtimeArgs = isDev ? ['tsx', entryPoint] : [entryPoint]
  const useShell = isDev && process.platform === 'win32'

  try {
    backendProcess = spawn(runtime, runtimeArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    })

    logger.info('Backend', `后端进程已启动 (PID: ${backendProcess.pid})`)

    // stdout 日志
    backendProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        backendLogs.push(line)
        if (backendLogs.length > MAX_LOG_LINES) {
          backendLogs.shift()
        }
        broadcastLog(line)
      }
    })

    // stderr 日志
    backendProcess.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        backendLogs.push(`[STDERR] ${line}`)
        if (backendLogs.length > MAX_LOG_LINES) {
          backendLogs.shift()
        }
        broadcastLog(line)
      }
    })

    // 进程退出
    backendProcess.on('exit', (code, signal) => {
      logger.info('Backend', `后端进程退出: code=${code}, signal=${signal}`)
      backendProcess = null

      if (code !== 0 && code !== null) {
        if (isDev) {
          // Dev 模式: 后端由 pnpm start 独立管理，Electron spawn 退出是预期行为
          logger.info('Backend', `Dev 模式: 后端进程退出 (code: ${code})，外部后端可能已在运行`)
          externalBackendRunning = true
        } else {
          logger.error('Backend', `后端非正常退出 (code: ${code})，触发崩溃事件`)
          appEvents.emit('backend-crashed')
        }
      }
    })

    backendProcess.on('error', (err) => {
      if (isDev) {
        // Dev 模式: npx/tsx 启动失败是预期的 (外部后端已在运行)
        logger.info('Backend', `Dev 模式: 后端进程启动跳过 (${err.message})，使用外部后端`)
        externalBackendRunning = true
      } else {
        logger.error('Backend', `后端进程启动失败: ${err.message}`)
        appEvents.emit('backend-crashed')
      }
      backendProcess = null
    })
  } catch (e: unknown) {
    logger.error('Backend', `启动后端失败: ${e}`)
    throw e
  }
}

/** 停止后端子进程 */
export async function stopBackend(): Promise<void> {
  if (!backendProcess) return

  logger.info('Backend', '正在停止后端进程...')

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      // 超时强杀
      logger.warn('Backend', '后端进程停止超时，强制终止')
      backendProcess?.kill('SIGKILL')
      backendProcess = null
      resolve()
    }, 5000)

    backendProcess!.on('exit', () => {
      clearTimeout(timeout)
      backendProcess = null
      logger.info('Backend', '后端进程已停止')
      resolve()
    })

    // 优雅关闭
    backendProcess!.kill('SIGTERM')
  })
}

/** 获取后端日志历史 */
export function getBackendLogs(): string[] {
  return [...backendLogs]
}
