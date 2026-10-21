import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type {
  ClientAccessRepository,
  ClientAccessState,
  ClientDevice,
} from '../../repositories/clientAccess.repo'

const COOKIE = 'infos_device'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export interface ClientIdentity {
  id: string
  admin: boolean
  token: string
}

/** 所有客户端共用安装实例级身份，配对码只兑换一次，不参与业务权限判定。 */
export class ClientAccessService {
  private state: ClientAccessState
  private pairing?: { code: string; expiresAt: number; admin: boolean }
  private attempts = new Map<string, { count: number; until: number }>()
  private startListener?: (port: number) => Promise<() => Promise<void>>
  private stopListener?: () => Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private revocations = new Set<() => void>()
  private listening = false
  private disposed = false
  lastError = ''
  readonly docker = process.env.INFOS_DOCKER === '1'
  constructor(
    private repository: ClientAccessRepository,
    private businessPort: number,
  ) {
    this.state = repository.load(this.docker)
    this.state.devices = this.state.devices.filter((device) => device.expiresAt > Date.now())
  }
  credential(request: Request): string {
    const authorization = request.headers.get('authorization')
    if (authorization) return authorization.replace(/^Bearer\s+/i, '')
    const url = new URL(request.url)
    if (url.searchParams.has('token')) return url.searchParams.get('token') || ''
    const value = request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
    return value?.slice(COOKIE.length + 1) || ''
  }
  identify(token: string): ClientIdentity | undefined {
    if (!token || token.length > 512) return undefined
    const administrator = process.env.INFOS_API_TOKEN || this.state.localToken
    if (equal(token, administrator)) return { id: 'local', admin: true, token }
    const hash = digest(token)
    const device = this.state.devices.find(
      (item) => item.expiresAt > Date.now() && equal(item.hash, hash),
    )
    return device ? { id: device.id, admin: device.admin, token } : undefined
  }
  authenticate(request: Request): ClientIdentity | undefined {
    const identity = this.identify(this.credential(request))
    if (!identity) return undefined
    // Cookie 自动发送，写操作还需同源；显式 Bearer 用于已配置的跨服务器客户端。
    const explicit =
      request.headers.has('authorization') ||
      (['GET', 'HEAD'].includes(request.method) && new URL(request.url).searchParams.has('token'))
    if (!explicit) {
      const origin = request.headers.get('origin')
      if (!origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return undefined
      try {
        if (origin && new URL(origin).host !== new URL(request.url).host) return undefined
      } catch {
        return undefined
      }
    }
    return identity
  }
  cookie(token: string, expiresAt: number, secure: boolean, remember = true): string {
    const lifetime =
      !token || remember
        ? `; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`
        : ''
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${lifetime}${secure ? '; Secure' : ''}`
  }
  status() {
    const publishedPort = Number(process.env.INFOS_WEB_PORT || 3000)
    const port = this.docker
      ? Number.isInteger(publishedPort) && publishedPort > 0 && publishedPort <= 65535
        ? publishedPort
        : 3000
      : this.state.port
    const addresses = Object.values(networkInterfaces())
      .flatMap((items) => items || [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => `http://${item.address}:${port}`)
    let publicAddress: string | undefined
    try {
      const configured = new URL(process.env.INFOS_PUBLIC_URL || '')
      if (['http:', 'https:'].includes(configured.protocol)) publicAddress = configured.origin
    } catch {
      /* 未配置公共地址时使用网卡地址。 */
    }
    return {
      enabled: this.docker || this.state.enabled,
      port,
      listening: this.docker || this.listening,
      managedByDocker: this.docker,
      lastError: this.lastError,
      // 容器不能推断宿主机网卡，避免把容器内部 IP 放进手机二维码。
      addresses: publicAddress ? [publicAddress] : this.docker ? [] : [...new Set(addresses)],
      devices: this.state.devices
        .filter((device) => device.expiresAt > Date.now())
        .map((device) => ({
          id: device.id,
          name: device.name,
          admin: device.admin,
          createdAt: device.createdAt,
          expiresAt: device.expiresAt,
        })),
    }
  }
  createPairing(admin = false) {
    this.pairing = {
      code: randomBytes(5).toString('hex').toUpperCase(),
      expiresAt: Date.now() + 5 * 60_000,
      admin,
    }
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt }
  }
  pair(code: string, name: string, remember: boolean, peer: string) {
    this.rateLimit(peer)
    const pairing = this.pairing
    if (
      !pairing ||
      pairing.expiresAt <= Date.now() ||
      !equal(pairing.code, code.trim().toUpperCase())
    )
      throw new Error('配对码无效或已过期，请在电脑上重新生成')
    const issued = this.issue(name, remember, pairing.admin)
    this.pairing = undefined
    return issued
  }
  login(token: string, name: string, remember: boolean, peer: string) {
    this.rateLimit(peer)
    if (!this.identify(token)?.admin) throw new Error('管理凭据无效')
    return this.issue(name, remember, true)
  }
  private rateLimit(peer: string): void {
    const now = Date.now()
    for (const [key, attempt] of this.attempts) if (attempt.until <= now) this.attempts.delete(key)
    const value = this.attempts.get(peer) || { count: 0, until: now + 60_000 }
    if (++value.count > 8 || this.attempts.size > 512)
      throw new Error('尝试过于频繁，请一分钟后重试')
    this.attempts.set(peer, value)
  }
  private issue(name: string, remember: boolean, admin: boolean) {
    this.state.devices = this.state.devices.filter((device) => device.expiresAt > Date.now())
    if (this.state.devices.length >= 100) throw new Error('已配对设备过多，请先撤销不用的设备')
    const token = randomBytes(32).toString('hex')
    const device: ClientDevice = {
      id: randomUUID(),
      name: name.trim().slice(0, 80) || '浏览器',
      hash: digest(token),
      admin,
      createdAt: Date.now(),
      expiresAt: Date.now() + (remember ? 30 : 1) * 86400_000,
    }
    const next = { ...this.state, devices: [...this.state.devices, device] }
    this.repository.save(next)
    this.state = next
    return { token, deviceId: device.id, expiresAt: device.expiresAt }
  }
  revoke(id: string): void {
    const next = { ...this.state, devices: this.state.devices.filter((device) => device.id !== id) }
    this.repository.save(next)
    this.state = next
    for (const listener of this.revocations) listener()
  }
  onRevoke(listener: () => void): () => void {
    this.revocations.add(listener)
    return () => this.revocations.delete(listener)
  }
  async attachListener(start: (port: number) => Promise<() => Promise<void>>): Promise<void> {
    this.startListener = start
    if (this.state.enabled && !this.docker) {
      try {
        this.stopListener = await start(this.state.port)
        this.listening = true
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
  }
  configure(enabled: boolean, port: number): Promise<void> {
    const action = this.queue.then(async () => {
      if (this.disposed) throw new Error('服务正在关闭，不能更改网络入口')
      if (this.docker) throw new Error('Docker 监听由容器端口映射管理')
      if (
        !Number.isInteger(port) ||
        port < 1024 ||
        port > 65535 ||
        [this.businessPort, 9121].includes(port)
      )
        throw new Error('局域网端口必须为 1024–65535，且不能占用业务或能力端口')
      if (this.stopListener && (!enabled || port !== this.state.port)) {
        await this.stopListener()
        this.stopListener = undefined
        this.listening = false
      }
      try {
        if (enabled && !this.stopListener) {
          if (!this.startListener) throw new Error('网络入口尚未就绪')
          this.stopListener = await this.startListener(port)
          this.listening = true
        }
        this.state.enabled = enabled
        this.state.port = port
        this.lastError = ''
        this.repository.save(this.state)
        if (!enabled) {
          this.pairing = undefined
          for (const listener of this.revocations) listener()
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        // 切换端口失败时如实保存关闭状态，避免界面显示已开放但实际没有监听。
        if (!this.stopListener) {
          this.state.enabled = false
          this.repository.save(this.state)
        }
        throw error
      }
    })
    this.queue = action.catch(() => {})
    return action
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.queue
    await this.stopListener?.()
    this.stopListener = undefined
    this.startListener = undefined
    this.listening = false
    this.revocations.clear()
  }
}
