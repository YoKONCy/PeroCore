import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelRoleResolver } from '@perocore/backend/services/llm/modelRoles'
import { PresetLoader } from '@perocore/backend/services/prompt/presetLoader'
import { AssetRegistry } from '@perocore/backend/core/assetRegistry'
import type { PathResolver } from '@perocore/backend/core/pathResolver'

function createModelDeps(
  configs: Record<string, string | null>,
  models: Record<number, Record<string, unknown>>,
) {
  const configRepo = {
    get: vi.fn((key: string) => Promise.resolve(configs[key] ?? null)),
  }
  const modelRepo = {
    findById: vi.fn((id: number) => Promise.resolve(models[id] ?? null)),
  }
  return { configRepo, modelRepo }
}

describe('ModelRoleResolver', () => {
  const oldEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...oldEnv }
    vi.clearAllMocks()
  })

  it('应当优先使用角色专用模型并补默认温度', async () => {
    const { configRepo, modelRepo } = createModelDeps(
      { 'model.role.secretary': '2' },
      {
        2: {
          provider: 'openai',
          modelId: 'gpt-secretary',
          apiKey: 'key',
          temperature: null,
          maxTokens: 1000,
        },
      },
    )
    const resolver = new ModelRoleResolver(configRepo as never, modelRepo as never)

    const config = await resolver.resolve('secretary')

    expect(config).toEqual({
      provider: 'openai',
      modelId: 'gpt-secretary',
      apiKey: 'key',
      apiBase: undefined,
      temperature: 0.3,
      maxTokens: 1000,
    })
    expect(configRepo.get).toHaveBeenCalledWith('model.role.secretary')
  })

  it('应当在角色未配置时回退主模型并使用角色温度', async () => {
    const { configRepo, modelRepo } = createModelDeps(
      { 'model.role.main': '1' },
      { 1: { provider: 'gemini', modelId: 'main-model', apiKey: 'main-key', temperature: null } },
    )
    const resolver = new ModelRoleResolver(configRepo as never, modelRepo as never)

    const config = await resolver.resolve('reflection')

    expect(config).toMatchObject({
      provider: 'gemini',
      modelId: 'main-model',
      apiKey: 'main-key',
      temperature: 0.2,
    })
  })

  it('应当使用全局供应商 API Key 作为模型配置兜底', async () => {
    const { configRepo, modelRepo } = createModelDeps(
      {
        'model.role.main': '1',
        'global.openai.apiKey': 'global-key',
        'global.openai.apiBase': 'https://api.example.com',
      },
      {
        1: {
          provider: 'openai',
          modelId: 'main-model',
          apiKey: null,
          apiBase: null,
          temperature: 0.8,
        },
      },
    )
    const resolver = new ModelRoleResolver(configRepo as never, modelRepo as never)

    const config = await resolver.resolve('main')

    expect(config).toMatchObject({
      apiKey: 'global-key',
      apiBase: 'https://api.example.com',
      temperature: 0.8,
    })
  })

  it('应当在数据库配置无效时回退环境变量或返回 null', async () => {
    process.env.PERO_LLM_API_KEY = 'env-key'
    process.env.PERO_LLM_MODEL = 'env-model'
    process.env.PERO_LLM_PROVIDER = 'anthropic'
    const { configRepo, modelRepo } = createModelDeps({ 'model.role.main': 'abc' }, {})
    const resolver = new ModelRoleResolver(configRepo as never, modelRepo as never)

    const config = await resolver.resolve('auxiliary')
    delete process.env.PERO_LLM_API_KEY
    delete process.env.PERO_LLM_MODEL
    const missing = await resolver.resolve('main')

    expect(config).toMatchObject({
      provider: 'anthropic',
      modelId: 'env-model',
      apiKey: 'env-key',
      temperature: 0.1,
    })
    expect(missing).toBeNull()
    expect(modelRepo.findById).not.toHaveBeenCalled()
  })

  it('应当创建绑定到指定角色的 getter', async () => {
    const { configRepo, modelRepo } = createModelDeps(
      { 'model.role.main': '1' },
      { 1: { provider: 'openai', modelId: 'main', apiKey: 'key' } },
    )
    const resolver = new ModelRoleResolver(configRepo as never, modelRepo as never)

    const getMain = resolver.bind('main')

    await expect(getMain()).resolves.toMatchObject({ modelId: 'main' })
  })
})

