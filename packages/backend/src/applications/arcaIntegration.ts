import { t as __t } from '../lib/i18n'
import { arcaHostKey } from '@infos/arca/hostCredentials'
import {
  parseApplicationDesktopGuard,
  watchApplicationDesktop,
  type ApplicationDesktopGuard,
} from '@infos/node-host'
import { ApplicationController, type ApplicationControllerOptions } from './applicationController'
import type { ArcaFederationConnector } from '../capabilities/arcaFederationConnector'
import { createLogger } from '../lib/logger'

const logger = createLogger('ArcaIntegration')

/** infOS 兼容层只负责归属、认证和生命周期，不持有文稿引擎。 */
export class ArcaApplicationController {
  private readonly controller: ApplicationController
  private readonly key: string
  private desktop?: ApplicationDesktopGuard
  private watch?: ReturnType<typeof watchApplicationDesktop>
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private desktopLost = false
  private beforeStop?: () => Promise<void>
  constructor(
    private readonly federation: ArcaFederationConnector,
    options: Omit<
      ApplicationControllerOptions,
      'applicationId' | 'directoryName' | 'environmentPrefix'
    >,
  ) {
    this.key = arcaHostKey(options.dataPath)
    this.controller = new ApplicationController(federation, {
      ...options,
      applicationId: 'infos.arca',
      directoryName: 'arca',
      environmentPrefix: 'INFOS_ARCA',
      environment: () => ({
        ...options.environment?.(),
        ...(this.desktop ? { INFOS_ARCA_DESKTOP_GUARD: JSON.stringify(this.desktop) } : {}),
      }),
      requestStop: () => this.control('/shutdown'),
    })
  }
  get uiRoot(): string {
    return this.controller.uiRoot
  }
  status() {
    return this.controller.status()
  }
  setBeforeStop(callback: () => Promise<void>): void {
    this.beforeStop = callback
  }
  prepareInput(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Arca 请求参数无效')
    return { ...input, __arcaHostAuth: this.key }
  }
  start(rawDesktop?: unknown) {
    return this.serial(async () => {
      if (this.closing) throw new Error('宿主正在退出')
      if (this.status().ownership === 'adopted') {
        await this.controller.reconnect()
        if (this.status().ownership === 'adopted') return this.status()
      }
      if (rawDesktop !== undefined) {
        const value = parseApplicationDesktopGuard(rawDesktop)
        if (
          this.desktop &&
          (this.desktop.pipe !== value.pipe || this.desktop.token !== value.token)
        ) {
          if (this.status().ownership === 'managed') throw new Error('Arca 已归属于另一个桌面进程')
          this.watch?.dispose()
          this.watch = undefined
        }
        this.desktop = value
        this.desktopLost = false
      } else if (this.status().ownership === 'offline') {
        this.watch?.dispose()
        this.watch = undefined
        this.desktop = undefined
        this.desktopLost = false
      }
      if (this.desktop && !this.watch)
        this.watch = watchApplicationDesktop(this.desktop, () => {
          this.desktopLost = true
          void this.shutdownManaged().catch((error) =>
            logger.warn(__t('logs.applications', '回收 Arca 失败：{0}', [String(error)])),
          )
        })
      try {
        await this.watch?.ready
      } catch (error) {
        this.watch?.dispose()
        this.watch = undefined
        throw error
      }
      if (this.desktopLost || this.closing) throw new Error('桌面或宿主已退出')
      const status = await this.controller.start()
      if (status.ownership !== 'managed') return status
      try {
        if (this.desktopLost || this.closing) throw new Error('桌面或宿主已退出')
        if (this.desktop) await this.control('/lifecycle/desktop', this.desktop)
        return status
      } catch (error) {
        await this.prepareStop()
        await this.controller.shutdownManaged()
        throw error
      }
    })
  }
  stop() {
    return this.serial(async () => {
      if (this.status().ownership !== 'managed')
        throw new Error('APPLICATION_NOT_MANAGED: 只能停止当前宿主管理的 Arca')
      await this.prepareStop()
      await this.controller.stop()
      await this.federation.reconnect()
      return this.status()
    })
  }
  shutdownManaged(): Promise<{ stopped: boolean; reason?: 'not_managed' }> {
    return this.serial(async () => {
      if (this.status().ownership !== 'managed') return { stopped: false, reason: 'not_managed' }
      await this.prepareStop()
      const result = await this.controller.shutdownManaged()
      await this.federation.reconnect()
      return result
    })
  }
  reconnect() {
    return this.serial(() => this.controller.reconnect())
  }
  async shutdown(): Promise<void> {
    this.closing = true
    try {
      await this.shutdownManaged()
    } finally {
      this.watch?.dispose()
      this.watch = undefined
    }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(action)
    this.queue = next
    return next
  }
  private async prepareStop(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.beforeStop?.(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('回收协作任务超时')), 3000)
        }),
      ])
    } catch (error) {
      logger.warn(
        __t('logs.applications', '协作回收尚未完成，继续停止后台并由实例监视器重试：{0}', [
          String(error),
        ]),
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  private async control(route: string, body?: unknown): Promise<void> {
    const endpoint = this.federation.status().discovery?.httpEndpoint
    if (!endpoint) throw new Error('Arca 尚未发布控制端点')
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password)
      throw new Error('Arca 控制端点无效')
    const response = await fetch(new URL(route, url), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Arca 控制请求失败：HTTP ${response.status}`)
  }
}
export type ArcaApplicationStatus = ReturnType<ArcaApplicationController['status']>
