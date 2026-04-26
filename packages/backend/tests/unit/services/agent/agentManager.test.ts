import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentManager } from '@perocore/backend/services/agent/agentManager'
import type { PathResolver } from '@perocore/backend/core/pathResolver'

type ConfigRepositoryMock = {
  get: ReturnType<typeof vi.fn>
  getJson: ReturnType<typeof vi.fn>
}

function createAgent(
  root: string,
  id: string,
  config: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const agentDir = join(root, id)
  mkdirSync(join(agentDir, 'personas'), { recursive: true })
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify(config, null, 2), 'utf-8')
  for (const [relativePath, content] of Object.entries(files)) {
    writeFileSync(join(agentDir, relativePath), content, 'utf-8')
  }
}

function createResolver(appRoot: string, dataRoot: string): PathResolver {
  return {
    resolve: vi.fn((alias: string) => {
      if (alias === '@app/backend/src/services/mdp/agents') return appRoot
      if (alias === '@data/agents') return dataRoot
      return alias
    }),
  } as unknown as PathResolver
}

describe('AgentManager', () => {
  let rootDir: string
  let builtinDir: string
  let dataDir: string
  let configRepo: ConfigRepositoryMock

  beforeEach(() => {
    rootDir = join(tmpdir(), `perocore-agent-manager-${Date.now()}-${Math.random()}`)
    builtinDir = join(rootDir, 'builtin')
    dataDir = join(rootDir, 'data')
    mkdirSync(builtinDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
    configRepo = {
      get: vi.fn(),
      getJson: vi.fn(),
    }
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('应当扫描内置与用户 Agent 并加载人设、头像和台词', () => {
    createAgent(
      builtinDir,
      'pero',
      {
        name: 'Pero',
        description: '猫猫助手',
        personas: { work: 'personas/work.md', social: 'personas/social.md' },
        traits: { work: ['认真'], social: ['可爱'] },
        social: { use_stickers: true, qq_id: '123' },
        tool_policies: { file: 'allow' },
        waifu_texts: { idle: '喵' },
      },
      {
        'personas/work.md': '工作人设',
        'personas/social.md': '社交人设',
        'avatar.png': 'png',
      },
    )
    createAgent(dataDir, 'custom', { name: 'Custom', description: '用户角色' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir), configRepo as never)

    const pero = manager.getAgent('PERO')
    const agents = manager.listAgents()

    expect(pero).toMatchObject({
      id: 'pero',
      name: 'Pero',
      description: '猫猫助手',
      workPersona: '工作人设',
      socialPersona: '社交人设',
      workTraits: ['认真'],
      socialTraits: ['可爱'],
      socialBinding: { use_stickers: true, qq_id: '123' },
      toolPolicies: { file: 'allow' },
      useStickers: true,
      waifuTexts: { idle: '喵' },
    })
    expect(pero?.avatarPath).toContain('avatar.png')
    expect(agents.map((agent) => agent.id).sort()).toEqual(['custom', 'pero'])
    expect(manager.enabledAgents).toEqual(new Set(['pero', 'custom']))
    expect(manager.getActiveAgent()?.id).toBe('pero')
  })

  it('应当切换、启用与禁用 Agent 并拒绝非法状态', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' })
    createAgent(dataDir, 'custom', { name: 'Custom' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    const switched = manager.setActiveAgent('custom')
    const disableActive = manager.disableAgent('custom')
    const disablePero = manager.disableAgent('pero')
    const switchDisabled = manager.setActiveAgent('pero')
    const enableMissing = manager.enableAgent('missing')
    const enablePero = manager.enableAgent('pero')
    const switchPero = manager.setActiveAgent('pero')

    expect(switched).toBe(true)
    expect(disableActive).toBe(false)
    expect(disablePero).toBe(true)
    expect(switchDisabled).toBe(false)
    expect(enableMissing).toBe(false)
    expect(enablePero).toBe(true)
    expect(switchPero).toBe(true)
  })

  it('应当创建和删除用户自定义 Agent', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    const created = manager.createAgent({ id: 'NewCat', name: '新猫', description: '新角色' })
    manager.deleteAgent('newcat')

    expect(created).toMatchObject({ id: 'newcat', name: '新猫', description: '新角色' })
    expect(manager.getAgent('newcat')).toBeUndefined()
    expect(() => manager.createAgent({ id: 'pero', name: '重复' })).toThrow('已存在')
  })

  it('应当拒绝删除当前 Agent、内置 Agent 和不存在的 Agent', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' })
    createAgent(dataDir, 'custom', { name: 'Custom' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    expect(() => manager.deleteAgent('missing')).toThrow('不存在')
    expect(() => manager.deleteAgent('pero')).toThrow('当前活跃')
    expect(manager.setActiveAgent('custom')).toBe(true)
    expect(() => manager.deleteAgent('pero')).toThrow('内置')
  })

  it('应当合并动态台词并应用社交覆盖配置', async () => {
    createAgent(builtinDir, 'pero', {
      name: 'Pero',
      social: { enabled: false },
      waifu_texts: { idle: '静态', work: '工作' },
    })
    configRepo.getJson.mockResolvedValue({ idle: '动态' })
    configRepo.get.mockImplementation(async (key: string) => {
      if (key.endsWith('.enabled')) return 'true'
      if (key.endsWith('.qq_id')) return '456'
      return undefined
    })
    const manager = new AgentManager(createResolver(builtinDir, dataDir), configRepo as never)

    const texts = await manager.getWaifuTexts('pero')
    await manager.applySocialOverrides('pero')

    expect(texts).toEqual({ idle: '动态', work: '工作' })
    expect(manager.getAgent('pero')?.socialBinding).toMatchObject({ enabled: true, qq_id: '456' })
    await expect(manager.getWaifuTexts('missing')).resolves.toBeNull()
  })

  it('应当读取头像数据并识别用户 Agent', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' }, { 'avatar.webp': 'webp-data' })
    createAgent(dataDir, 'custom', { name: 'Custom' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    const avatar = manager.getAvatarData('pero')

    expect(avatar?.buffer.toString()).toBe('webp-data')
    expect(avatar?.mime).toBe('image/webp')
    expect(manager.getAvatarData('missing')).toBeNull()
    expect(manager.isUserAgent('pero')).toBe(false)
    expect(manager.isUserAgent('custom')).toBe(true)
    expect(manager.isUserAgent('missing')).toBe(false)
  })
})
