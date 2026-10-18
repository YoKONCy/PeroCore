import type { KernelNodeId } from '@infos/shared'
import type { NodeProvider } from '@infos/node-sdk'
import type { ArcaModelRepository, SaveArcaModelInput } from './modelRepository'
import type { SurfaceSessionManager } from './surfaceSession'
import { completeModel, testModel } from './modelClient'
export { completeModel } from './modelClient'

const operations = [
  'model.list',
  'model.save',
  'model.select',
  'model.remove',
  'model.test',
  'model.complete',
] as const

/** 模型兼容层只校验会话和协议，具体 API 请求由自治模型执行器处理。 */
export function createModelCapabilityProvider(input: {
  nodeId: KernelNodeId
  models: ArcaModelRepository
  sessions: SurfaceSessionManager
}): NodeProvider {
  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.arca.model-authority',
      name: 'Arca Model Authority',
      version: '1.0.0',
      definition: {
        capabilityType: 'model.settings',
        contractVersion: '1.0',
        operations: Object.fromEntries(
          operations.map((operation) => [
            operation,
            { risk: operation === 'model.list' ? 'read' : 'interact', idempotency: 'safe' },
          ]),
        ),
      },
      offer: {
        offerId: `arca-model-authority:${input.nodeId}`,
        capabilityType: 'model.settings',
        contractVersion: '1.0',
        operations: [...operations],
        resourceKinds: ['model.config', 'credential.reference'],
      },
    },
    health: () => 'available',
    async invoke(envelope, context) {
      context.signal.throwIfAborted()
      const value = envelope.payload.input as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('模型请求参数无效')
      input.sessions.require(
        value.surfaceSessionToken,
        envelope.payload.operation === 'model.list' ? 'read' : 'edit',
        envelope.sourceNodeId,
      )
      const text = (name: string) => {
        const current = value[name]
        if (typeof current !== 'string' || !current.trim())
          throw new Error(`${name} 必须是非空字符串`)
        return current.trim()
      }
      switch (envelope.payload.operation) {
        case 'model.list':
          return { models: input.models.list(), selectedModelId: input.models.selected() }
        case 'model.save':
          return input.models.save(value as unknown as SaveArcaModelInput)
        case 'model.select':
          input.models.select(text('modelId'))
          return { selectedModelId: input.models.selected() }
        case 'model.remove':
          return { removed: input.models.remove(text('modelId')) }
        case 'model.test':
          return testModel(input.models, text('modelId'), context.signal)
        case 'model.complete':
          return completeModel(
            input.models,
            typeof value.modelId === 'string' ? value.modelId : undefined,
            text('prompt'),
            context.signal,
          )
        default:
          throw new Error('模型操作未开放')
      }
    },
  }
}