describe('PresetLoader', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-presets-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当加载 yaml preset 并按 source 映射返回', () => {
    writeFileSync(
      join(root, 'social.yaml'),
      '---\nname: social\ndescription: 社交模式\n---\n- id: memory\n  enabled: false\n  userOverride: |\n    使用社交记忆\n    保持简短\n- id: tools\n  enabled: true\n',
    )
    const loader = new PresetLoader(root)

    const preset = loader.getPresetForSource('social')

    expect(preset).toEqual({
      name: 'social',
      description: '社交模式',
      slots: [
        { id: 'memory', position: 0, enabled: false, userOverride: '使用社交记忆\n保持简短' },
        { id: 'tools', position: 0, enabled: true },
      ],
    })
    expect(loader.getPresetForSource('desktop')).toBeUndefined()
  })

  it('应当忽略缺失 frontmatter、非 yaml 文件和不存在的目录', () => {
    writeFileSync(join(root, 'bad.yaml'), 'name: bad')
    writeFileSync(join(root, 'note.txt'), 'ignore')

    const loader = new PresetLoader(root)
    const missingLoader = new PresetLoader(join(root, 'missing'))

    expect(loader.getPresetForSource('social')).toBeUndefined()
    expect(missingLoader.getPresetForSource('social')).toBeUndefined()
  })
})

function createResolver(root: string, workshop = true): PathResolver {
  return {
    resolve: vi.fn((alias: string) =>
      join(
        root,
        alias.replace('@app/', 'app/').replace('@workshop', 'workshop').replace('@data/', 'data/'),
      ),
    ),
    isAvailable: vi.fn((alias: string) => alias === '@workshop' && workshop),
  } as unknown as PathResolver
}

function writeAsset(dir: string, filename: string, data: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), JSON.stringify(data))
}

describe('AssetRegistry', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-assets-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当按官方、工坊、本地优先级扫描资产并允许后扫覆盖', async () => {
    writeAsset(join(root, 'app', 'agents', 'pero'), 'agent.json', {
      asset_id: 'pero.persona.default',
      type: 'persona',
      display_name: '官方 Pero',
      version: '1.0.0',
    })
    writeAsset(join(root, 'workshop', 'sub'), 'asset.json', {
      asset_id: 'pero.persona.default',
      type: 'persona',
      title: '工坊 Pero',
      workshopPublishedFileId: '123',
    })
    writeAsset(join(root, 'data', 'custom', 'local'), 'manifest.json', {
      asset_id: 'local.prompt.demo',
      type: 'prompt',
      displayName: '本地提示词',
    })

    const registry = new AssetRegistry(createResolver(root))
    await registry.scanAll()

    expect(registry.isScanned).toBe(true)
    expect(registry.getAsset('pero.persona.default')).toMatchObject({
      source: 'workshop',
      displayName: '工坊 Pero',
      workshopId: '123',
    })
    expect(registry.getAssetsByType('persona')).toHaveLength(1)
    expect(registry.getAssetsBySource('local')).toEqual([
      expect.objectContaining({ assetId: 'local.prompt.demo' }),
    ])
    expect(registry.getAllAssets()).toHaveLength(2)
  })

  it('应当跳过无效资产并支持重新扫描', async () => {
    writeAsset(join(root, 'app', 'agents', 'bad'), 'asset.json', { type: 'persona' })
    const registry = new AssetRegistry(createResolver(root, false))

    await registry.scanAll()
    writeAsset(join(root, 'data', 'custom', 'new'), 'description.json', {
      asset_id: 'new.mod.demo',
      type: 'mod',
      version: '2.0.0',
    })
    await registry.rescan()

    expect(registry.getAsset('missing')).toBeUndefined()
    expect(registry.getAssetsByType('mod')).toEqual([
      expect.objectContaining({ assetId: 'new.mod.demo', version: '2.0.0' }),
    ])
  })
})
