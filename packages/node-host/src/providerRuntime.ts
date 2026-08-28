import type { KernelEnvelope, KernelNodeDescriptor } from '@infos/shared'
import type { NodeInvokeRequest, NodeProvider, NodeProviderReceipt } from '@infos/node-sdk'

interface ActiveInvocation {
  controller: AbortController
  provider: NodeProvider
}

/** Node Host 内唯一 Provider 生命周期与 Invocation 执行器。 */
export class NodeProviderRuntime {
  private readonly providers = new Map<string, NodeProvider>()
  private readonly active = new Map<string, ActiveInvocation>()
  private readonly receipts = new Map<string, NodeProviderReceipt>()
  private started = false

  constructor(readonly node: KernelNodeDescriptor) {}

  register(provider: NodeProvider): () => void {
    const id = provider.manifest.providerId
    if (this.providers.has(id)) throw new Error(`NODE_PROVIDER_DUPLICATE: ${id}`)
    if (provider.manifest.manifestVersion !== 1) {
      throw new Error(`NODE_PROVIDER_MANIFEST_UNSUPPORTED: ${id}`)
    }
    const operations = provider.manifest.offer.operations
    for (const operation of operations) {
      if (!provider.manifest.definition.operations[operation]) {
        throw new Error(`NODE_PROVIDER_OPERATION_UNKNOWN: ${operation}`)
      }
    }
    this.providers.set(id, provider)
    if (this.started) void provider.start?.({ node: this.node })
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const provider of this.providers.values()) await provider.start?.({ node: this.node })
  }

  async invoke(request: NodeInvokeRequest): Promise<NodeProviderReceipt> {
    if (!this.started) throw new Error('NODE_HOST_NOT_STARTED: Node Host 尚未启动')
    if (request.targetNodeId !== this.node.nodeId) {
      throw new Error('NODE_TARGET_MISMATCH: Invocation 目标 Node 不匹配')
    }
    const cached = request.envelope.idempotencyKey
      ? this.receipts.get(this.idempotencyKey(request.providerId, request.envelope.idempotencyKey))
      : undefined
    if (cached) return structuredClone(cached)
    const provider = this.providers.get(request.providerId)
    if (!provider) throw new Error(`NODE_PROVIDER_NOT_FOUND: ${request.providerId}`)
    const health = (await provider.health?.()) ?? 'available'
    if (health === 'unavailable')
      throw new Error(`NODE_PROVIDER_UNAVAILABLE: ${request.providerId}`)
    const acceptedAt = new Date().toISOString()
    const controller = new AbortController()
    this.active.set(request.invocationId, { controller, provider })
    const startedAt = new Date().toISOString()
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    if (request.envelope.deadline) {
      const remaining = Date.parse(request.envelope.deadline) - Date.now()
      if (remaining <= 0) controller.abort('deadline')
      else deadlineTimer = setTimeout(() => controller.abort('deadline'), remaining)
    }
    let receipt: NodeProviderReceipt
    try {
      if (controller.signal.aborted) throw new Error('NODE_INVOCATION_DEADLINE_EXCEEDED')
      const output = await provider.invoke(
        request.envelope as KernelEnvelope<{ operation: string; input: unknown }>,
        {
          node: this.node,
          signal: controller.signal,
          deadline: request.envelope.deadline,
          idempotencyKey: request.envelope.idempotencyKey,
          invocationId: request.invocationId,
        },
      )
      if (controller.signal.aborted) throw new Error('NODE_INVOCATION_CANCELLED')
      receipt = {
        invocationId: request.invocationId,
        providerId: request.providerId,
        state: 'completed',
        acceptedAt,
        startedAt,
        completedAt: new Date().toISOString(),
        output,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const timedOut = controller.signal.reason === 'deadline' || message.includes('DEADLINE')
      const cancelled = controller.signal.aborted && !timedOut
      receipt = {
        invocationId: request.invocationId,
        providerId: request.providerId,
        state: timedOut ? 'timed_out' : cancelled ? 'cancelled' : 'failed',
        acceptedAt,
        startedAt,
        completedAt: new Date().toISOString(),
        error: {
          code: timedOut
            ? 'NODE_INVOCATION_DEADLINE_EXCEEDED'
            : cancelled
              ? 'NODE_INVOCATION_CANCELLED'
              : 'NODE_PROVIDER_FAILED',
          message,
          retryable: timedOut || cancelled,
        },
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer)
      this.active.delete(request.invocationId)
    }
    if (request.envelope.idempotencyKey && receipt.state === 'completed') {
      this.receipts.set(
        this.idempotencyKey(request.providerId, request.envelope.idempotencyKey),
        receipt,
      )
    }
    return structuredClone(receipt)
  }

  async cancel(invocationId: string): Promise<void> {
    const active = this.active.get(invocationId)
    if (!active) return
    active.controller.abort('cancelled')
    await active.provider.cancel?.(invocationId)
  }

  listOffers() {
    return [...this.providers.values()].map((provider) => provider.manifest)
  }

  async stop(): Promise<void> {
    for (const invocationId of [...this.active.keys()]) await this.cancel(invocationId)
    for (const provider of [...this.providers.values()].reverse()) await provider.stop?.()
    this.started = false
  }

  private idempotencyKey(providerId: string, key: string): string {
    return `${providerId}:${key}`
  }
}
