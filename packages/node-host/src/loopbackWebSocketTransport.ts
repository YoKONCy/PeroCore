import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import type {
  NodeCancelRequest,
  NodeErrorMessage,
  NodeHelloMessage,
  NodeInvokeRequest,
  NodeProviderReceipt,
  NodeReceiptMessage,
  NodeTransport,
  NodeTransportMessage,
} from '@infos/node-sdk'
import type { NodeProviderRuntime } from './providerRuntime'

function isTrustedLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true
  try {
    const hostname = new URL(origin).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

export class LoopbackWebSocketNodeServer {
  private server?: WebSocketServer

  constructor(
    private readonly runtime: NodeProviderRuntime,
    private readonly hello: NodeHelloMessage,
  ) {}

  async listen(port = 0): Promise<number> {
    if (this.server) throw new Error('NODE_WS_ALREADY_LISTENING')
    this.server = new WebSocketServer({
      host: '127.0.0.1',
      port,
      verifyClient: ({ origin }, done) =>
        done(isTrustedLoopbackOrigin(origin), 403, 'Origin denied'),
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('listening', resolve)
      this.server!.once('error', reject)
    })
    this.server.on('connection', (socket) => {
      socket.send(JSON.stringify(this.hello))
      socket.on('message', (data) => void this.handle(socket, String(data)))
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('NODE_WS_ADDRESS_UNAVAILABLE')
    return address.port
  }

  async close(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = undefined
    for (const client of server.clients) client.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }

  private async handle(socket: WebSocket, raw: string): Promise<void> {
    let message: NodeTransportMessage
    try {
      message = JSON.parse(raw) as NodeTransportMessage
    } catch {
      socket.send(JSON.stringify(this.error('NODE_MESSAGE_INVALID', '消息不是合法 JSON')))
      return
    }
    try {
      if (message.type === 'invoke') {
        const receipt = await this.runtime.invoke(message)
        const response: NodeReceiptMessage = {
          protocolVersion: 1,
          type: 'receipt',
          messageId: randomUUID(),
          invocationId: message.invocationId,
          sourceNodeId: this.runtime.node.nodeId,
          targetNodeId: message.sourceNodeId,
          receipt,
        }
        socket.send(JSON.stringify(response))
      } else if (message.type === 'cancel') {
        await this.runtime.cancel(message.invocationId)
      }
    } catch (error) {
      socket.send(
        JSON.stringify(
          this.error(
            'NODE_REQUEST_FAILED',
            error instanceof Error ? error.message : String(error),
            'invocationId' in message ? message.invocationId : undefined,
          ),
        ),
      )
    }
  }

  private error(code: string, message: string, invocationId?: string): NodeErrorMessage {
    return {
      protocolVersion: 1,
      type: 'error',
      messageId: randomUUID(),
      sourceNodeId: this.runtime.node.nodeId,
      code,
      message,
      invocationId,
    }
  }
}

export class LoopbackWebSocketNodeTransport implements NodeTransport {
  readonly localNodeId
  private readonly socket: WebSocket
  private readonly pending = new Map<
    string,
    { resolve(receipt: NodeProviderReceipt): void; reject(error: Error): void }
  >()
  private ready: Promise<void>
  private helloResolve?: (hello: NodeHelloMessage) => void
  private helloReject?: (error: Error) => void
  private readonly helloReady: Promise<NodeHelloMessage>
  hello?: NodeHelloMessage

  constructor(localNodeId: NodeTransport['localNodeId'], url: string) {
    this.localNodeId = localNodeId
    this.helloReady = new Promise<NodeHelloMessage>((resolve, reject) => {
      this.helloResolve = resolve
      this.helloReject = reject
    })
    this.socket = new WebSocket(url)
    this.ready = new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
    this.socket.on('message', (data) => this.handle(String(data)))
    this.socket.on('close', () => {
      this.helloReject?.(new Error('NODE_TRANSPORT_CLOSED_BEFORE_HELLO'))
      this.helloReject = undefined
      this.helloResolve = undefined
      for (const pending of this.pending.values()) {
        pending.reject(new Error('NODE_TRANSPORT_CLOSED'))
      }
      this.pending.clear()
    })
  }

  async waitForHello(): Promise<NodeHelloMessage> {
    const [, hello] = await Promise.all([this.ready, this.helloReady])
    return structuredClone(hello)
  }

  async request(message: NodeInvokeRequest, signal?: AbortSignal): Promise<NodeProviderReceipt> {
    await this.ready
    if (signal?.aborted) throw new Error('NODE_TRANSPORT_ABORTED')
    return new Promise<NodeProviderReceipt>((resolve, reject) => {
      const abort = () => {
        void this.cancel({
          protocolVersion: 1,
          type: 'cancel',
          messageId: randomUUID(),
          invocationId: message.invocationId,
          sourceNodeId: message.sourceNodeId,
          targetNodeId: message.targetNodeId,
          reason: 'AbortSignal',
        })
      }
      const doneResolve = (receipt: NodeProviderReceipt) => {
        signal?.removeEventListener('abort', abort)
        resolve(receipt)
      }
      const doneReject = (error: Error) => {
        signal?.removeEventListener('abort', abort)
        reject(error)
      }
      this.pending.set(message.invocationId, { resolve: doneResolve, reject: doneReject })
      signal?.addEventListener('abort', abort, { once: true })
      this.socket.send(JSON.stringify(message))
    })
  }

  async cancel(message: NodeCancelRequest): Promise<void> {
    await this.ready
    this.socket.send(JSON.stringify(message))
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      this.socket.once('close', resolve)
      this.socket.close()
    })
  }

  private handle(raw: string): void {
    const message = JSON.parse(raw) as NodeTransportMessage
    if (message.type === 'hello') {
      this.hello = message
      this.helloResolve?.(message)
      this.helloResolve = undefined
      this.helloReject = undefined
      return
    }
    if (message.type === 'receipt') {
      this.pending.get(message.invocationId)?.resolve(message.receipt)
      this.pending.delete(message.invocationId)
      return
    }
    if (message.type === 'error' && message.invocationId) {
      this.pending
        .get(message.invocationId)
        ?.reject(new Error(`${message.code}: ${message.message}`))
      this.pending.delete(message.invocationId)
    }
  }
}
