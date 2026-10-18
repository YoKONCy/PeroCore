/**
 * transport — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import { arcaKernelOrigin } from './hostBridge'
import type {
  NodeErrorMessage,
  NodeHelloMessage,
  NodeInvokeRequest,
  NodeProviderReceipt,
  NodeReceiptMessage,
  NodeTransportMessage,
} from '@infos/node-sdk'

interface PendingInvocation {
  resolve: (receipt: NodeProviderReceipt) => void
  reject: (error: Error) => void
}

export class ArcaBrowserTransport {
  private socket?: WebSocket
  private hello?: NodeHelloMessage
  private readonly pending = new Map<string, PendingInvocation>()
  private disconnectHandler?: () => void

  constructor(readonly localNodeId: KernelNodeId) {}

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }

  async connect(endpoint: string): Promise<NodeHelloMessage> {
    await this.close()
    return new Promise<NodeHelloMessage>((resolve, reject) => {
      const address = new URL(endpoint)
      const kernel = arcaKernelOrigin()
      if (
        kernel &&
        address.pathname === '/api/applications/arca/transport' &&
        address.origin === kernel.replace(/^http/, 'ws') &&
        window.location.origin === kernel
      ) {
        const token = sessionStorage.getItem('infos.currentServerToken')
        if (token) address.searchParams.set('token', token)
      }
      const socket = new WebSocket(address)
      this.socket = socket
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error('ARCA_HELLO_TIMEOUT'))
      }, 8_000)
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as NodeTransportMessage
        if (message.type === 'hello') {
          window.clearTimeout(timer)
          this.hello = message
          resolve(structuredClone(message))
          return
        }
        this.handle(message)
      })
      socket.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer)
          reject(new Error('ARCA_TRANSPORT_ERROR'))
        },
        { once: true },
      )
      socket.addEventListener('close', () => {
        window.clearTimeout(timer)
        if (this.socket !== socket) return
        this.hello = undefined
        reject(new Error('ARCA_TRANSPORT_CLOSED'))
        for (const invocation of this.pending.values()) {
          invocation.reject(new Error('ARCA_TRANSPORT_CLOSED'))
        }
        this.pending.clear()
        if (this.socket === socket) this.disconnectHandler?.()
      })
    })
  }

  async invoke(
    operation: string,
    input: unknown,
    options: { idempotencyKey?: string; providerId?: string } = {},
  ): Promise<unknown> {
    const socket = this.socket
    const hello = this.hello
    if (!socket || socket.readyState !== WebSocket.OPEN || !hello) {
      throw new Error('ARCA_TRANSPORT_NOT_READY')
    }
    const invocationId = crypto.randomUUID()
    const envelope: KernelEnvelope<{ operation: string; input: unknown }> = {
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      principalId: 'arca-client',
      operation,
      sourceNodeId: this.localNodeId,
      targetNodeId: hello.descriptor.nodeId,
      emittedAt: new Date().toISOString(),
      durability: 'ephemeral',
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      payload: { operation, input },
    }
    const request: NodeInvokeRequest = {
      protocolVersion: 1,
      type: 'invoke',
      messageId: crypto.randomUUID(),
      invocationId,
      sourceNodeId: this.localNodeId,
      targetNodeId: hello.descriptor.nodeId,
      providerId: options.providerId ?? 'infos.arca.document-authority',
      envelope,
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => {
          this.pending.delete(invocationId)
          reject(new Error('ARCA_INVOCATION_TIMEOUT: 请求回执超时，保存重试会核对原事务'))
        },
        operation === 'model.complete' ? 125_000 : 30_000,
      )
      this.pending.set(invocationId, {
        resolve: (receipt) => {
          window.clearTimeout(timer)
          if (receipt.state !== 'completed') {
            reject(new Error(receipt.error?.message ?? `ARCA_INVOCATION_${receipt.state}`))
            return
          }
          resolve(receipt.output)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      })
      try {
        socket.send(JSON.stringify(request))
      } catch (error) {
        this.pending
          .get(invocationId)
          ?.reject(error instanceof Error ? error : new Error('发送请求失败'))
        this.pending.delete(invocationId)
      }
    })
  }

  waitUntilClosed(timeoutMs = 30_000): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timer)
        resolve()
      }
      const timer = window.setTimeout(() => {
        socket.removeEventListener('close', finish)
        reject(new Error('停止尚未完成，请稍后重试'))
      }, timeoutMs)
      socket.addEventListener('close', finish, { once: true })
    })
  }

  async close(): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    this.hello = undefined
    this.disconnectHandler = undefined
    for (const invocation of this.pending.values())
      invocation.reject(new Error('ARCA_TRANSPORT_CLOSED'))
    this.pending.clear()
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    socket.close()
  }

  private handle(message: NodeTransportMessage): void {
    if (message.type === 'receipt') {
      const receipt = message as NodeReceiptMessage
      this.pending.get(receipt.invocationId)?.resolve(receipt.receipt)
      this.pending.delete(receipt.invocationId)
      return
    }
    if (message.type === 'error' && message.invocationId) {
      const error = message as NodeErrorMessage
      this.pending.get(message.invocationId)?.reject(new Error(`${error.code}: ${error.message}`))
      this.pending.delete(message.invocationId)
    }
  }
}
