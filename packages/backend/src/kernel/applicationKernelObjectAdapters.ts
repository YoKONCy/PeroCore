import type { KernelObjectId } from '@infos/shared'
import type { AppManager } from '../applications/appManager'
import type { ModelRepository } from '../repositories/model.repo'
import type { BackgroundTaskProjectionService } from '../projections/backgroundTaskProjectionService'
import type { ConversationProjectionService } from '../projections/conversationProjectionService'
import type { KernelObjectRegistry } from './kernelObjectRegistry'

/** 注册后段Application/Projection Authority提供的Kernel Object Adapter。 */
export function registerApplicationKernelObjectAdapters(input: {
  registry: KernelObjectRegistry
  apps: AppManager
  models: ModelRepository
  conversations: ConversationProjectionService
  backgroundTasks: BackgroundTaskProjectionService
}): void {
  input.registry.register({
    objectType: 'app-instance',
    inspect: async (ref) => (await input.apps.getInstance(String(ref.objectId))) ?? null,
    generation: () => 1,
    ownerPrincipalId: (instance) => instance.hostAgentId,
  })
  input.registry.register({
    objectType: 'model-config',
    inspect: async (ref) => {
      const model = await input.models.findById(Number(ref.objectId))
      if (!model) return null
      return Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'apiKey'))
    },
    generation: () => 1,
    ownerPrincipalId: () => 'system',
  })
  input.registry.register({
    objectType: 'surface',
    inspect: async (ref) => {
      const id = String(ref.objectId)
      if (id.startsWith('conversation:')) {
        return input.conversations.getSnapshot(id.slice('conversation:'.length))
      }
      if (id.startsWith('background-task:')) {
        return input.backgroundTasks.getSnapshot(id.slice('background-task:'.length))
      }
      return null
    },
    generation: (surface) => surface.revision,
    ownerPrincipalId: (surface) => surface.principalId,
  })
}

export function surfaceObjectId(
  scope: 'conversation' | 'background-task',
  id: string,
): KernelObjectId {
  return `${scope}:${id}` as KernelObjectId
}
