import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { ipcPayloadBytes, performanceEventsTotal } from '../lib/metrics'
import { validateKernelEnvelope, validateVersionedMessage } from '@infos/shared'
import type {
  DaemonToNodeMessage,
  KernelCapabilityHandle,
  KernelCapabilityOffer,
  KernelEnvelope,
  KernelError,
  KernelNodeId,
  KernelNodeSessionId,
  NodeToDaemonMessage,
} from '@infos/shared'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'
import type { NodeRegistry } from '../kernel/nodeRegistry'
import { createLogger } from '../lib/logger'

const logger = createLogger('CapabilityBridge')
const CALL_TIMEOUT_MS = 30_000
const NODE_LEASE_MS = 60_000
const LEASE_CHECK_MS = 30_000

interface ConnectionState {
  authenticated: boolean
  paired: boolean
  nodeId?: KernelNodeId
  sessionId?: KernelNodeSessionId
  scope?: LifecycleScope
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  startedAt: number
  socket: WebSocket
  providerId: string
  idempotencyKey?: string
}

/** 将 Electron WebSocket Node 接入统一 NodeRegistry 与 CapabilityDirectory。 */
export class CapabilityBridge {
  private server: WebSocketServer | null = null
  private leaseTimer: NodeJS.Timeout | null = null
  private readonly connections = new Map<KernelNodeId, WebSocket>()
  private readonly states = new WeakMap<WebSocket, ConnectionState>()
  private readonly pending = new Map<string, PendingCall>()
  private readonly idempotentResults = new Map<string, { value: unknown; expiresAt: number }>()
  private readonly pairingCodes = new Map<string, number>()
  private readonly deviceTokens = new Set<string>()
  private readonly deviceTokensFile: string
  private deviceTokensLoaded = false

  constructor(
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly nodes: NodeRegistry,
    private readonly authToken = '',
    dataDir = '',
  ) {
    this.deviceTokensFile = dataDir
      ? path.join(dataDir, 'kernel', 'capability-device-tokens.json')
      : ''
  }

  async start(port: number): Promise<void> {
    if (this.server) return
    await this.loadDeviceTokens()
    await new Promise<void>((resolve, reject) => {
      const host = this.authToken ? (process.env.PERO_CAPABILITY_HOST ?? '0.0.0.0') : '127.0.0.1'
      const server = new WebSocketServer({ port, host })
      const onError = (error: Error) => reject(error)
      server.once('error', onError)
      server.once('listening', () => {
        server.off('error', onError)
        this.server = server
        resolve()
      })
      server.on('connection', (socket, request) =>
        this.accept(socket, request.socket.remoteAddress),
      )
    })
    this.leaseTimer = setInterval(() => this.expireLeases(), LEASE_CHECK_MS)
    this.leaseTimer.unref?.()
    if (!this.authToken) {
      logger.info('Capability Transport 使用本机信任模式，仅监听 127.0.0.1')
    }
    logger.info(
      `Capability Transport 已启动 → ws://${this.authToken ? (process.env.PERO_CAPABILITY_HOST ?? '0.0.0.0') : '127.0.0.1'}:${port}`,
    )
  }

