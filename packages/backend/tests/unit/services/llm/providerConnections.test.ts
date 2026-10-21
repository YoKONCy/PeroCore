import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as schema from '../../../../src/database/schema'
import { ModelRepository } from '../../../../src/repositories/model.repo'
import { ConfigRepository } from '../../../../src/repositories/config.repo'
import { ModelRegistry } from '../../../../src/services/llm/modelRegistry'
import { ModelRoleResolver } from '../../../../src/services/llm/modelRoles'
import { ModelService } from '../../../../src/services/model/modelService'
import { ProviderConnectionService } from '../../../../src/services/model/providerConnectionService'
import { providerApiUrl } from '../../../../src/services/llm/providers/providerUrl'
import { LlmService } from '../../../../src/services/llm/llmService'

const migrations = new URL('../../../../src/database/migrations/', import.meta.url)
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>
}
const sql = (tag: string) => readFileSync(new URL(`${tag}.sql`, migrations), 'utf8')
let sqlite: Database.Database
let repo: ModelRepository
let registry: ModelRegistry
let config: ConfigRepository

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const entry of journal.entries.filter((entry) => entry.idx < 19)) sqlite.exec(sql(entry.tag))
  sqlite
    .prepare('INSERT INTO configs (key, value) VALUES (?, ?)')
    .run('global.openai.apiBase', 'https://old.example/v1')
  sqlite
    .prepare('INSERT INTO configs (key, value) VALUES (?, ?)')
    .run('global.openai.apiKey', 'old-global-key')
  const insert = sqlite.prepare(
    'INSERT INTO ai_model_configs (id, name, provider, model_id, api_base, api_key, provider_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  insert.run(1, '继承旧全局', 'openai', 'model-a', '', '', 'global')
  insert.run(2, '旧混合配置', 'openai', 'model-b', 'https://private.example/api/v3', '', 'global')
  insert.run(
    3,
    '自定义原生协议',
    'custom',
    'claude-test',
    'https://custom.example/anthropic/v1',
    'custom-key',
    'anthropic',
  )
  insert.run(4, '本地免密', 'ollama', 'local-model', '', '', 'global')
  insert.run(5, '本地带认证', 'ollama', 'proxy-model', '', 'proxy-key', 'global')
  sqlite.exec(sql('0019_provider_connections'))
  // 此字段由生产建连补表维护，不属于历史 SQL 迁移链。
  sqlite.exec('ALTER TABLE ai_model_configs ADD COLUMN max_react_turns INTEGER')
  const db = drizzle(sqlite, { schema })
  repo = new ModelRepository(db)
  registry = new ModelRegistry(db)
  config = new ConfigRepository(db)
})
afterEach(() => {
  sqlite.close()
  vi.restoreAllMocks()
})

