/**
 * capabilityDirectory — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import type {
  KernelCallContext,
  KernelCapabilityDefinition,
  KernelCapabilityId,
  KernelCapabilityOffer,
  KernelCapabilityRequirement,
  KernelEnvelope,
  KernelNodeId,
} from '@infos/shared'
import type { PlacementResolver } from './placementResolver'
import type { CapabilityHandleRegistry } from './capabilityHandleRegistry'
import type { LifecycleScope } from './lifecycleScope'
import { assertKernelDeadline, createKernelEnvelope } from './kernelEnvelope'

export type CapabilityProviderInvoke = (
  envelope: KernelEnvelope<{ operation: string; input: unknown }>,
) => Promise<unknown>

interface ProviderRegistration {
  offer: KernelCapabilityOffer
  invoke: CapabilityProviderInvoke
  remoteAdapter: boolean
}

/** Consumer 唯一可见的跨 Package 调用接口，不暴露 Provider 实例。 */
export interface BoundCapabilityPort {
  readonly bindingId: string
  readonly offer: KernelCapabilityOffer
  invoke<TInput = unknown, TOutput = unknown>(
    operation: string,
    input: TInput,
    context: KernelCallContext,
  ): Promise<TOutput>
  dispose(): Promise<void>
}

/** Capability 契约、在线 Offer 与受控绑定目录。 */
export class CapabilityDirectory {
  private readonly definitions = new Map<string, KernelCapabilityDefinition>()
  private readonly providers = new Map<string, ProviderRegistration>()
  private readonly listeners = new Set<() => void | Promise<void>>()

  constructor(
    private readonly handles: CapabilityHandleRegistry,
    private readonly placementResolver?: PlacementResolver,
    private readonly localNodeId?: KernelNodeId,
  ) {}

