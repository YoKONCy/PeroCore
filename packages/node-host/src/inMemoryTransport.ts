import type { NodeCancelRequest, NodeInvokeRequest, NodeTransport } from '@infos/node-sdk'
import type { NodeProviderRuntime } from './providerRuntime'

export class InMemoryNodeTransport implements NodeTransport {
  readonly localNodeId

  constructor(
    localNodeId: NodeTransport['localNodeId'],
    private readonly runtime: NodeProviderRuntime,
  ) {
    this.localNodeId = localNodeId
  }

  request(message: NodeInvokeRequest, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new Error('NODE_TRANSPORT_ABORTED'))
    const abort = () => void this.runtime.cancel(message.invocationId)
    signal?.addEventListener('abort', abort, { once: true })
    return this.runtime.invoke(message).finally(() => signal?.removeEventListener('abort', abort))
  }

  async cancel(message: NodeCancelRequest): Promise<void> {
    await this.runtime.cancel(message.invocationId)
  }

  async close(): Promise<void> {}
}
