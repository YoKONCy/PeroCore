/**
 * applicationCapabilityClient — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  ApplicationCapabilityRequirement,
  KernelCapabilityId,
  KernelCapabilityOffer,
  KernelNodeId,
} from '@infos/shared'
import type { BoundCapabilityPort, CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'

export class ApplicationCapabilityClient {
  private readonly scope: LifecycleScope
  private readonly ports = new Map<string, BoundCapabilityPort>()
  private readonly handles: KernelCapabilityId[] = []

  constructor(
    readonly principalId: string,
    readonly appNodeId: KernelNodeId,
    private readonly localNodeId: KernelNodeId,
    private readonly directory: CapabilityDirectory,
    private readonly registry: CapabilityHandleRegistry,
  ) {
    this.scope = new LifecycleScope(`application-capabilities:${principalId}`)
  }

  bind(requirement: ApplicationCapabilityRequirement): BoundCapabilityPort | undefined {
    const existing = this.ports.get(requirement.capabilityType)
    if (existing) return existing
    const offer = this.selectOffer(requirement)
    if (!offer) {
      if (requirement.required) {
        throw new Error(`APPLICATION_CAPABILITY_UNAVAILABLE: ${requirement.capabilityType}`)
      }
      return undefined
    }
    const handle = this.registry.issue({
      subjectId: this.principalId,
      issuerNodeId: this.localNodeId,
      subjectNodeId: this.appNodeId,
      providerNodeId: offer.placement?.providerNodeId ?? offer.provider.authorityNodeId,
      revocationEpoch: 1,
      resource: offer.provider,
      operations: [...requirement.operations],
      scope: { appPrincipalId: this.principalId, reason: requirement.reason },
      revocable: true,
    })
    this.handles.push(handle.handleId)
    const bound = this.directory.bind({
      requirement: {
        requirementId: `${this.principalId}:${requirement.capabilityType}`,
        capabilityType: requirement.capabilityType,
        contractVersion: requirement.contractVersion,
        operations: requirement.operations,
        required: requirement.required,
        binding: 'eager',
        cardinality: 'one',
      },
      handleId: handle.handleId,
      scope: this.scope,
      principalId: this.principalId,
    })
    const port: BoundCapabilityPort = Object.freeze({
      bindingId: bound.bindingId,
      offer: bound.offer,
      invoke: <TInput, TOutput>(
        operation: string,
        value: TInput,
        context: Parameters<BoundCapabilityPort['invoke']>[2],
      ) =>
        bound.invoke<TInput, TOutput>(operation, value, {
          ...context,
          principalId: this.principalId,
          sourceNodeId: this.appNodeId,
        }),
      dispose: () => bound.dispose(),
    })
    this.ports.set(requirement.capabilityType, port)
    return port
  }

  get(capabilityType: string): BoundCapabilityPort | undefined {
    return this.ports.get(capabilityType)
  }

  async dispose(): Promise<void> {
    this.handles.forEach((handleId) => this.registry.revoke(handleId))
    this.handles.length = 0
    this.ports.clear()
    await this.scope.dispose()
  }

  private selectOffer(
    requirement: ApplicationCapabilityRequirement,
  ): KernelCapabilityOffer | undefined {
    return this.directory
      .listOffers({
        requirementId: `${this.principalId}:${requirement.capabilityType}`,
        capabilityType: requirement.capabilityType,
        contractVersion: requirement.contractVersion,
        operations: requirement.operations,
        required: requirement.required,
        binding: 'eager',
        cardinality: 'one',
      })
      .find((offer) => offer.health === 'available')
  }
}
