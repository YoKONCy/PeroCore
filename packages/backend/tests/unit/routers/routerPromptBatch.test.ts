import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createModelRouter } from '@infos/backend/routers/model.router'
import { createAssetRouter } from '@infos/backend/routers/asset.router'
import { createSystemRouter } from '@infos/backend/routers/system.router'
// AIOS: PromptService 已废弃移除（死代码清理），相关测试块一并移除

const appVersion = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
).version

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function createModelCtx() {
  const model = { id: 1, name: '主模型', provider: 'openai', modelId: 'gpt-4o', apiKey: '****' }
  return {
    modelService: {
      list: vi.fn(() => Promise.resolve([model])),
      getById: vi.fn(() => Promise.resolve(model)),
      create: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
      update: vi.fn((id: number, body: Record<string, unknown>) =>
        Promise.resolve({ id, ...body }),
      ),
      delete: vi.fn(() => Promise.resolve()),
      listRemoteModels: vi.fn(() => Promise.resolve(['gpt-4o', 'gpt-4.1'])),
      test: vi.fn(() => Promise.resolve({ success: true, durationMs: 12, response: 'OK' })),
    },
  }
}

function createAssetCtx() {
  const asset = { assetId: 'a1', type: 'prompt', source: 'official' }
  return {
    assetRegistry: {
      getAllAssets: vi.fn(() => [asset]),
      getAssetsByType: vi.fn(() => [asset]),
      getAssetsBySource: vi.fn(() => [asset]),
      rescan: vi.fn(() => Promise.resolve()),
    },
    promptTemplateLoader: {
      exportToCustom: vi.fn((path: string) => Promise.resolve(`custom/${path}`)),
      restoreToOfficial: vi.fn(() => Promise.resolve(true)),
      getSource: vi.fn(() => 'custom'),
      isCustomized: vi.fn(() => true),
    },
  }
}

// AIOS: createEnriched / createAgent 辅助函数已随 PromptService 测试块一并移除

describe('ModelRouter', () => {
  it('应当提供模型 CRUD、远程列表和连通性测试端点', async () => {
    const ctx = createModelCtx()
    const router = createModelRouter(ctx as never)

    const list = await router.request('http://test/')
    const get = await router.request('http://test/1')
    const created = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({
        name: '新模型',
        provider: 'openai',
        modelId: 'gpt-new',
        apiKey: 'key',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const updated = await router.request('http://test/1', {
      method: 'PUT',
      body: JSON.stringify({ temperature: null, topP: null, maxTokens: null }),
      headers: { 'content-type': 'application/json' },
    })
    const deleted = await router.request('http://test/1', { method: 'DELETE' })
    const remote = await router.request('http://test/list-remote', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', apiKey: 'key', apiBase: 'base' }),
      headers: { 'content-type': 'application/json' },
    })
    const tested = await router.request('http://test/1/test', { method: 'POST' })

    expect(await readJson(list)).toMatchObject({ code: 'OK', data: [{ id: 1 }] })
    expect(await readJson(get)).toMatchObject({ code: 'OK', data: { id: 1 } })
    expect(created.status).toBe(201)
    expect(await readJson(created)).toMatchObject({
      code: 'CREATED',
      data: { id: 2, name: '新模型' },
    })
    expect(await readJson(updated)).toMatchObject({
      code: 'OK',
      data: { id: 1, temperature: null, topP: null, maxTokens: null },
    })
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '模型配置已删除' })
    expect(await readJson(remote)).toMatchObject({ code: 'OK', data: ['gpt-4o', 'gpt-4.1'] })
    expect(await readJson(tested)).toMatchObject({ code: 'OK', data: { success: true } })
    expect(ctx.modelService.listRemoteModels).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'key',
      apiBase: 'base',
    })
  })

  it('应当拒绝非法创建模型请求', async () => {
    const router = createModelRouter(createModelCtx() as never)

    const response = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ name: '', provider: '', modelId: '' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(400)
  })
})

