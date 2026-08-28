/**
 * applicationResourceAccessService — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  ApplicationCapabilityRequirement,
  KernelCallContext,
  KernelNodeId,
} from '@infos/shared'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { ApplicationCapabilityClient } from './applicationCapabilityClient'
import type { GrantRegistry } from './grantRegistry'
import type { ResourceRef } from './types'

export class ApplicationResourceAccessService {
  constructor(
    private readonly localNodeId: KernelNodeId,
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly grants?: GrantRegistry,
  ) {}

  async invoke<TInput, TOutput>(input: {
    appId: string
    instanceId: string
    appNodeId: KernelNodeId
    requirement: ApplicationCapabilityRequirement
    operation: string
    value: TInput
    context: Omit<KernelCallContext, 'principalId'>
  }): Promise<TOutput> {
    const principalId = `application:${input.appId}:${input.instanceId}`
    await this.assertGrant(input.instanceId, input.requirement.capabilityType, input.value)
    const client = new ApplicationCapabilityClient(
      principalId,
      input.appNodeId,
      this.localNodeId,
      this.directory,
      this.handles,
    )
    try {
      const port = client.bind(input.requirement)
      if (!port)
        throw new Error(`APPLICATION_CAPABILITY_UNAVAILABLE: ${input.requirement.capabilityType}`)
      return await port.invoke<TInput, TOutput>(input.operation, input.value, {
        ...input.context,
        principalId,
      })
    } finally {
      await client.dispose()
    }
  }

  private async assertGrant(
    instanceId: string,
    capabilityType: string,
    value: unknown,
  ): Promise<void> {
    if (!this.grants) return
    const kind = capabilityResourceKind(capabilityType)
    if (!kind) throw new Error(`APPLICATION_CAPABILITY_GRANT_REQUIRED: ${capabilityType}`)
    const grants = await this.grants.queryGrants({ holderId: instanceId, resourceKind: kind })
    const requestedAgentId =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).agentId
        : undefined
    const allowed = grants.some(
      (grant) =>
        (grant.permissions.includes('read') || grant.permissions.includes('activate')) &&
        (typeof requestedAgentId !== 'string' ||
          resourceAgentId(grant.resource) === requestedAgentId),
    )
    if (!allowed) throw new Error(`APPLICATION_CAPABILITY_GRANT_REQUIRED: ${capabilityType}`)
  }
}

function capabilityResourceKind(capabilityType: string): ResourceRef['kind'] | undefined {
  if (capabilityType === 'infos.persona') return 'persona'
  if (capabilityType === 'infos.knowledge') return 'memory'
  if (capabilityType === 'infos.workspace') return 'workspace'
  if (capabilityType === 'infos.model') return 'model'
  return undefined
}

function resourceAgentId(resource: ResourceRef): string | undefined {
  if (resource.kind === 'persona' || resource.kind === 'memory') return resource.agentId
  return undefined
}
