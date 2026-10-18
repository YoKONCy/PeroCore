import { existsSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ApplicationDiscoveryRecord } from '@infos/shared'
import { electronProcessEnvironment } from '@infos/shared'
import type { ApplicationFederationConnector } from '../capabilities/arcaFederationConnector'
import { createLogger } from '../lib/logger'

const logger = createLogger('ApplicationHost')
export interface ApplicationControllerOptions {
  appRoot: string
  workspaceRoot: string
  applicationsRoot: string
  dataPath: string
  discoveryPath: string
  uiUrl: string
  packaged: boolean
  applicationId: string
  directoryName: string
  environmentPrefix: string
  environment?: () => Record<string, string>
  requestStop?: () => Promise<void>
}
export class ApplicationController {
  private child?: ChildProcess
  private hostState: 'offline' | 'starting' | 'running' | 'stopping' | 'error' = 'offline'
  private lastError?: string
  private starting?: Promise<ReturnType<ApplicationController['status']>>
  private stopping?: Promise<ReturnType<ApplicationController['status']>>
  constructor(
    private readonly federation: ApplicationFederationConnector,
    private readonly options: ApplicationControllerOptions,
  ) {}
  get uiRoot(): string {
    return path.join(this.options.applicationsRoot, this.options.directoryName, 'ui')
  }
  status() {
    const federation = this.federation.status()
    const runtime = this.runtime()
    const managed = Boolean(
      this.child && this.child.exitCode === null && this.child.signalCode === null,
    )
    return {
      ownership: managed
        ? ('managed' as const)
        : federation.discovery
          ? ('adopted' as const)
          : ('offline' as const),
      hostState: managed
        ? this.hostState
        : federation.state === 'connected'
          ? ('running' as const)
          : ('offline' as const),
      federation,
      managedRuntimeAvailable: runtime.available,
      managedRuntimeReason: runtime.reason,
      uiUrl: this.options.uiUrl,
      pid: managed ? this.child?.pid : federation.discovery?.pid,
      lastError: this.lastError ?? federation.lastError,
    }
  }
  start(): Promise<ReturnType<ApplicationController['status']>> {
    if (this.starting) return this.starting
    this.starting = this.launch().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }
  private async launch(): Promise<ReturnType<ApplicationController['status']>> {
    if (this.stopping) await this.stopping
    if (this.child && this.child.exitCode === null && this.child.signalCode === null)
      return this.status()
    // 启动前读取磁盘发现记录，避免定时同步间隙中重复派生同一个后台。
    await this.federation.reconnect()
    const existing = this.federation.status()
    if (existing.discovery) {
      if (existing.state === 'connected') return this.status()
      throw new Error(`已有应用实例尚未连接：${existing.lastError ?? '请稍后重试'}`)
    }
    const runtime = this.runtime()
    if (!runtime.available || !runtime.args)
      throw new Error(`APPLICATION_MANAGED_RUNTIME_UNAVAILABLE: ${runtime.reason}`)
    this.hostState = 'starting'
    this.lastError = undefined
    const prefix = this.options.environmentPrefix
    const environment = {
      ...process.env,
      [`${prefix}_DATA_PATH`]: this.options.dataPath,
      [`${prefix}_DISCOVERY_PATH`]: this.options.discoveryPath,
      [`${prefix}_OWNER_PID`]: String(process.pid),
      ...this.options.environment?.(),
    }
    const electronNodeRuntime = Boolean(
      process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1',
    )
    const child = spawn(process.execPath, runtime.args, {
      cwd: this.options.appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // 普通 Node 开发进程保留加载器参数；Electron 内置 Node 必须使用受控环境。
      env: electronNodeRuntime ? electronProcessEnvironment(environment, 'node') : environment,
    })
    this.child = child
    let startupError = ''
    child.stdout?.on('data', (data) =>
      logger.info(`${this.options.applicationId}：${String(data).trim()}`),
    )
    child.stderr?.on('data', (data) => {
      startupError = (startupError + String(data)).slice(-4000)
      logger.warn(`${this.options.applicationId}：${String(data).trim()}`)
    })
    child.once('error', (error) => {
      this.lastError = error.message
      this.hostState = 'error'
    })
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined
      this.hostState = code === 0 || this.hostState === 'stopping' ? 'offline' : 'error'
    })
    try {
      const deadline = Date.now() + 15000
      let ready = false
      while (Date.now() < deadline && !ready) {
        if (child.exitCode !== null || child.signalCode !== null || this.lastError)
          throw new Error(
            this.lastError ??
              (startupError.trim() || `应用进程已退出：${child.exitCode ?? child.signalCode}`),
          )
        if (existsSync(this.options.discoveryPath)) {
          try {
            const record = JSON.parse(
              readFileSync(this.options.discoveryPath, 'utf8'),
            ) as ApplicationDiscoveryRecord
            ready =
              record.application.appId === this.options.applicationId && record.pid === child.pid
          } catch {
            /* 等待完整的发现记录。 */
          }
        }
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (!ready) throw new Error('应用启动超时，未发布有效发现记录')
      await this.federation.reconnect()
      if (this.federation.status().state !== 'connected') throw new Error('应用协议连接失败')
      this.hostState = 'running'
      return this.status()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '应用启动失败'
      await this.stop().catch(() => undefined)
      this.hostState = 'error'
      throw error
    }
  }
  stop(): Promise<ReturnType<ApplicationController['status']>> {
    if (this.stopping) return this.stopping
    this.stopping = this.stopCurrent().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }
  private async stopCurrent(): Promise<ReturnType<ApplicationController['status']>> {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null)
      throw new Error('APPLICATION_NOT_MANAGED: 只能停止当前宿主管理的应用')
    this.hostState = 'stopping'
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    if (this.options.requestStop) {
      try {
        await this.options.requestStop()
      } catch {
        child.kill('SIGTERM')
      }
    } else child.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const graceful = await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000)
        }),
      ])
      if (!graceful && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        if (timer) clearTimeout(timer)
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('托管应用停止超时')), 2000)
          }),
        ])
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
    await this.federation.disconnectCurrent()
    return this.status()
  }
  async reconnect() {
    await this.federation.reconnect()
    return this.status()
  }
  async shutdownManaged(): Promise<{ stopped: boolean; reason?: 'not_managed' }> {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null)
      return { stopped: false, reason: 'not_managed' }
    await this.stop()
    return { stopped: true }
  }
  async shutdown(): Promise<void> {
    await this.starting?.catch(() => undefined)
    await this.shutdownManaged()
  }
  private runtime(): { available: boolean; args?: string[]; reason?: string } {
    if (this.options.packaged) {
      const file = path.join(this.options.applicationsRoot, this.options.directoryName, 'host.mjs')
      return existsSync(file)
        ? { available: true, args: [file, '--loopback-port=0'] }
        : { available: false, reason: '发行包缺少应用后台资源' }
    }
    const loader = path.join(
      this.options.workspaceRoot,
      'node_modules',
      'tsx',
      'dist',
      'loader.mjs',
    )
    const entry = path.join(
      this.options.workspaceRoot,
      'packages',
      'apps',
      this.options.directoryName,
      'src',
      'main.ts',
    )
    // 直接注册加载器，避免 CLI 再派生进程后发现记录中的 PID 与托管进程不一致。
    return existsSync(loader) && existsSync(entry)
      ? {
          available: true,
          args: ['--import', pathToFileURL(loader).href, entry, '--loopback-port=0'],
        }
      : { available: false, reason: '开发环境缺少应用源码或 tsx' }
  }
}
