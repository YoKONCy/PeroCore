import { randomUUID } from 'node:crypto'
import type { KernelCapabilityOffer, KernelEnvelope, KernelNodeId } from '@infos/shared'
import type { NodeProviderReceipt, NodeTransport } from '@infos/node-sdk'
import type { CapabilityDirectory } from './capabilityDirectory'
import type { LifecycleScope } from './lifecycleScope'

/** 将 NodeTransport 适配为 CapabilityDirectory Provider，不依赖具体 Node Host 实现。 */
export class NodeCapabilityBridge {
  constructor(
    private readonly localNodeId: KernelNodeId,
    private readonly transport: NodeTransport,
    private readonly onReceipt?: (receipt: NodeProviderReceipt) => void | Promise<void>,
  ) {}

  register(input: {
    directory: CapabilityDirectory
    offer: KernelCapabilityOffer
    providerId: string
    scope: LifecycleScope
  }): void {
    if (!input.offer.placement) throw new Error('NODE_OFFER_PLACEMENT_REQUIRED')
    if (input.offer.placement.providerNodeId === this.localNodeId) {
      throw new Error('NODE_BRIDGE_REMOTE_OFFER_REQUIRED: 本地 Offer 不应经过远程 Bridge')
    }
    input.scope.defer(
      input.directory.registerRemoteProvider(input.offer, (envelope) =>
        this.invoke(input.providerId, input.offer.placement!.providerNodeId, envelope),
      ),
    )
  }

  private async invoke(
    providerId: string,
    targetNodeId: KernelNodeId,
    envelope: KernelEnvelope<{ operation: string; input: unknown }>,
  ): Promise<unknown> {
    const invocationId = randomUUID()
    const receipt = await this.transport.request({
      protocolVersion: 1,
      type: 'invoke',
      messageId: randomUUID(),
      invocationId,
      sourceNodeId: this.localNodeId,
      targetNodeId,
      providerId,
      envelope: {
        ...envelope,
        sourceNodeId: this.localNodeId,
        targetNodeId,
        route: {
          sourceNodeId: this.localNodeId,
          targetNodeId,
          hopLimit: 8,
        },
      },
    })
    await this.onReceipt?.(receipt)
    return this.unwrap(receipt)
  }

  private unwrap(receipt: NodeProviderReceipt): unknown {
    if (receipt.state === 'completed') return receipt.output
    const error = new Error(
      `${receipt.error?.code ?? `NODE_INVOCATION_${receipt.state.toUpperCase()}`}: ${receipt.error?.message ?? receipt.state}`,
    )
    Object.assign(error, { receipt })
    throw error
  }
}