describe('服务商连接迁移和调用一致性', () => {
  it('清理自动生成名称的迁移标签，保留连接身份、密钥与模型引用', async () => {
    sqlite.exec(sql('0020_provider_connection_names'))
    expect(await repo.connections.findById('legacy-global-openai')).toMatchObject({
      name: 'OpenAI',
      apiKey: 'old-global-key',
      apiBase: 'https://old.example/v1',
    })
    expect(await repo.connections.findById('legacy-model-2')).toMatchObject({ name: '旧混合配置' })
    expect((await repo.findById(1))?.providerConnectionId).toBe('legacy-global-openai')
    expect(await registry.getById(2)).toMatchObject({
      apiKey: 'old-global-key',
      apiBase: 'https://private.example/api/v3',
    })
    sqlite.exec(sql('0020_provider_connection_names'))
    expect((await repo.connections.findById('legacy-global-openai'))?.name).toBe('OpenAI')
  })

  it('名称清理不修改用户自定义名称或普通连接', async () => {
    const connection = (await repo.connections.findById('legacy-global-openai'))!
    await repo.connections.update(connection.id, { ...connection, name: '我的主用连接' })
    await repo.connections.create('custom-connection', {
      name: 'openai（原全局连接）',
      brand: connection.brand,
      protocol: connection.protocol,
      apiBase: connection.apiBase,
      authMode: connection.authMode,
      apiKey: connection.apiKey,
    })
    sqlite.exec(sql('0020_provider_connection_names'))
    expect((await repo.connections.findById(connection.id))?.name).toBe('我的主用连接')
    expect((await repo.connections.findById('custom-connection'))?.name).toBe(
      'openai（原全局连接）',
    )
  })

  it('迁移保留旧模型实际生效的混合地址与密钥，并与共享连接隔离', async () => {
    expect(await registry.getById(1)).toMatchObject({
      apiBase: 'https://old.example/v1',
      apiKey: 'old-global-key',
    })
    expect(await registry.getById(2)).toMatchObject({
      apiBase: 'https://private.example/api/v3',
      apiKey: 'old-global-key',
    })
    const inherited = (await repo.findById(1))!
    const privateModel = (await repo.findById(2))!
    expect(inherited.providerConnectionId).toBe('legacy-global-openai')
    expect(privateModel.providerConnectionId).toBe('legacy-model-2')
    const connection = (await repo.connections.findById('legacy-global-openai'))!
    await repo.connections.update(connection.id, {
      ...connection,
      apiKey: 'new-key',
      apiBase: 'https://new.example/v1',
    })
    expect(await registry.getById(1)).toMatchObject({
      apiKey: 'new-key',
      apiBase: 'https://new.example/v1',
    })
    expect(await registry.getById(2)).toMatchObject({
      apiKey: 'old-global-key',
      apiBase: 'https://private.example/api/v3',
    })
  })

  it('所有角色调用与模型测试使用相同协议和连接，测试不偷偷进入回退模型', async () => {
    const llm = { chat: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'OK' } }] }) }
    const service = new ModelService(repo, llm as never, registry, config)
    await config.set('model.main', '3')
    const resolved = await new ModelRoleResolver(config, repo).resolve('main')
    expect(resolved).toMatchObject({
      provider: 'custom',
      protocol: 'anthropic',
      apiKey: 'custom-key',
      apiBase: 'https://custom.example/anthropic/v1',
    })
    await service.setFallbacks(3, [1])
    await service.test(3)
    expect(llm.chat.mock.calls[0]?.[0]).toMatchObject({
      provider: 'custom',
      protocol: 'anthropic',
      apiKey: 'custom-key',
      fallbackModels: [],
    })
  })

  it('免密本地模型不会因缺少 API Key 被角色解析器过滤，已配置的本地密钥仍保留', async () => {
    await config.set('model.main', '4')
    expect(await new ModelRoleResolver(config, repo).resolve('main')).toMatchObject({
      authMode: 'none',
      apiKey: '',
    })
    expect(await registry.getById(5)).toMatchObject({ authMode: 'api_key', apiKey: 'proxy-key' })
  })

  it('独立覆盖不再从连接补回被清空的密钥，关闭覆盖后整体继承', async () => {
    await repo.update(1, {
      connectionOverride: true,
      connectionProtocol: 'gemini',
      connectionAuthMode: 'none',
      apiBase: 'http://localhost:8080/v1beta',
      apiKey: '',
    })
    expect(await registry.getById(1)).toMatchObject({
      protocol: 'gemini',
      authMode: 'none',
      apiKey: '',
      apiBase: 'http://localhost:8080/v1beta',
    })
    await repo.update(1, { connectionOverride: false })
    expect(await registry.getById(1)).toMatchObject({
      protocol: 'openai',
      apiKey: 'old-global-key',
      apiBase: 'https://old.example/v1',
    })
  })

  it('删除被引用连接必须替换，失败不修改引用；成功保留模型参数与任务指派', async () => {
    await config.set('model.main', '1')
    await repo.update(1, { temperature: 0.6, maxTokens: 1234 })
    await expect(repo.connections.remove('legacy-global-openai')).rejects.toThrow('仍被模型使用')
    await expect(repo.connections.remove('legacy-global-openai', 'missing')).rejects.toThrow(
      '替换连接不存在',
    )
    expect((await repo.findById(1))?.providerConnectionId).toBe('legacy-global-openai')
    await repo.connections.remove('legacy-global-openai', 'legacy-model-2')
    expect(await repo.findById(1)).toMatchObject({
      modelId: 'model-a',
      temperature: 0.6,
      maxTokens: 1234,
      providerConnectionId: 'legacy-model-2',
    })
    expect(await config.get('model.main')).toBe('1')
    expect(await repo.connections.findById('legacy-global-openai')).toBeUndefined()
  })

  it('连接列表不暴露密钥，改名保留身份，显式清空密钥不会恢复旧全局值', async () => {
    const service = new ProviderConnectionService(repo, {} as never, registry)
    expect(await service.list()).toContainEqual(
      expect.objectContaining({ id: 'legacy-global-openai', hasApiKey: true }),
    )
    expect((await service.list()).some((item) => 'apiKey' in item)).toBe(false)
    await service.update('legacy-global-openai', { name: '新的连接名称', apiKey: '' })
    expect(await service.get('legacy-global-openai')).toMatchObject({
      name: '新的连接名称',
      apiKey: '',
    })
    expect(await registry.getById(1)).toMatchObject({ apiKey: '' })
    expect((await repo.findById(1))?.providerConnectionId).toBe('legacy-global-openai')
    const db = drizzle(sqlite, { schema })
    await expect(
      db
        .update(schema.aiModelConfigs)
        .set({ providerConnectionId: 'missing' })
        .where(eq(schema.aiModelConfigs.id, 1)),
    ).rejects.toThrow()
  })
})

