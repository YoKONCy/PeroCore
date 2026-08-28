/**
 * coreKernelObjectAdapters — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  KernelAssetId,
  KernelExecutionId,
  KernelObjectRef,
  KernelTransferId,
} from '@infos/shared'
import type { BackgroundTaskRepository } from '../repositories/backgroundTask.repo'
import type { ThreadRepository } from '../repositories/thread.repo'
import type { KernelAssetRepository } from './kernelAssetRepository'
import type { KernelObjectRegistry } from './kernelObjectRegistry'
import type { KernelScheduler } from './kernelScheduler'
import type { KernelTransferRepository } from './kernelTransferRepository'
import type { NodeRegistry } from './nodeRegistry'

/** 注册只投影领域快照、不转移数据所有权的核心Kernel Object Adapter。 */
export function registerCoreKernelObjectAdapters(input: {
  registry: KernelObjectRegistry
  threads: ThreadRepository
  tasks: BackgroundTaskRepository
  scheduler: KernelScheduler
  nodes: NodeRegistry
  assets: KernelAssetRepository
  transfers: KernelTransferRepository
}): void {
  input.registry.register({
    objectType: 'thread',
    inspect: async (ref) => (await input.threads.getThread(ref.objectId)) ?? null,
    generation: () => 1,
    ownerPrincipalId: (thread) => thread.agentId,
  })
  input.registry.register({
    objectType: 'background-task',
    inspect: (ref) => input.tasks.findById(ref.objectId),
    generation: () => 1,
    ownerPrincipalId: (task) => task.agentId,
  })
  input.registry.register({
    objectType: 'execution',
    inspect: async (ref) => input.scheduler.get(ref.objectId as unknown as KernelExecutionId),
    generation: () => 1,
    ownerPrincipalId: (execution) => execution.descriptor.principalId,
  })
  input.registry.register({
    objectType: 'node',
    inspect: async (ref) => input.nodes.getNode(ref.objectId as never),
    generation: () => 1,
    ownerPrincipalId: () => 'system',
  })
  input.registry.register({
    objectType: 'asset',
    inspect: async (ref) =>
      (await input.assets.find(ref.objectId as unknown as KernelAssetId))?.asset ?? null,
    generation: (asset) => asset.ref.generation,
    ownerPrincipalId: (asset) => asset.ref.ownerPrincipalId,
  })
  input.registry.register({
    objectType: 'transfer',
    inspect: (ref) => input.transfers.find(ref.objectId as unknown as KernelTransferId),
    generation: (transfer) => transfer.ref.generation,
    ownerPrincipalId: (transfer) => transfer.principalId,
  })
}

export function coreObjectRef(
  objectType: string,
  objectId: string,
  ownerPrincipalId: string,
  generation = 1,
): KernelObjectRef {
  return {
    objectType,
    objectId: objectId as KernelObjectRef['objectId'],
    ownerPrincipalId,
    generation,
  }
}
