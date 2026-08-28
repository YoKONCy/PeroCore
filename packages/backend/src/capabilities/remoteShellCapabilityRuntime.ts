import type { KernelCallContext, KernelNodeId } from '@infos/shared'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'

const OPERATIONS = [
  'create',
  'list',
  'get',
  'read',
  'wait',
  'write',
  'interrupt',
  'kill',
  'close',
] as const
export type RemoteShellOperation = (typeof OPERATIONS)[number]

/** 按显式 nodeId 临时绑定远程 system.shell Offer。 */
export class RemoteShellCapabilityRuntime {
  constructor(
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly localNodeId: KernelNodeId,
  ) {}

  listNodes(): Array<{ nodeId: KernelNodeId; offerId: string }> {
    return this.directory
      .listOffers({
        requirementId: 'remote-shell-list',
        capabilityType: 'system.shell',
        contractVersion: '1.0',
        operations: [],
        required: false,
        binding: 'lazy',
        cardinality: 'many',
      })
      .filter((offer) => offer.health === 'available' && offer.placement?.providerNodeId)
      .map((offer) => ({
        nodeId: offer.placement!.providerNodeId,
        offerId: offer.offerId,
      }))
  }

  async invoke(
    nodeId: KernelNodeId,
    operation: RemoteShellOperation,
    input: unknown,
    context: KernelCallContext,
  ): Promise<unknown> {
    if (!OPERATIONS.includes(operation))
      throw new Error(`REMOTE_SHELL_OPERATION_INVALID: ${operation}`)
    const offer = this.directory
      .listOffers({
        requirementId: `remote-shell:${nodeId}`,
        capabilityType: 'system.shell',
        contractVersion: '1.0',
        operations: [operation],
        required: true,
        binding: 'lazy',
        cardinality: 'one',
        placement: {
          preferredNodeId: nodeId,
          executionLocations: ['remote-capability-node'],
          providerFacets: ['capability'],
          supportsHeadless: true,
          minimumTrust: 'paired',
        },
      })
      .find((candidate) => candidate.placement?.providerNodeId === nodeId)
    if (!offer) throw new Error(`REMOTE_SHELL_NODE_UNAVAILABLE: ${nodeId}`)

    const scope = new LifecycleScope(`remote-shell:${nodeId}:${operation}`)
    try {
      const handle = this.handles.issue({
        subjectId: context.principalId,
        issuerNodeId: this.localNodeId,
        subjectNodeId: this.localNodeId,
        providerNodeId: nodeId,
        revocationEpoch: 1,
        resource: offer.provider,
        operations: [operation],
        scope: { capabilityType: 'system.shell', nodeId },
        revocable: true,
      })
      scope.defer(() => {
        this.handles.revoke(handle.handleId)
      })
      const port = this.directory.bind({
        requirement: {
          requirementId: `remote-shell:${nodeId}:${operation}`,
          capabilityType: 'system.shell',
          contractVersion: '1.0',
          operations: [operation],
          required: true,
          binding: 'eager',
          cardinality: 'one',
          placement: {
            preferredNodeId: nodeId,
            executionLocations: ['remote-capability-node'],
            providerFacets: ['capability'],
            supportsHeadless: true,
            minimumTrust: 'paired',
          },
        },
        handleId: handle.handleId,
        scope,
        principalId: context.principalId,
      })
      return await port.invoke(operation, input, context)
    } finally {
      await scope.dispose()
    }
  }
}
