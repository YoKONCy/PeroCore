import { describe, expect, it, vi } from 'vitest'
import { ModelRoleResolver } from '@infos/backend/services/llm/modelRoles'

const mainRow = {
  id: 1,
  name: '主模型',
  provider: 'openai',
  modelId: 'main-model',
  apiKey: 'main-key',
  apiBase: null,
  temperature: null,
  topP: null,
  maxTokens: null,
  contextWindowTokens: null,
  reasoningEffort: null,
  returnNativeReasoning: false,
  wireApi: 'chat_completions',
  reasoningDialect: 'auto',
  stream: true,
  enableVision: false,
  enableAudioInput: false,
  providerType: 'openai',
}
const nanaRow = { ...mainRow, id: 2, name: 'Nana模型', modelId: 'nana-model' }

function createResolver(config: Record<string, string | null>) {
  const configRepo = {
    get: vi.fn(async (key: string) => config[key] ?? null),
  }
  const modelRepo = {
    findById: vi.fn(async (id: number) => (id === 1 ? mainRow : id === 2 ? nanaRow : null)),
  }
  return {
    resolver: new ModelRoleResolver(configRepo as never, modelRepo as never),
    configRepo,
    modelRepo,
  }
}

describe('ModelRoleResolver角色指派', () => {
  it('角色存在专用指派时应优先使用角色模型', async () => {
    const { resolver, configRepo } = createResolver({
      'model.main': '1',
      'model.agent.nana': '2',
    })

    const model = await resolver.resolveAgent('NANA')

    expect(model?.modelId).toBe('nana-model')
    expect(configRepo.get).toHaveBeenCalledWith('model.agent.nana')
  })

  it('角色未指派时应回退主模型', async () => {
    const { resolver } = createResolver({ 'model.main': '1' })

    const model = await resolver.resolveAgent('pero')

    expect(model?.modelId).toBe('main-model')
  })

  it('角色指向已删除模型时应回退主模型', async () => {
    const { resolver } = createResolver({
      'model.main': '1',
      'model.agent.pero': '999',
    })

    const model = await resolver.resolveAgent('pero')

    expect(model?.modelId).toBe('main-model')
  })
})
