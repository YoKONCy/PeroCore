import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { ArcaFederationConnector } from './arcaFederationConnector'
import { createLogger } from '../lib/logger'

const logger = createLogger('ArcaApplication')

export interface ArcaApplicationStatus {
  ownership: 'offline' | 'managed' | 'adopted'
  hostState: 'offline' | 'starting' | 'running' | 'stopping' | 'error'
  federation: ReturnType<ArcaFederationConnector['status']>
  managedRuntimeAvailable: boolean
  managedRuntimeReason?: string
  uiUrl: string
  pid?: number
  lastError?: string
}

/** Arca官方应用的Host生命周期和控制面状态。 */
export class ArcaApplicationController {
  private child?: ChildProcess
  private hostState: ArcaApplicationStatus['hostState'] = 'offline'
  private lastError?: string

  constructor(
    private readonly federation: ArcaFederationConnector,
    private readonly options: {
      appRoot: string
      workspaceRoot: string
      applicationsRoot: string
      dataPath: string
      discoveryPath: string
      uiUrl: string
      packaged: boolean
    },
  ) {}

  get uiRoot(): string {
    return path.join(this.options.applicationsRoot, 'arca', 'ui')
  }

  status(): ArcaApplicationStatus {
    const federation = this.federation.status()
    const managedRuntime = this.resolveRuntime()
    const managed = Boolean(this.child && this.child.exitCode === null)
    return {
      ownership: managed ? 'managed' : federation.discovery ? 'adopted' : 'offline',
      hostState: managed
        ? this.hostState
        : federation.state === 'connected'
          ? 'running'
          : 'offline',
      federation,
      managedRuntimeAvailable: managedRuntime.available,
      managedRuntimeReason: managedRuntime.reason,
      uiUrl: this.options.uiUrl,
      pid: managed ? this.child?.pid : federation.discovery?.pid,
      lastError: this.lastError ?? federation.lastError,
    }
  }

  async start(): Promise<ArcaApplicationStatus> {
    if (this.child && this.child.exitCode === null) return this.status()
    if (this.federation.status().discovery) {
      throw new Error('ARCA_EXTERNAL_INSTANCE_ACTIVE: 已发现外部Arca，请先停止或接管该实例')
    }
    const runtime = this.resolveRuntime()
    if (!runtime.available || !runtime.command || !runtime.args) {
      throw new Error(`ARCA_MANAGED_RUNTIME_UNAVAILABLE: ${runtime.reason}`)
    }
    this.hostState = 'starting'
    this.lastError = undefined
    const child = spawn(runtime.command, runtime.args, {
      cwd: this.options.appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        INFOS_ARCA_DATA_PATH: this.options.dataPath,
        INFOS_ARCA_DISCOVERY_PATH: this.options.discoveryPath,
        INFOS_ARCA_OWNER_PID: String(process.pid),
      },
    })
    this.child = child
    child.stdout?.on('data', (chunk) => logger.info(String(chunk).trim()))
    child.stderr?.on('data', (chunk) => logger.warn(String(chunk).trim()))
    child.once('spawn', () => {
      this.hostState = 'running'
    })
    child.once('error', (error) => {
      this.hostState = 'error'
      this.lastError = error.message
    })
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined
      if (this.hostState !== 'stopping' && code !== 0) {
        this.hostState = 'error'
        this.lastError = `Arca Host异常退出: ${code}`
      } else {
        this.hostState = 'offline'
      }
    })
    await this.waitForManagedDiscovery(child)
    await this.federation.reconnect()
    return this.status()
  }

  async stop(): Promise<ArcaApplicationStatus> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      throw new Error('ARCA_NOT_MANAGED: 外部Arca必须先接管，不能直接按PID终止')
    }
    this.hostState = 'stopping'
    child.kill('SIGTERM')
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ])
    if (!graceful && child.exitCode === null) {
      logger.warn('Arca Host未在优雅期限内退出，正在终止托管子进程')
      child.kill('SIGKILL')
      await Promise.race([
        exited,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('ARCA_MANAGED_PROCESS_STOP_TIMEOUT')), 2_000),
        ),
      ])
    }
    await this.federation.disconnectCurrent()
    return this.status()
  }

  async reconnect(): Promise<ArcaApplicationStatus> {
    await this.federation.reconnect()
    return this.status()
  }

  async shutdownManaged(): Promise<{ stopped: boolean; reason?: 'not_managed' }> {
    if (!this.child || this.child.exitCode !== null)
      return { stopped: false, reason: 'not_managed' }
    await this.stop()
    return { stopped: true }
  }

  async shutdown(): Promise<void> {
    await this.shutdownManaged().catch(() => undefined)
  }

  private async waitForManagedDiscovery(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`ARCA_MANAGED_PROCESS_EXITED: ${child.exitCode}`)
      }
      if (existsSync(this.options.discoveryPath)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('ARCA_DISCOVERY_TIMEOUT: 托管Host未发布Discovery')
  }

  private resolveRuntime(): {
    available: boolean
    command?: string
    args?: string[]
    reason?: string
  } {
    if (!this.options.packaged) {
      const cli = path.join(this.options.workspaceRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
      const entry = path.join(
        this.options.workspaceRoot,
        'packages',
        'apps',
        'arca',
        'src',
        'main.ts',
      )
      if (existsSync(cli) && existsSync(entry)) {
        return {
          available: true,
          command: process.execPath,
          args: [cli, entry, '--loopback-port=0'],
        }
      }
      return { available: false, reason: '开发环境缺少tsx或Arca源码入口' }
    }
    const bundled = path.join(this.options.applicationsRoot, 'arca', 'host.mjs')
    return existsSync(bundled)
      ? { available: true, command: process.execPath, args: [bundled, '--loopback-port=0'] }
      : { available: false, reason: '当前发行包尚未收集Arca Host产物' }
  }
}
