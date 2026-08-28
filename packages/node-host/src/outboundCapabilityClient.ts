import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import type { DaemonToNodeMessage, KernelNodeSessionId, NodeToDaemonMessage } from '@infos/shared'
import type { NodeProviderRuntime } from './providerRuntime'
import type { NodeHelloMessage } from '@infos/node-sdk'

const HEARTBEAT_MS = 25_000
const RECONNECT_MS = 5_000

type OutboundMessage = NodeToDaemonMessage extends infer Message
  ? Message extends NodeToDaemonMessage
    ? Omit<Message, 'protocolVersion'>
    : never
  : never

/** Capability Node 主动出站连接 Home Server 的客户端。 */
export class OutboundCapabilityClient {
  private socket?: WebSocket
  private sessionId?: KernelNodeSessionId
  private heartbeat?: NodeJS.Timeout
  private reconnect?: NodeJS.Timeout
  private stopped = false

  constructor(
    private readonly endpoint: string,
    private readonly credentialPath: string,
    private readonly hello: () => NodeHelloMessage,
    private readonly runtime: NodeProviderRuntime,
    private readonly pairingCode = '',
  ) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.reconnect) clearTimeout(this.reconnect)
    this.heartbeat = undefined
    this.reconnect = undefined
    this.socket?.close()
    this.socket = undefined
  }

  private connect(): void {
    if (this.stopped) return
    const socket = new WebSocket(this.endpoint)
    this.socket = socket
    socket.once('open', () => {
      this.send({ type: 'authenticate', token: this.loadToken() || this.pairingCode })
    })
    socket.on('message', (data) => void this.handle(String(data)))
    socket.once('close', () => {
      if (this.socket === socket) this.socket = undefined
      this.sessionId = undefined
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = undefined
      this.scheduleReconnect()
    })
    socket.once('error', () => undefined)
  }

  private async handle(raw: string): Promise<void> {
    const message = JSON.parse(raw) as DaemonToNodeMessage
    if (message.type === 'authenticated') {
      if (message.deviceToken) this.saveToken(message.deviceToken)
      const hello = this.hello()
      this.send({ type: 'node_hello', descriptor: hello.descriptor, offers: hello.offers })
      return
    }
    if (message.type === 'node_accepted') {
      this.sessionId = message.sessionId
      this.heartbeat = setInterval(() => {
        if (!this.sessionId) return
        this.send({
          type: 'heartbeat',
          nodeId: this.runtime.node.nodeId,
          sessionId: this.sessionId,
        })
      }, HEARTBEAT_MS)
      this.heartbeat.unref?.()
      return
    }
    if (message.type === 'capability_cancel') {
      await this.runtime.cancel(message.invocationId)
      return
    }
    if (message.type !== 'capability_invoke') return
    const manifest = this.runtime
      .listOffers()
      .find((item) => item.offer.offerId === message.providerId)
    if (!manifest) {
      this.send({
        type: 'capability_result',
        invocationId: message.invocationId,
        success: false,
        error: {
          code: 'NODE_PROVIDER_NOT_FOUND',
          message: `节点未发布 Provider：${message.providerId}`,
          retryable: false,
        },
      })
      return
    }
    const receipt = await this.runtime.invoke({
      protocolVersion: 1,
      type: 'invoke',
      messageId: message.invocationId,
      invocationId: message.invocationId,
      sourceNodeId: message.envelope.sourceNodeId ?? this.runtime.node.nodeId,
      targetNodeId: this.runtime.node.nodeId,
      providerId: manifest.providerId,
      envelope: message.envelope,
    })
    this.send(
      receipt.state === 'completed'
        ? {
            type: 'capability_result',
            invocationId: message.invocationId,
            success: true,
            output: receipt.output,
          }
        : {
            type: 'capability_result',
            invocationId: message.invocationId,
            success: false,
            error: receipt.error ?? {
              code: 'NODE_PROVIDER_FAILED',
              message: receipt.state,
              retryable: false,
            },
          },
    )
  }

  private send(message: OutboundMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ ...message, protocolVersion: 1 }))
    }
  }

  private loadToken(): string {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.credentialPath, 'utf8')) as {
        endpoint?: string
        token?: string
      }
      return parsed.endpoint === this.endpoint ? (parsed.token ?? '') : ''
    } catch {
      return ''
    }
  }

  private saveToken(token: string): void {
    fs.mkdirSync(path.dirname(this.credentialPath), { recursive: true })
    fs.writeFileSync(
      this.credentialPath,
      JSON.stringify({ version: 1, endpoint: this.endpoint, token }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnect) return
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined
      this.connect()
    }, RECONNECT_MS)
    this.reconnect.unref?.()
  }
}
