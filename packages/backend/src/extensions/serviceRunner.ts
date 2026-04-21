/**
 * Service Runner — Service 扩展子进程管理
 *
 * 负责 Layer 2 (子进程 IPC) 的生命周期管理。
 * - 启动子进程 (Node/Bun)
 * - 建立 StdioTransport 双向通信
 * - 健康检查 + 自动重启
 * - 优雅关闭
 *
 * @module packages/backend/src/extensions/serviceRunner
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { createLogger } from '../lib/logger'
import { StdioTransport } from './transports/stdioTransport'
import type { ServiceTransport } from './transports/transport'
import type { ExtensionManifest } from './types'

const logger = createLogger('ServiceRunner')

/** Service 运行状态 */
export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'

export class ServiceRunner {
  private process: ChildProcess | null = null
  private transport: ServiceTransport | null = null
  private status: ServiceStatus = 'stopped'
  private restartCount = 0

  /** 最大自动重启次数 */
  private maxRestarts = 3

  /** 反向通知处理器 (Service → Core) */
  private notificationHandler?: (method: string, params: unknown) => void

  constructor(
    private manifest: ExtensionManifest,
    private extensionPath: string,
  ) {}

  /**
   * 启动 Service 子进程
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      logger.warn(`Service ${this.manifest.id} 已在运行`)
      return
    }

    this.status = 'starting'
    const entryFile = path.join(this.extensionPath, this.manifest.entry)

    try {
      // 使用 Node 启动子进程
      this.process = spawn(process.execPath, [entryFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PERO_EXTENSION_MODE: 'service',
          PERO_EXTENSION_ID: this.manifest.id,
        },
        cwd: this.extensionPath,
      })

      // 监听 stderr (扩展自身的日志)
      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) logger.debug(`[${this.manifest.id}:stderr] ${text}`)
      })

      // 监听退出
      this.process.on('exit', (code, signal) => {
        logger.info(`Service ${this.manifest.id} 退出`, { code, signal })
        this.status = 'stopped'
        this.transport = null

        // 自动重启 (非正常退出 + 未超过重启上限)
        if (code !== 0 && this.restartCount < this.maxRestarts) {
          this.restartCount++
          const delay = Math.min(1000 * Math.pow(2, this.restartCount), 30_000)
          logger.warn(
            `Service ${this.manifest.id} 将在 ${delay}ms 后重启 (${this.restartCount}/${this.maxRestarts})`,
          )
          setTimeout(() => this.start().catch(() => {}), delay)
        }
      })

      // 建立 Stdio Transport
      this.transport = new StdioTransport(this.process.stdin!, this.process.stdout!)

      // 注册反向通知处理器
      if (this.notificationHandler) {
        this.transport.onNotification(this.notificationHandler)
      }

      // 调用 Service 的 onStart 生命周期
      await this.call('__lifecycle__', { action: 'start' })

      this.status = 'running'
      this.restartCount = 0 // 启动成功重置重启计数
      logger.info(`Service ${this.manifest.id} 已启动 (PID: ${this.process.pid})`)
    } catch (err) {
      this.status = 'error'
      logger.error(`Service ${this.manifest.id} 启动失败`, {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * 调用 Service 方法
   */
  async call(method: string, params: unknown): Promise<unknown> {
    if (!this.transport?.isAlive()) {
      throw new Error(`Service ${this.manifest.id} 未运行`)
    }
    return this.transport.call(method, params)
  }

  /**
   * 注册反向通知回调
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler
    if (this.transport) {
      this.transport.onNotification(handler)
    }
  }

  /**
   * 优雅停止
   */
  async stop(): Promise<void> {
    if (!this.process) return

    // 先尝试通知 Service 停止
    try {
      await this.call('__lifecycle__', { action: 'stop' })
    } catch {
      // 忽略
    }

    // 等待 3 秒优雅退出，否则强制 kill
    const killed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.process?.kill('SIGKILL')
        resolve(true)
      }, 3_000)

      this.process?.on('exit', () => {
        clearTimeout(timer)
        resolve(false)
      })

      this.process?.kill('SIGTERM')
    })

    if (killed) {
      logger.warn(`Service ${this.manifest.id} 强制终止`)
    }

    this.process = null
    this.transport = null
    this.status = 'stopped'
    this.restartCount = this.maxRestarts // 阻止自动重启
    logger.info(`Service ${this.manifest.id} 已停止`)
  }

  /**
   * 获取运行状态
   */
  getStatus(): ServiceStatus {
    return this.status
  }

  /**
   * 获取进程 PID
   */
  getPid(): number | null {
    return this.process?.pid ?? null
  }
}
