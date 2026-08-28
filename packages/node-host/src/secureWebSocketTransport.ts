import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpsServer } from 'node:https'
import { WebSocket, WebSocketServer } from 'ws'
import {
  negotiateKernelProtocol,
  validateKernelEnvelope,
  validateVersionedMessage,
  type KernelNodeId,
} from '@infos/shared'
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
import type { PersistentNodeTrustStore } from './trustStore'
import { ChunkedNodeTransferRegistry } from './chunkedTransfer'

export interface NodeTlsServerOptions {
  host?: string
  port?: number
  key: string | Buffer
  cert: string | Buffer
  ca?: string | Buffer | Array<string | Buffer>
  requestCert?: boolean
  rejectUnauthorized?: boolean
  leaseMs?: number
}

/** 生产远程Node的WSS服务端；证书链与Node Certificate必须同时通过。 */
export class SecureWebSocketNodeServer {
  private https?: HttpsServer
  private ws?: WebSocketServer
  private readonly transfers = new ChunkedNodeTransferRegistry()

  constructor(
    private readonly runtime: NodeProviderRuntime,
    private readonly hello: NodeHelloMessage,
    private readonly trustStore: PersistentNodeTrustStore,
    private readonly onTransfer?: (transferId: string, bytes: Buffer) => Promise<void> | void,
  ) {}

  async listen(options: NodeTlsServerOptions): Promise<number> {
    if (this.https) throw new Error('NODE_WSS_ALREADY_LISTENING')
    this.https = createServer({
      key: options.key,
      cert: options.cert,
      ca: options.ca,
      requestCert: options.requestCert ?? true,
      rejectUnauthorized: options.rejectUnauthorized ?? true,
    })
    this.ws = new WebSocketServer({ server: this.https })
    this.ws.on('connection', (socket) => this.accept(socket, options.leaseMs ?? 30_000))
    await new Promise<void>((resolve, reject) => {
      this.https!.once('error', reject)
      this.https!.listen(options.port ?? 0, options.host ?? '0.0.0.0', resolve)
    })
    const address = this.https.address()
    if (!address || typeof address === 'string') throw new Error('NODE_WSS_ADDRESS_UNAVAILABLE')
    return address.port
  }

  private accept(socket: WebSocket, leaseMs: number): void {
    let authenticated = false
    let leaseExpiresAt = Date.now() + leaseMs
    const lease = setInterval(
      () => {
        if (Date.now() >= leaseExpiresAt) socket.close(4001, 'Node lease expired')
        else socket.ping()
      },
      Math.max(1_000, Math.floor(leaseMs / 3)),
    )
    lease.unref?.()

    socket.on('pong', () => {
      leaseExpiresAt = Date.now() + leaseMs
    })
    socket.on('close', () => clearInterval(lease))
    socket.on('message', (data) => {
      const raw = String(data)
      if (!authenticated) {
        try {
          const remoteHello = JSON.parse(raw) as NodeHelloMessage
          validateVersionedMessage(remoteHello)
          if (remoteHello.type !== 'hello') throw new Error('NODE_HELLO_REQUIRED')
          const agreedVersion = negotiateKernelProtocol(
            remoteHello.supportedVersions ?? [remoteHello.protocolVersion],
          )
          this.trustStore.assertTrusted({
            nodeId: remoteHello.descriptor.nodeId,
            publicKeyFingerprint: remoteHello.descriptor.publicKeyFingerprint,
            certificate: remoteHello.certificate,
          })
          authenticated = true
          socket.send(JSON.stringify({ ...this.hello, agreedVersion }))
        } catch (error) {
          socket.close(4003, error instanceof Error ? error.message : 'Node authentication failed')
        }
        return
      }
      leaseExpiresAt = Date.now() + leaseMs
      void this.handle(socket, raw)
    })
  }

