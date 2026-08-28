import type {
  ApplicationAdapterManifest,
  ApplicationToolProjection,
  KernelCapabilityRequirement,
  KernelNodeId,
} from '@infos/shared'
import type { ApplicationRealm } from '../applications/applicationRealm'
import type { CapabilityDirectory, BoundCapabilityPort } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'
import type { ToolContext } from '../services/agent/toolRegistry'

const CAPABILITY_TYPE = 'document.semantic'
const CONTRACT_VERSION = '1.0'

/** 将Arca在线能力按Manifest投影为主Agent工具。 */
export class ArcaCapabilityRuntime {
  private readonly requirement: KernelCapabilityRequirement
  private scope?: LifecycleScope
  private port?: BoundCapabilityPort
  private unsubscribe?: () => void
  private syncing = false
  private syncRequested = false
  private registeredTools = new Set<string>()

  constructor(
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly realm: ApplicationRealm,
    private readonly localNodeId: KernelNodeId,
    private readonly manifest: ApplicationAdapterManifest,
  ) {
    const offer = manifest.offeredCapabilities.find(
      (candidate) =>
        candidate.capabilityType === CAPABILITY_TYPE &&
        candidate.contractVersion === CONTRACT_VERSION,
    )
    if (!offer) {
      throw new Error(`ARCA_CAPABILITY_OFFER_UNDECLARED: ${CAPABILITY_TYPE}`)
    }
    this.requirement = {
      requirementId: 'kernel.arca-collaboration',
      capabilityType: offer.capabilityType,
      contractVersion: offer.contractVersion,
      operations: [...offer.operations],
      required: false,
      binding: 'lazy',
      cardinality: 'one',
    }
  }

  async start(): Promise<void> {
    this.unsubscribe = this.directory.subscribe(() => void this.sync())
    await this.sync()
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.unregister()
  }

  available(): boolean {
    return Boolean(this.port)
  }

  async invoke<T = unknown>(operation: string, input: unknown): Promise<T> {
    if (!this.requirement.operations.includes(operation)) {
      throw new Error(`ARCA_CAPABILITY_OPERATION_UNDECLARED: ${operation}`)
    }
    if (!this.port) throw new Error('ARCA_CAPABILITY_UNAVAILABLE: Arca Host尚未接入')
    return this.port.invoke(operation, input, {
      principalId: 'system:arca-collaboration',
      correlationId: `arca:${operation}:${Date.now()}`,
    })
  }

  private async sync(): Promise<void> {
    if (this.syncing) {
      this.syncRequested = true
      return
    }
    this.syncing = true
    try {
      do {
        this.syncRequested = false
        const offer = this.directory
          .listOffers(this.requirement)
          .find((candidate) => candidate.health === 'available')
        if (offer && !this.port) {
          await this.register(offer.placement?.providerNodeId)
        } else if (!offer && (this.port || this.registeredTools.size > 0)) {
          await this.unregister()
        }
      } while (this.syncRequested)
    } finally {
      this.syncing = false
    }
  }

  private async register(providerNodeId?: KernelNodeId): Promise<void> {
    const offer = this.directory
      .listOffers(this.requirement)
      .find((candidate) => candidate.health === 'available')
    if (!offer) return

    const scope = new LifecycleScope('arca-collaboration-binding')
    try {
      const handle = this.handles.issue({
        subjectId: 'kernel.arca-collaboration',
        issuerNodeId: this.localNodeId,
        subjectNodeId: this.localNodeId,
        providerNodeId,
        revocationEpoch: 1,
        resource: offer.provider,
        operations: [...this.requirement.operations],
        scope: { capabilityType: CAPABILITY_TYPE, placement: 'remote-capability-node' },
        revocable: true,
      })
      scope.defer(() => {
        this.handles.revoke(handle.handleId)
      })
      const port = this.directory.bind({
        requirement: {
          ...this.requirement,
          placement: { preferredNodeId: providerNodeId },
        },
        handleId: handle.handleId,
        scope,
        principalId: 'system:arca-collaboration',
      })
      this.scope = scope
      this.port = port
      this.registerTools()
    } catch (error) {
      await this.unregister()
      throw error
    }
  }

  private registerTools(): void {
    for (const projection of this.manifest.toolProjections ?? []) {
      if (projection.audience !== 'host_agent' || projection.availability !== 'while_ready') {
        continue
      }
      if (projection.invocation !== 'invoke') {
        throw new Error(
          `ARCA_TOOL_INVOCATION_UNSUPPORTED: ${projection.name}:${projection.invocation}`,
        )
      }
      this.registerTool(projection)
    }
  }

  private registerTool(projection: ApplicationToolProjection): void {
    if (this.registeredTools.has(projection.name)) return
    this.realm.registerTool(
      {
        name: projection.name,
        description: projection.description,
        parameters: projection.parameters,
        display: projection.display,
        requiresApproval: projection.requiresApproval,
      },
      (args, context) => this.invokeProjection(projection, args, context),
      { hostProjection: true },
    )
    this.registeredTools.add(projection.name)
  }

  private async invokeProjection(
    projection: ApplicationToolProjection,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    try {
      if (!this.port) throw new Error('ARCA_CAPABILITY_UNAVAILABLE: Arca Host尚未接入')
      const result = await this.port.invoke(projection.operation, args, {
        principalId: context.agentId,
        correlationId: context.toolCallId ?? `arca:${projection.operation}:${Date.now()}`,
        executionId: context.executionId,
        processId: context.processId,
        deadline: context.deadline,
      })
      return JSON.stringify({ success: true, result })
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async unregister(): Promise<void> {
    const toolNames = [...this.registeredTools]
    this.registeredTools.clear()
    await Promise.all(toolNames.map((toolName) => this.realm.unregisterTool(toolName)))

    const scope = this.scope
    this.scope = undefined
    this.port = undefined
    await scope?.dispose()
  }
}
