import type { KernelCapabilityRequirement, KernelNodeId, WebPageOperation } from '@infos/shared'
import type { CapabilityDirectory, BoundCapabilityPort } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'
import type { ToolRegistry } from '../services/agent/toolRegistry'
import { createBrowserToolContributions } from '../tools/browserControl'

const REQUIREMENT: KernelCapabilityRequirement = {
  requirementId: 'kernel.browser-tools',
  capabilityType: 'web.page',
  contractVersion: '1.0',
  operations: [],
  required: false,
  binding: 'lazy',
  cardinality: 'one',
  placement: {
    executionLocations: ['client-local'],
    providerFacets: ['client', 'capability'],
    requiresClientPresence: true,
    dataResidency: 'device-only',
  },
}

/** 根据 CapabilityDirectory 中的 web.page Offer 管理 Browser Tool ABI。 */
export class BrowserToolRuntime {
  private scope?: LifecycleScope
  private port?: BoundCapabilityPort
  private unsubscribe?: () => void
  private syncing = false

  constructor(
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly tools: ToolRegistry,
    private readonly localNodeId: KernelNodeId,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = this.directory.subscribe(() => this.sync())
    await this.sync()
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.unregister()
  }

  private async sync(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    try {
      const offer = this.directory
        .listOffers(REQUIREMENT)
        .find((candidate) => candidate.health === 'available')
      if (offer && !this.port) await this.register(offer.provider.authorityNodeId)
      if (!offer && this.port) await this.unregister()
    } finally {
      this.syncing = false
    }
  }

  private async register(providerNodeId?: KernelNodeId): Promise<void> {
    const scope = new LifecycleScope('browser-tool-binding')
    const offer = this.directory
      .listOffers(REQUIREMENT)
      .find((candidate) => candidate.health === 'available')
    if (!offer) return
    const handle = this.handles.issue({
      subjectId: 'kernel.browser-tools',
      issuerNodeId: this.localNodeId,
      subjectNodeId: this.localNodeId,
      providerNodeId,
      revocationEpoch: 1,
      resource: offer.provider,
      operations: offer.operations,
      scope: { capabilityType: 'web.page', placement: 'client-local' },
      revocable: true,
    })
    scope.defer(() => {
      this.handles.revoke(handle.handleId)
    })
    const requirement: KernelCapabilityRequirement = {
      ...REQUIREMENT,
      operations: offer.operations,
      placement: { ...REQUIREMENT.placement, preferredNodeId: providerNodeId },
    }
    const port = this.directory.bind({
      requirement,
      handleId: handle.handleId,
      scope,
      principalId: 'system',
    })
    for (const contribution of createBrowserToolContributions(
      port,
      offer.operations as WebPageOperation[],
    )) {
      this.tools.register(contribution.definition, contribution.handler)
      scope.defer(() => {
        this.tools.unregister(contribution.definition.name)
      })
    }
    this.scope = scope
    this.port = port
  }

  private async unregister(): Promise<void> {
    const scope = this.scope
    this.scope = undefined
    this.port = undefined
    await scope?.dispose()
  }
}