  subscribe(listener: () => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) Promise.resolve(listener()).catch(() => undefined)
  }

  hasDefinition(capabilityType: string, contractVersion: string): boolean {
    return this.definitions.has(this.definitionKey(capabilityType, contractVersion))
  }

  registerDefinition(definition: KernelCapabilityDefinition): () => void {
    const key = this.definitionKey(definition.capabilityType, definition.contractVersion)
    if (this.definitions.has(key)) throw new Error(`Capability Definition 已注册: ${key}`)
    this.definitions.set(key, Object.freeze(definition))
    return () => {
      if (this.definitions.get(key) === definition) this.definitions.delete(key)
    }
  }

  registerProvider(offer: KernelCapabilityOffer, invoke: CapabilityProviderInvoke): () => void {
    return this.register(offer, invoke, false)
  }

  registerRemoteProvider(
    offer: KernelCapabilityOffer,
    invoke: CapabilityProviderInvoke,
  ): () => void {
    if (!offer.placement || offer.placement.providerNodeId === this.localNodeId) {
      throw new Error('REMOTE_PROVIDER_PLACEMENT_INVALID: 远程 Provider 必须指向其他 Node')
    }
    return this.register(offer, invoke, true)
  }

  private register(
    offer: KernelCapabilityOffer,
    invoke: CapabilityProviderInvoke,
    remoteAdapter: boolean,
  ): () => void {
    const definition = this.getDefinition(offer.capabilityType, offer.contractVersion)
    if (!definition) throw new Error(`缺少 Capability Definition: ${offer.capabilityType}`)
    for (const operation of offer.operations) {
      if (!definition.operations[operation])
        throw new Error(`Provider 声明了未知操作: ${operation}`)
    }
    if (this.providers.has(offer.offerId))
      throw new Error(`Capability Offer 已注册: ${offer.offerId}`)
    const registration = { offer: Object.freeze({ ...offer }), invoke, remoteAdapter }
    this.providers.set(offer.offerId, registration)
    this.notify()
    return () => {
      if (this.providers.get(offer.offerId) === registration) {
        this.providers.delete(offer.offerId)
        this.notify()
      }
    }
  }

  listOffers(requirement?: KernelCapabilityRequirement): KernelCapabilityOffer[] {
    const now = Date.now()
    return [...this.providers.values()]
      .map((item) => item.offer)
      .filter((offer) => !offer.leaseExpiresAt || Date.parse(offer.leaseExpiresAt) > now)
      .filter((offer) => !requirement || this.matches(offer, requirement))
  }

  renewNodeOffers(nodeId: KernelNodeId, leaseExpiresAt: string): void {
    let changed = false
    for (const registration of this.providers.values()) {
      if (registration.offer.placement?.providerNodeId !== nodeId) continue
      registration.offer = Object.freeze({ ...registration.offer, leaseExpiresAt })
      changed = true
    }
    if (changed) this.notify()
  }

  bind(input: {
    requirement: KernelCapabilityRequirement
    handleId: KernelCapabilityId
    scope: LifecycleScope
    principalId?: string
  }): BoundCapabilityPort {
    const matching = [...this.providers.values()].filter(
      (provider) =>
        provider.offer.health === 'available' &&
        (!provider.offer.leaseExpiresAt ||
          Date.parse(provider.offer.leaseExpiresAt) > Date.now()) &&
        this.matches(provider.offer, input.requirement),
    )
    let registration: ProviderRegistration | undefined
    if (input.requirement.placement || matching.some((provider) => provider.offer.placement)) {
      if (!this.placementResolver) {
        throw new Error('PLACEMENT_RESOLVER_REQUIRED: Node-scoped Offer 需要 PlacementResolver')
      }
      const resolution = this.placementResolver.resolve({
        requirement: input.requirement,
        offers: matching.map((provider) => provider.offer),
        principalId: input.principalId,
      })
      registration = matching.find(
        (provider) => provider.offer.offerId === resolution.offer.offerId,
      )
    } else {
      registration = matching[0]
    }
    if (!registration)
      throw new Error(`CAPABILITY_UNAVAILABLE: ${input.requirement.capabilityType}`)
    const definition = this.getDefinition(
      input.requirement.capabilityType,
      input.requirement.contractVersion,
    )!
    let active = true
    const bindingId = randomUUID()
    const dispose = input.scope.defer(() => {
      active = false
    })
    return Object.freeze({
      bindingId,
      offer: registration.offer,
      invoke: async <TInput, TOutput>(
        operation: string,
        value: TInput,
        context: KernelCallContext,
      ): Promise<TOutput> => {
        if (!active) throw new Error('CAPABILITY_PORT_CLOSED: Port 已释放')
        assertKernelDeadline(context)
        const current = this.providers.get(registration.offer.offerId)
        if (
          current !== registration ||
          current.offer.health !== 'available' ||
          (current.offer.leaseExpiresAt && Date.parse(current.offer.leaseExpiresAt) <= Date.now())
        ) {
          throw new Error('CAPABILITY_PROVIDER_UNAVAILABLE: Provider 已离线或 Offer Lease 已过期')
        }
        if (
          !input.requirement.operations.includes(operation) ||
          !definition.operations[operation]
        ) {
          throw new Error(`CAPABILITY_OPERATION_DENIED: ${operation}`)
        }
        this.handles.assertAllows(input.handleId, registration.offer.provider, operation)
        const targetNodeId = registration.offer.placement?.providerNodeId
        if (
          targetNodeId &&
          this.localNodeId &&
          targetNodeId !== this.localNodeId &&
          !registration.remoteAdapter
        ) {
          throw new Error('NODE_TRANSPORT_UNAVAILABLE: 远程 Node Transport 尚未配置')
        }
        const envelope = createKernelEnvelope({
          context: {
            ...context,
            capabilityHandleId: input.handleId,
            sourceNodeId: context.sourceNodeId ?? this.localNodeId,
            targetNodeId,
          },
          operation: `${registration.offer.capabilityType}/${operation}`,
          payload: { operation, input: value },
          object: registration.offer.provider,
        })
        return (await registration.invoke(envelope)) as TOutput
      },
      dispose,
    })
  }

  private getDefinition(type: string, version: string): KernelCapabilityDefinition | undefined {
    return this.definitions.get(this.definitionKey(type, version))
  }

  private definitionKey(type: string, version: string): string {
    return `${type}@${version}`
  }

  private matches(offer: KernelCapabilityOffer, requirement: KernelCapabilityRequirement): boolean {
    return (
      offer.capabilityType === requirement.capabilityType &&
      offer.contractVersion === requirement.contractVersion &&
      requirement.operations.every((operation) => offer.operations.includes(operation))
    )
  }
}