describe('自定义 API 路径', () => {
  it.each([
    ['openai', 'chat_completions', 'https://proxy.example/api/v3'],
    ['openai', 'responses', 'https://proxy.example/api/v3'],
    ['anthropic', 'chat_completions', 'https://proxy.example/anthropic/v1'],
    ['gemini', 'chat_completions', 'https://proxy.example/gemini/v1beta'],
  ] as const)(
    '真实 Provider 按独立协议请求，免密列表查询不发送认证：%s / %s',
    async (protocol, wireApi, apiBase) => {
      const request = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ id: 'test-model' }],
              models: [
                { name: 'models/test-model', supportedGenerationMethods: ['generateContent'] },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      )
      const provider = new LlmService().createProvider({
        provider: 'custom',
        protocol,
        wireApi,
        apiBase,
        authMode: 'none',
        apiKey: '不应发送的旧密钥',
        modelId: 'test-model',
      })
      expect(await provider.listModels()).toEqual(['test-model'])
      const [url, options] = request.mock.calls[0]!
      expect(new URL(String(url)).pathname).toBe(new URL(apiBase).pathname + '/models')
      expect(new URL(String(url)).searchParams.has('key')).toBe(false)
      const headers = new Headers(options?.headers)
      expect(headers.has('Authorization')).toBe(false)
      expect(headers.has('x-api-key')).toBe(false)
    },
  )

  it.each([
    ['https://api.example', '/models', 'v1', 'https://api.example/v1/models'],
    ['https://api.example/v1/', '/messages', 'v1', 'https://api.example/v1/messages'],
    ['https://api.example/api/v3', '/models', 'v1', 'https://api.example/api/v3/models'],
    [
      'https://api.example/anthropic/v1',
      '/messages',
      'v1',
      'https://api.example/anthropic/v1/messages',
    ],
    [
      'https://api.example/v1beta',
      '/models/gemini-test:generateContent',
      'v1beta',
      'https://api.example/v1beta/models/gemini-test:generateContent',
    ],
  ])('保留根路径且只补一次版本：%s', (base, path, version, expected) => {
    expect(providerApiUrl(base, path, version)).toBe(expected)
  })
})
