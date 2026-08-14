import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentManager } from '@infos/backend/services/agent/agentManager'
import type { PathResolver } from '@infos/backend/core/pathResolver'

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
  // AIOS: personas 目录已废弃，人设统一由 system_prompt.md 管理
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify(config, null, 2), 'utf-8')
  for (const [relativePath, content] of Object.entries(files)) {
    writeFileSync(join(agentDir, relativePath), content, 'utf-8')
  }
}

function createResolver(appRoot: string, dataRoot: string): PathResolver {
  return {
    resolve: vi.fn((alias: string) => {
      if (alias === '@app/backend/src/assets/agents') return appRoot
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
    rootDir = join(tmpdir(), `infos-agent-manager-${Date.now()}-${Math.random()}`)
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
        // AIOS: personas 字段已废弃，人设统一由 system_prompt.md 管理
        traits: { work: ['认真'], social: ['可爱'] },
        social: { use_stickers: true, qq_id: '123' },
        tool_policies: { file: 'allow' },
        waifu_texts: { idle: '喵' },
      },
      {
        'system_prompt.md': '你是 Pero，一只猫猫助手。',
        'avatar.png': 'png',
      },
    )
    createAgent(dataDir, 'custom', { name: 'Custom', description: '用户角色' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir), configRepo as never)

    const pero = manager.getAgent('PERO')
    const agents = manager.listAgents()

    // AIOS: workPersona/socialPersona 已移除，改用 promptPath 指向 system_prompt.md
    expect(pero).toMatchObject({
      id: 'pero',
      name: 'Pero',
      description: '猫猫助手',
      socialTraits: ['可爱'],
      socialBinding: { use_stickers: true, qq_id: '123' },
      toolPolicies: { file: 'allow' },
      useStickers: true,
      waifuTexts: { idle: '喵' },
    })
    expect(pero?.promptPath).toContain('system_prompt.md')
    expect(pero?.avatarPath).toContain('avatar.png')
    expect(agents.map((agent) => agent.id).sort()).toEqual(['custom', 'pero'])
    expect(manager.enabledAgents).toEqual(new Set(['pero', 'custom']))
    expect(manager.getDefaultAgent()?.id).toBe('pero')
  })

  it('应当启用与禁用 Agent 并拒绝非法状态', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' })
    createAgent(dataDir, 'custom', { name: 'Custom' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    // AIOS: setActiveAgent 已移除，defaultAgentId 永远是 pero，不能禁用默认 Agent
    const disableDefault = manager.disableAgent('pero')
    const disableCustom = manager.disableAgent('custom')
    const enableMissing = manager.enableAgent('missing')
    const enableCustom = manager.enableAgent('custom')

    expect(disableDefault).toBe(false) // 不能禁用默认 Agent
    expect(disableCustom).toBe(true) // custom 非默认，可以禁用
    expect(enableMissing).toBe(false)
    expect(enableCustom).toBe(true)
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

  it('应当拒绝删除默认 Agent、内置 Agent 和不存在的 Agent', () => {
    createAgent(builtinDir, 'pero', { name: 'Pero' })
    createAgent(dataDir, 'custom', { name: 'Custom' })
    const manager = new AgentManager(createResolver(builtinDir, dataDir))

    expect(() => manager.deleteAgent('missing')).toThrow('不存在')
    // AIOS: pero 是默认 Agent，不能删除（setActiveAgent 已移除，无法切换默认）
    expect(() => manager.deleteAgent('pero')).toThrow('当前活跃')
    // custom 是用户自定义且非默认，可以删除
    expect(() => manager.deleteAgent('custom')).not.toThrow()
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

  it('应当兼容旧动态字段并按层级合并静态台词', async () => {
    createAgent(builtinDir, 'pero', {
      name: 'Pero',
      waifu_texts: {
        welcome: { morning: '默认早安', noon: '默认午安' },
        randTextures: { noClothes: '默认没衣服', success: '默认换装成功' },
      },
    })
    configRepo.getJson.mockResolvedValue({
      welcome_timeRanges_morning: '动态早安',
      randTexturesSuccess: '动态换装成功',
    })
    const manager = new AgentManager(createResolver(builtinDir, dataDir), configRepo as never)

    await expect(manager.getWaifuTexts('pero')).resolves.toMatchObject({
      welcome: { morning: '动态早安', noon: '默认午安' },
      randTextures: { noClothes: '默认没衣服', success: '动态换装成功' },
    })
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