  private async handle(socket: WebSocket, raw: string): Promise<void> {
    let message: NodeTransportMessage
    try {
      message = JSON.parse(raw) as NodeTransportMessage
      validateVersionedMessage(message)
      if (message.type === 'invoke') validateKernelEnvelope(message.envelope)
    } catch (error) {
      socket.send(
        JSON.stringify(
          this.error(
            'NODE_MESSAGE_INVALID',
            error instanceof Error ? error.message : '消息不是合法JSON',
          ),
        ),
      )
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
      } else if (message.type === 'transfer.begin') {
        this.transfers.begin(message.manifest)
        this.sendTransferReceipt(
          socket,
          message,
          this.transfers.nextMissingIndex(message.manifest.transferId),
          false,
        )
      } else if (message.type === 'transfer.chunk') {
        const next = this.transfers.accept(message.chunk)
        this.sendTransferReceipt(socket, message, next, false)
      } else if (message.type === 'transfer.complete') {
        const bytes = this.transfers.complete(message.transferId)
        await this.onTransfer?.(message.transferId, bytes)
        this.sendTransferReceipt(socket, message, Number.MAX_SAFE_INTEGER, true)
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

  private sendTransferReceipt(
    socket: WebSocket,
    message: {
      sourceNodeId: KernelNodeId
      targetNodeId: KernelNodeId
      manifest?: { transferId: string }
      chunk?: { transferId: string }
      transferId?: string
    },
    nextMissingIndex: number,
    completed: boolean,
  ): void {
    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'transfer.receipt',
        messageId: randomUUID(),
        sourceNodeId: message.targetNodeId,
        targetNodeId: message.sourceNodeId,
        transferId: message.transferId ?? message.manifest?.transferId ?? message.chunk?.transferId,
        nextMissingIndex,
        completed,
      }),
    )
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

  async close(): Promise<void> {
    for (const socket of this.ws?.clients ?? []) socket.close()
    await new Promise<void>((resolve) => this.ws?.close(() => resolve()) ?? resolve())
    await new Promise<void>(
      (resolve, reject) =>
        this.https?.close((error) => (error ? reject(error) : resolve())) ?? resolve(),
    )
    this.ws = undefined
    this.https = undefined
  }
}

export interface SecureNodeTransportOptions {
  url: string
  hello: NodeHelloMessage
  ca: string | Buffer | Array<string | Buffer>
  cert: string | Buffer
  key: string | Buffer
  rejectUnauthorized?: boolean
}

/** 远程WSS Node Transport；断线后拒绝所有在飞调用，禁止静默重放副作用。 */
export class SecureWebSocketNodeTransport implements NodeTransport {
  readonly localNodeId: KernelNodeId
  private socket?: WebSocket
  private ready?: Promise<void>
  private readonly pending = new Map<
    string,
    { resolve(receipt: NodeProviderReceipt): void; reject(error: Error): void }
  >()
  private readonly transferReceipts = new Map<
    string,
    {
      resolve(value: { nextMissingIndex: number; completed: boolean }): void
      reject(error: Error): void
    }
  >()
  private readonly transfers = new ChunkedNodeTransferRegistry()

