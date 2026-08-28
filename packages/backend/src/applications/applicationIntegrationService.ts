/**
 * applicationIntegrationService — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  ApplicationAdapterManifest,
  ApplicationCapabilityRequirement,
  KernelCallContext,
  KernelNodeId,
} from '@infos/shared'
import type { ApplicationResourceAccessService } from './applicationResourceAccessService'
import type { GrantRegistry } from './grantRegistry'
import type { GrantPermission, ResourceRef } from './types'

export interface ApplicationRuntimeIdentity {
  instanceId: string
  nodeId: KernelNodeId
}

interface RegisteredApplicationAdapter {
  manifest: ApplicationAdapterManifest
  resolveRuntime: () => ApplicationRuntimeIdentity | undefined
}

export class ApplicationIntegrationService {
  private readonly adapters = new Map<string, RegisteredApplicationAdapter>()

  constructor(
    private readonly grants: GrantRegistry,
    private readonly resources: ApplicationResourceAccessService,
  ) {}

  register(
    manifest: ApplicationAdapterManifest,
    resolveRuntime: () => ApplicationRuntimeIdentity | undefined,
  ): () => void {
    if (this.adapters.has(manifest.id))
      throw new Error(`APPLICATION_ADAPTER_EXISTS: ${manifest.id}`)
    validateManifest(manifest)
    this.adapters.set(manifest.id, { manifest, resolveRuntime })
    return () => this.adapters.delete(manifest.id)
  }

  list(): ApplicationAdapterManifest[] {
    return [...this.adapters.values()].map(({ manifest }) => structuredClone(manifest))
  }

  get(appId: string): ApplicationAdapterManifest | undefined {
    const manifest = this.adapters.get(appId)?.manifest
    return manifest ? structuredClone(manifest) : undefined
  }

  runtime(appId: string): ApplicationRuntimeIdentity | undefined {
    const runtime = this.adapters.get(appId)?.resolveRuntime()
    return runtime ? structuredClone(runtime) : undefined
  }

  async listGrants(appId: string, instanceId?: string) {
    const runtime = this.requireRuntime(appId, instanceId)
    return this.grants.queryGrants({ holderId: runtime.instanceId })
  }

  async grant(input: {
    appId: string
    instanceId?: string
    ownerAgentId: string
    capabilityType: string
    resource: ResourceRef
    permissions: GrantPermission[]
    expiresAt?: string
  }): Promise<string> {
    const runtime = this.requireRuntime(input.appId, input.instanceId)
    const requirement = this.requireRequirement(input.appId, input.capabilityType)
    if (resourceKind(requirement.capabilityType) !== input.resource.kind) {
      throw new Error(`APPLICATION_GRANT_RESOURCE_MISMATCH: ${input.capabilityType}`)
    }
    return this.grants.grant({
      ownerAgentId: input.ownerAgentId,
      holderId: runtime.instanceId,
      holderType: 'app',
      resource: input.resource,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
      grantedBy: 'user',
      note: requirement.reason,
    })
  }

  async revoke(appId: string, grantId: string, instanceId?: string): Promise<boolean> {
    const runtime = this.requireRuntime(appId, instanceId)
    const grants = await this.grants.queryGrants({
      holderId: runtime.instanceId,
      activeOnly: false,
    })
    if (!grants.some((grant) => grant.id === grantId)) {
      throw new Error(`APPLICATION_GRANT_NOT_FOUND: ${grantId}`)
    }
    return this.grants.revoke(grantId)
  }

  async invoke<TInput, TOutput>(input: {
    appId: string
    instanceId?: string
    capabilityType: string
    operation: string
    value: TInput
    context: Omit<KernelCallContext, 'principalId'>
  }): Promise<TOutput> {
    const runtime = this.requireRuntime(input.appId, input.instanceId)
    const requirement = this.requireRequirement(input.appId, input.capabilityType)
    if (!requirement.operations.includes(input.operation)) {
      throw new Error(`APPLICATION_CAPABILITY_OPERATION_UNDECLARED: ${input.operation}`)
    }
    return this.resources.invoke<TInput, TOutput>({
      appId: input.appId,
      instanceId: runtime.instanceId,
      appNodeId: runtime.nodeId,
      requirement,
      operation: input.operation,
      value: input.value,
      context: input.context,
    })
  }

  private requireRuntime(appId: string, instanceId?: string): ApplicationRuntimeIdentity {
    const adapter = this.adapters.get(appId)
    if (!adapter) throw new Error(`APPLICATION_ADAPTER_NOT_FOUND: ${appId}`)
    const runtime = adapter.resolveRuntime()
    if (!runtime) throw new Error(`APPLICATION_RUNTIME_OFFLINE: ${appId}`)
    if (instanceId && runtime.instanceId !== instanceId) {
      throw new Error(`APPLICATION_INSTANCE_MISMATCH: ${instanceId}`)
    }
    return runtime
  }

  private requireRequirement(
    appId: string,
    capabilityType: string,
  ): ApplicationCapabilityRequirement {
    const adapter = this.adapters.get(appId)
    if (!adapter) throw new Error(`APPLICATION_ADAPTER_NOT_FOUND: ${appId}`)
    const requirement = adapter.manifest.requestedCapabilities.find(
      (item) => item.capabilityType === capabilityType,
    )
    if (!requirement) throw new Error(`APPLICATION_CAPABILITY_UNDECLARED: ${capabilityType}`)
    return requirement
  }
}

function validateManifest(manifest: ApplicationAdapterManifest): void {
  const endpoints = new Map(manifest.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  for (const offer of manifest.offeredCapabilities) {
    const endpoint = endpoints.get(offer.endpointId)
    if (!endpoint) throw new Error(`APPLICATION_OFFER_ENDPOINT_UNDECLARED: ${offer.endpointId}`)
    for (const operation of offer.operations) {
      if (!endpoint.operations.includes(operation)) {
        throw new Error(`APPLICATION_OFFER_OPERATION_UNDECLARED: ${operation}`)
      }
    }
  }
  const projectionNames = new Set<string>()
  for (const projection of manifest.toolProjections ?? []) {
    if (projectionNames.has(projection.name)) {
      throw new Error(`APPLICATION_TOOL_PROJECTION_DUPLICATE: ${projection.name}`)
    }
    projectionNames.add(projection.name)
    const endpoint = endpoints.get(projection.endpointId)
    if (!endpoint) {
      throw new Error(`APPLICATION_TOOL_ENDPOINT_UNDECLARED: ${projection.endpointId}`)
    }
    if (!endpoint.operations.includes(projection.operation)) {
      throw new Error(`APPLICATION_TOOL_OPERATION_UNDECLARED: ${projection.operation}`)
    }
    const offered = manifest.offeredCapabilities.some(
      (offer) =>
        offer.endpointId === projection.endpointId &&
        offer.operations.includes(projection.operation),
    )
    if (!offered) throw new Error(`APPLICATION_TOOL_OPERATION_NOT_OFFERED: ${projection.operation}`)
  }
}

function resourceKind(capabilityType: string): ResourceRef['kind'] | undefined {
  if (capabilityType === 'infos.persona') return 'persona'
  if (capabilityType === 'infos.knowledge') return 'memory'
  if (capabilityType === 'infos.workspace') return 'workspace'
  if (capabilityType === 'infos.model') return 'model'
  return undefined
}
