/**
 * placementResolver — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  KernelCapabilityOffer,
  KernelCapabilityRequirement,
  KernelInputSeat,
  KernelNodeDescriptor,
  KernelNodePlacement,
  KernelNodeTrust,
} from '@infos/shared'
import type { NodeRegistry } from './nodeRegistry'

const TRUST_ORDER: KernelNodeTrust[] = ['untrusted', 'paired', 'managed', 'local']
const LATENCY_ORDER: NonNullable<KernelNodePlacement['latencyClass']>[] = [
  'local',
  'lan',
  'wan',
  'batch',
]
const COST_ORDER: NonNullable<KernelNodePlacement['costClass']>[] = ['free', 'metered', 'expensive']

export interface PlacementResolution {
  offer: KernelCapabilityOffer
  node: KernelNodeDescriptor
  inputSeat?: KernelInputSeat
  score: number
}

/** Capability Requirement 到健康 Node Offer 的确定性 Placement Resolver。 */
export class PlacementResolver {
  constructor(private readonly nodes: NodeRegistry) {}

  resolve(input: {
    requirement: KernelCapabilityRequirement
    offers: readonly KernelCapabilityOffer[]
    principalId?: string
  }): PlacementResolution {
    const candidates = input.offers
      .map((offer) => this.evaluate(offer, input.requirement, input.principalId))
      .filter((candidate): candidate is PlacementResolution => candidate !== null)
      .sort(
        (left, right) =>
          right.score - left.score || left.offer.offerId.localeCompare(right.offer.offerId),
      )
    if (!candidates[0]) {
      throw new Error(`PLACEMENT_UNAVAILABLE: ${input.requirement.capabilityType}`)
    }
    return candidates[0]
  }

  private evaluate(
    offer: KernelCapabilityOffer,
    requirement: KernelCapabilityRequirement,
    principalId?: string,
  ): PlacementResolution | null {
    const placement = offer.placement
    if (!placement || offer.health !== 'available') return null
    if (placement.leaseExpiresAt && Date.parse(placement.leaseExpiresAt) <= Date.now()) return null
    const node = this.nodes.getNode(placement.providerNodeId)
    const session = this.nodes.getActiveSession(placement.providerNodeId)
    if (!node || !session || session.health === 'offline') return null
    if (!node.facets.includes(placement.providerFacet)) return null
    const wanted = requirement.placement
    if (
      wanted?.executionLocations?.length &&
      !wanted.executionLocations.includes(placement.executionLocation)
    )
      return null
    if (wanted?.providerFacets?.length && !wanted.providerFacets.includes(placement.providerFacet))
      return null
    if (wanted?.preferredNodeId && wanted.preferredNodeId !== placement.providerNodeId) return null
    if (wanted?.authorityNodeId && wanted.authorityNodeId !== placement.resourceAuthorityNodeId)
      return null
    if (wanted?.requiresClientPresence && !placement.requiresClientPresence) return null
    if (wanted?.requiresInputSeat && !placement.requiresInputSeat) return null
    if (wanted?.supportsHeadless && !placement.supportsHeadless) return null
    if (wanted?.dataResidency && wanted.dataResidency !== placement.dataResidency) return null
    if (wanted?.networkZone && wanted.networkZone !== placement.networkZone) return null
    if (wanted?.platforms?.length && !wanted.platforms.includes(node.platform.os)) return null
    if (
      wanted?.minimumTrust &&
      TRUST_ORDER.indexOf(node.trust) < TRUST_ORDER.indexOf(wanted.minimumTrust)
    )
      return null
    if (
      wanted?.maxLatencyClass &&
      this.exceeds(placement.latencyClass, wanted.maxLatencyClass, LATENCY_ORDER)
    )
      return null
    if (wanted?.maxCostClass && this.exceeds(placement.costClass, wanted.maxCostClass, COST_ORDER))
      return null
    const inputSeat = placement.requiresInputSeat
      ? principalId
        ? this.nodes.getInputSeat(principalId, 'input')
        : null
      : undefined
    if (
      placement.requiresInputSeat &&
      (!inputSeat || inputSeat.nodeId !== placement.providerNodeId)
    )
      return null
    if (placement.requiresClientPresence && !node.facets.includes('client')) return null
    return {
      offer,
      node,
      inputSeat: inputSeat ?? undefined,
      score:
        (placement.executionLocation === 'node-local' ||
        placement.executionLocation.endsWith('-local')
          ? 20
          : 0) +
        (node.trust === 'local'
          ? 10
          : node.trust === 'managed'
            ? 7
            : node.trust === 'paired'
              ? 4
              : 0) +
        (placement.costClass === 'free' ? 3 : 0) +
        (placement.latencyClass === 'local' ? 3 : placement.latencyClass === 'lan' ? 2 : 0),
    }
  }

  private exceeds<T extends string>(
    actual: T | undefined,
    maximum: T,
    order: readonly T[],
  ): boolean {
    return actual !== undefined && order.indexOf(actual) > order.indexOf(maximum)
  }
}