  async stop(): Promise<void> {
    if (this.leaseTimer) clearInterval(this.leaseTimer)
    this.leaseTimer = null
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer)
      call.reject(new Error('CAPABILITY_TRANSPORT_STOPPED: 能力 Transport 已关闭'))
      this.pending.delete(id)
    }
    for (const socket of this.connections.values()) socket.close()
    this.connections.clear()
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    logger.info('Capability Transport 已停止')
  }

  private accept(socket: WebSocket, remoteAddress?: string): void {
    const loopback =
      !remoteAddress ||
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1'
    if (!this.authToken && !loopback) {
      logger.warn(`拒绝未认证的外部Capability连接: ${remoteAddress}`)
      socket.close(4003, 'Remote capability transport requires authentication')
      return
    }
    this.states.set(socket, { authenticated: !this.authToken, paired: false })
    logger.info(`能力 Node 连接: ${remoteAddress ?? 'unknown'}`)
    socket.on('message', (data) => void this.handleMessage(socket, data.toString()))
    socket.on('close', () => void this.disconnect(socket))
    socket.on('error', (error) => logger.warn(`能力 Node 连接错误: ${error.message}`))
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.send(socket, { type: 'error', message: 'CAPABILITY_MESSAGE_INVALID: 消息不是合法JSON' })
      return
    }
    let message: NodeToDaemonMessage
    try {
      validateVersionedMessage(parsed)
      message = parsed as NodeToDaemonMessage
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.send(socket, { type: 'error', message: `CAPABILITY_PROTOCOL_INVALID: ${reason}` })
      return
    }
    const state = this.states.get(socket)!
    if (message.type === 'authenticate') {
      const pairingExpiresAt = this.pairingCodes.get(message.token)
      const pairingAccepted = Boolean(pairingExpiresAt && pairingExpiresAt > Date.now())
      const deviceAccepted = this.deviceTokens.has(message.token)
      if (
        !this.authToken ||
        message.token === this.authToken ||
        pairingAccepted ||
        deviceAccepted
      ) {
        let deviceToken: string | undefined
        if (pairingAccepted) {
          this.pairingCodes.delete(message.token)
          deviceToken = randomBytes(32).toString('base64url')
          this.deviceTokens.add(deviceToken)
          await this.saveDeviceTokens()
        }
        state.authenticated = true
        state.paired = pairingAccepted || deviceAccepted
        this.send(socket, { type: 'authenticated', deviceToken })
      } else {
        this.send(socket, { type: 'error', message: 'CAPABILITY_AUTH_FAILED: Token不匹配' })
        socket.close()
      }
      return
    }
    if (!state.authenticated) {
      this.send(socket, { type: 'error', message: 'CAPABILITY_AUTH_REQUIRED: 请先认证' })
      return
    }
    try {
      if (message.type === 'node_hello') await this.hello(socket, state, message)
      else if (message.type === 'heartbeat') this.heartbeat(state, message)
      else if (message.type === 'capability_result') this.complete(socket, message)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      logger.warn(`能力消息处理失败: ${text}`)
      this.send(socket, { type: 'error', message: text })
    }
  }

  private async hello(
    socket: WebSocket,
    state: ConnectionState,
    message: Extract<NodeToDaemonMessage, { type: 'node_hello' }>,
  ): Promise<void> {
    await state.scope?.dispose()
    if (state.sessionId) this.nodes.disconnect(state.sessionId)
    this.nodes.registerNode({
      ...message.descriptor,
      trust: state.paired ? 'paired' : message.descriptor.trust,
    })
    const session = this.nodes.connect({
      nodeId: message.descriptor.nodeId,
      carrier: 'websocket',
      leaseMs: NODE_LEASE_MS,
    })
    if (message.descriptor.facets.includes('client')) {
      this.nodes.issueInputSeat({
        sessionId: session.sessionId,
        principalId: 'system',
        capabilities: ['input'],
        leaseMs: NODE_LEASE_MS,
      })
    }
    const scope = new LifecycleScope(`node:${message.descriptor.nodeId}:${session.sessionId}`)
    state.nodeId = message.descriptor.nodeId
    state.sessionId = session.sessionId
    state.scope = scope
    this.connections.set(message.descriptor.nodeId, socket)
    performanceEventsTotal.inc({ metric: 'node_recovery', outcome: 'accepted' })
    scope.defer(() => {
      if (this.connections.get(message.descriptor.nodeId) === socket) {
        this.connections.delete(message.descriptor.nodeId)
      }
    })
    for (const offer of message.offers)
      this.registerOffer(
        socket,
        message.descriptor.nodeId,
        {
          ...offer,
          leaseExpiresAt: session.leaseExpiresAt,
        },
        scope,
      )
    this.send(socket, {
      type: 'node_accepted',
      sessionId: session.sessionId,
      leaseExpiresAt: session.leaseExpiresAt,
    })
    logger.info(
      `Node已接入: ${message.descriptor.nodeId}, Offer=[${message.offers.map((item) => item.offerId).join(', ')}]`,
    )
  }

  private registerOffer(
    socket: WebSocket,
    nodeId: KernelNodeId,
    offer: KernelCapabilityOffer,
    scope: LifecycleScope,
  ): void {
    if (!offer.placement || offer.placement.providerNodeId !== nodeId) {
      throw new Error(`NODE_OFFER_PLACEMENT_INVALID: ${offer.offerId}`)
    }
    if (offer.provider.authorityNodeId !== nodeId) {
      throw new Error(`NODE_OFFER_AUTHORITY_INVALID: ${offer.offerId}`)
    }
    scope.defer(
      this.directory.registerRemoteProvider(offer, (envelope) =>
        this.invokeRemote(socket, offer.offerId, envelope),
      ),
    )
  }

  private heartbeat(
    state: ConnectionState,
    message: Extract<NodeToDaemonMessage, { type: 'heartbeat' }>,
  ): void {
    if (state.nodeId !== message.nodeId || state.sessionId !== message.sessionId) {
      throw new Error('NODE_SESSION_MISMATCH: 心跳身份不匹配')
    }
    const session = this.nodes.heartbeat(message.sessionId, NODE_LEASE_MS)
    this.directory.renewNodeOffers(message.nodeId, session.leaseExpiresAt)
    if (this.nodes.getNode(message.nodeId)?.facets.includes('client')) {
      this.nodes.issueInputSeat({
        sessionId: message.sessionId,
        principalId: 'system',
        capabilities: ['input'],
        leaseMs: NODE_LEASE_MS,
      })
    }
  }

  private invokeRemote(
    socket: WebSocket,
    providerId: string,
    envelope: KernelEnvelope<{ operation: string; input: unknown }>,
  ): Promise<unknown> {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error('CAPABILITY_PROVIDER_UNAVAILABLE: Node连接已断开')
    }
    const invocationId = randomUUID()
    const deadlineAt = envelope.deadline ? Date.parse(envelope.deadline) : undefined
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
      throw new Error('CAPABILITY_DEADLINE_EXCEEDED: 调用在发送前已过期')
    }
    const idempotencyKey = envelope.idempotencyKey
    if (idempotencyKey) {
      const cacheKey = `${providerId}:${idempotencyKey}`
      const cached = this.idempotentResults.get(cacheKey)
      if (cached?.expiresAt && cached.expiresAt <= Date.now()) {
        this.idempotentResults.delete(cacheKey)
      } else if (cached) {
        return Promise.resolve(structuredClone(cached.value))
      }
    }
    return new Promise((resolve, reject) => {
      const defaultTimeout =
        envelope.operation === 'audio.output/play' || envelope.operation === 'system.shell/wait'
          ? 5 * 60_000
          : CALL_TIMEOUT_MS
      const timeout = deadlineAt
        ? Math.min(defaultTimeout, deadlineAt - Date.now())
        : defaultTimeout
      const timer = setTimeout(() => {
        this.pending.delete(invocationId)
        this.send(socket, {
          type: 'capability_cancel',
          invocationId,
          reason: 'deadline_exceeded',
        })
        reject(new Error(`CAPABILITY_TIMEOUT: ${providerId}/${envelope.payload.operation}`))
      }, timeout)
      this.pending.set(invocationId, {
        resolve,
        reject,
        timer,
        startedAt: Date.now(),
        socket,
        providerId,
        idempotencyKey,
      })
      validateKernelEnvelope(envelope)
      this.send(socket, { type: 'capability_invoke', invocationId, providerId, envelope })
    })
  }

  private complete(
    socket: WebSocket,
    message: Extract<NodeToDaemonMessage, { type: 'capability_result' }>,
  ): void {
    const call = this.pending.get(message.invocationId)
    if (!call) {
      logger.warn(`收到未匹配的 Capability结果: ${message.invocationId}`)
      return
    }
    if (call.socket !== socket) {
      logger.warn(`拒绝非调用 Provider 返回的 Capability结果: ${message.invocationId}`)
      return
    }
    clearTimeout(call.timer)
    this.pending.delete(message.invocationId)
    if (message.success) {
      if (call.idempotencyKey) {
        this.idempotentResults.set(`${call.providerId}:${call.idempotencyKey}`, {
          value: structuredClone(message.output),
          expiresAt: Date.now() + 5 * 60_000,
        })
      }
      call.resolve(message.output)
      return
    }
    const error = message.error ?? {
      code: 'CAPABILITY_PROVIDER_ERROR',
      message: 'Provider调用失败',
      retryable: false,
    }
    const result = new Error(`${error.code}: ${error.message}`)
    Object.assign(result, { kernelError: error, durationMs: Date.now() - call.startedAt })
    call.reject(result)
  }

  private async disconnect(socket: WebSocket): Promise<void> {
    const state = this.states.get(socket)
    if (!state) return
    for (const [invocationId, call] of this.pending) {
      if (call.socket !== socket) continue
      clearTimeout(call.timer)
      call.reject(new Error('CAPABILITY_PROVIDER_DISCONNECTED: Provider 连接已断开'))
      this.pending.delete(invocationId)
    }
    if (state.sessionId) this.nodes.disconnect(state.sessionId)
    await state.scope?.dispose().catch((error) => logger.warn(`释放 Node Offer失败: ${error}`))
    if (state.nodeId) this.handles.revokeSubject(`node:${state.nodeId}`)
    logger.info(`能力 Node 已离线: ${state.nodeId ?? '未注册'}`)
  }

  private expireLeases(): void {
    this.nodes.expireLeases()
    const now = Date.now()
    for (const [key, result] of this.idempotentResults) {
      if (result.expiresAt <= now) this.idempotentResults.delete(key)
    }
    for (const [code, expiresAt] of this.pairingCodes) {
      if (expiresAt <= now) this.pairingCodes.delete(code)
    }
    for (const [nodeId, socket] of this.connections) {
      if (!this.nodes.getActiveSession(nodeId)) socket.close()
    }
  }

  private async loadDeviceTokens(): Promise<void> {
    if (this.deviceTokensLoaded) return
    this.deviceTokensLoaded = true
    if (!this.deviceTokensFile) return
    try {
      const parsed = JSON.parse(await readFile(this.deviceTokensFile, 'utf8')) as {
        version?: number
        tokens?: unknown
      }
      if (parsed.version !== 1 || !Array.isArray(parsed.tokens)) return
      for (const token of parsed.tokens) {
        if (typeof token === 'string' && token.length >= 32) this.deviceTokens.add(token)
      }
    } catch {
      // 首次启动时还没有设备凭据文件。
    }
  }

  private async saveDeviceTokens(): Promise<void> {
    if (!this.deviceTokensFile) return
    await mkdir(path.dirname(this.deviceTokensFile), { recursive: true })
    await writeFile(
      this.deviceTokensFile,
      JSON.stringify({ version: 1, tokens: [...this.deviceTokens] }, null, 2),
      { mode: 0o600 },
    )
  }

  createPairingInvite(
    endpoint: string,
    ttlMs = 5 * 60_000,
  ): {
    endpoint: string
    pairingCode: string
    expiresAt: string
  } {
    const pairingCode = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    const expiresAt = Date.now() + ttlMs
    this.pairingCodes.set(pairingCode, expiresAt)
    return { endpoint, pairingCode, expiresAt: new Date(expiresAt).toISOString() }
  }

  diagnostics(): {
    listening: boolean
    connectedNodes: number
    pendingInvocations: number
    offers: KernelCapabilityOffer[]
  } {
    return {
      listening: Boolean(this.server),
      connectedNodes: this.connections.size,
      pendingInvocations: this.pending.size,
      offers: this.directory.listOffers(),
    }
  }

  private send(
    socket: WebSocket,
    message: DaemonToNodeMessage extends infer Message
      ? Message extends DaemonToNodeMessage
        ? Omit<Message, 'protocolVersion'>
        : never
      : never,
  ): void {
    if (socket.readyState === WebSocket.OPEN) {
      const serialized = JSON.stringify({ protocolVersion: 1, ...message })
      ipcPayloadBytes.observe(
        { carrier: 'capability-websocket', direction: 'outbound' },
        Buffer.byteLength(serialized),
      )
      socket.send(serialized)
    }
  }
}

/** 将异常统一为跨 Node 结构化错误。 */
export function toCapabilityError(error: unknown): KernelError {
  const message = error instanceof Error ? error.message : String(error)
  const separator = message.indexOf(':')
  return {
    code: separator > 0 ? message.slice(0, separator) : 'CAPABILITY_PROVIDER_ERROR',
    message: separator > 0 ? message.slice(separator + 1).trim() : message,
    retryable: /TIMEOUT|UNAVAILABLE|DISCONNECTED/.test(message),
  }
}

export type IssuedCapabilityBinding = {
  handle: KernelCapabilityHandle
  dispose(): Promise<void>
}