describe('AssetRouter', () => {
  it('应当查询资产、重扫资产并管理提示词覆盖层', async () => {
    const ctx = createAssetCtx()
    const router = createAssetRouter(ctx as never)

    const all = await router.request('http://test/')
    const byType = await router.request('http://test/by-type/prompt')
    const bySource = await router.request('http://test/by-source/official')
    const rescan = await router.request('http://test/rescan', { method: 'POST' })
    const exported = await router.request('http://test/export-to-custom', {
      method: 'POST',
      body: JSON.stringify({ templatePath: 'tasks/demo.md' }),
      headers: { 'content-type': 'application/json' },
    })
    const restored = await router.request('http://test/restore', {
      method: 'POST',
      body: JSON.stringify({ templatePath: 'tasks/demo.md' }),
      headers: { 'content-type': 'application/json' },
    })
    const source = await router.request('http://test/prompt-source/tasks/demo.md')

    expect(await readJson(all)).toMatchObject({ code: 'OK', data: [{ assetId: 'a1' }] })
    expect(await readJson(byType)).toMatchObject({ code: 'OK', data: [{ type: 'prompt' }] })
    expect(await readJson(bySource)).toMatchObject({ code: 'OK', data: [{ source: 'official' }] })
    expect(await readJson(rescan)).toMatchObject({ code: 'OK', data: { totalAssets: 1 } })
    expect(await readJson(exported)).toMatchObject({
      code: 'OK',
      data: { templatePath: 'tasks/demo.md', exportedPath: 'custom/tasks/demo.md' },
    })
    expect(await readJson(restored)).toMatchObject({
      code: 'OK',
      data: { templatePath: 'tasks/demo.md', restored: true },
    })
    expect(await readJson(source)).toMatchObject({
      code: 'OK',
      data: { templatePath: 'tasks/demo.md', source: 'custom', isCustomized: true },
    })
  })

  it('应当在模板无需恢复时返回幂等结果', async () => {
    const ctx = createAssetCtx()
    ctx.promptTemplateLoader.restoreToOfficial.mockResolvedValueOnce(false)
    const router = createAssetRouter(ctx as never)

    const response = await router.request('http://test/restore', {
      method: 'POST',
      body: JSON.stringify({ templatePath: 'tasks/demo.md' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(response)).toMatchObject({
      code: 'OK',
      message: '该模板本就是官方版本，无需恢复',
      data: { restored: false },
    })
  })
})

describe('SystemRouter', () => {
  it('应当返回健康检查和系统信息', async () => {
    const ctx = {
      agentManager: {
        listAgents: vi.fn(() => [
          { id: 'pero', isEnabled: true },
          { id: 'neko', isEnabled: false },
        ]),
        // AIOS: activeAgentId 已重命名为 defaultAgentId
        defaultAgentId: 'pero',
      },
      systemService: {
        getSnapshot: vi.fn(() =>
          Promise.resolve({
            memoryUsedMB: 100,
            heapUsedMB: 50,
            cpuPercent: 12,
            totalMemoryMB: 16000,
            sqliteSizeMB: 3,
            triviumSizeMB: 4,
          }),
        ),
        openPath: vi.fn(() => Promise.resolve()),
      },
      gatewayHub: { connectedCount: 2 },
      storeRegistry: { countExistingNodes: vi.fn(() => 27) },
    }
    const router = createSystemRouter(ctx as never)

    const health = await router.request('http://test/health')
    const info = await router.request('http://test/info')
    const open = await router.request('http://test/open-path', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:/demo' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(health)).toMatchObject({ code: 'OK', data: { status: 'healthy' } })
    expect(await readJson(info)).toMatchObject({
      code: 'OK',
      data: {
        version: appVersion,
        runtime: { memoryUsage: { rss: 100, heapUsed: 50 }, cpuPercent: 12, totalMemoryMB: 16000 },
        storage: { sqliteSizeMB: 3, triviumSizeMB: 4, triviumNodeCount: 27 },
        agents: { total: 2, enabled: 1, activeId: 'pero' },
        gateway: { connectedNodes: 2 },
      },
    })
    expect(await readJson(open)).toEqual({ code: 'OK', message: '已请求打开' })
    expect(ctx.systemService.openPath).toHaveBeenCalledWith('C:/demo')
  })
})

// AIOS: PromptService 已废弃移除（死代码清理），相关测试块一并移除