  constructor(private readonly options: SecureNodeTransportOptions) {
    this.localNodeId = options.hello.descriptor.nodeId
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    const socket = new WebSocket(this.options.url, {
      ca: this.options.ca,
      cert: this.options.cert,
      key: this.options.key,
      rejectUnauthorized: this.options.rejectUnauthorized ?? true,
    })
    this.socket = socket
    this.ready = new Promise<void>((resolve, reject) => {
      socket.once('open', () => socket.send(JSON.stringify(this.options.hello)))
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(String(data)) as NodeTransportMessage
        validateVersionedMessage(message)
        if (message.type !== 'hello') return
        if (message.agreedVersion !== 1) throw new Error('KERNEL_PROTOCOL_AGREEMENT_REQUIRED')
        socket.off('message', onMessage)
        socket.on('message', (next) => this.handle(String(next)))
        resolve()
      }
      socket.on('message', onMessage)
      socket.once('error', reject)
      socket.once('close', (code, reason) => {
        reject(new Error(`NODE_TRANSPORT_CLOSED: ${code} ${String(reason)}`))
        this.rejectPending(new Error('NODE_TRANSPORT_CLOSED_UNCERTAIN_OUTCOME'))
      })
    })
    return this.ready
  }

  async request(message: NodeInvokeRequest, signal?: AbortSignal): Promise<NodeProviderReceipt> {
    await this.connect()
    if (signal?.aborted) throw new Error('NODE_TRANSPORT_ABORTED')
    return new Promise((resolve, reject) => {
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
      this.pending.set(message.invocationId, {
        resolve: (receipt) => {
          signal?.removeEventListener('abort', abort)
          resolve(receipt)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort)
          reject(error)
        },
      })
      signal?.addEventListener('abort', abort, { once: true })
      this.socket!.send(JSON.stringify(message))
    })
  }

  async transfer(
    targetNodeId: KernelNodeId,
    bytes: Uint8Array,
    options: { chunkSize?: number; resumeFrom?: number } = {},
  ): Promise<string> {
    await this.connect()
    const manifest = this.transfers.createManifest(bytes, options.chunkSize)
    const chunks = this.transfers.chunks(manifest, bytes)
    let receipt = await this.sendTransferMessage(manifest.transferId, {
      protocolVersion: 1,
      type: 'transfer.begin',
      messageId: randomUUID(),
      sourceNodeId: this.localNodeId,
      targetNodeId,
      manifest,
    })
    let next = Math.max(receipt.nextMissingIndex, options.resumeFrom ?? 0)
    while (next < chunks.length) {
      receipt = await this.sendTransferMessage(manifest.transferId, {
        protocolVersion: 1,
        type: 'transfer.chunk',
        messageId: randomUUID(),
        sourceNodeId: this.localNodeId,
        targetNodeId,
        chunk: chunks[next]!,
      })
      next = receipt.nextMissingIndex
    }
    receipt = await this.sendTransferMessage(manifest.transferId, {
      protocolVersion: 1,
      type: 'transfer.complete',
      messageId: randomUUID(),
      sourceNodeId: this.localNodeId,
      targetNodeId,
      transferId: manifest.transferId,
    })
    if (!receipt.completed) throw new Error('TRANSFER_REMOTE_INCOMPLETE')
    return manifest.transferId
  }

  private sendTransferMessage(
    transferId: string,
    message: NodeTransportMessage,
  ): Promise<{ nextMissingIndex: number; completed: boolean }> {
    const existing = this.transferReceipts.get(transferId)
    if (existing) throw new Error('TRANSFER_RECEIPT_PENDING')
    return new Promise((resolve, reject) => {
      this.transferReceipts.set(transferId, { resolve, reject })
      this.socket!.send(JSON.stringify(message), (error) => {
        if (!error) return
        this.transferReceipts.delete(transferId)
        reject(error)
      })
    })
  }

  async cancel(message: NodeCancelRequest): Promise<void> {
    await this.connect()
    this.socket!.send(JSON.stringify(message))
  }

  private handle(raw: string): void {
    const message = JSON.parse(raw) as NodeTransportMessage
    if (message.type === 'receipt') {
      const pending = this.pending.get(message.invocationId)
      if (!pending) return
      this.pending.delete(message.invocationId)
      pending.resolve(message.receipt)
    } else if (message.type === 'transfer.receipt') {
      const pending = this.transferReceipts.get(message.transferId)
      if (!pending) return
      this.transferReceipts.delete(message.transferId)
      pending.resolve({ nextMissingIndex: message.nextMissingIndex, completed: message.completed })
    } else if (message.type === 'error' && message.invocationId) {
      const pending = this.pending.get(message.invocationId)
      if (!pending) return
      this.pending.delete(message.invocationId)
      pending.reject(new Error(`${message.code}: ${message.message}`))
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const pending of this.transferReceipts.values()) pending.reject(error)
    this.transferReceipts.clear()
  }

  async close(): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      socket.once('close', resolve)
      socket.close()
    })
    this.socket = undefined
    this.ready = undefined
  }
}
