import { describe, expect, it, vi } from 'vitest'
import { createModelRouter } from '@perocore/backend/routers/model.router'
import { createAssetRouter } from '@perocore/backend/routers/asset.router'
import { createSystemRouter } from '@perocore/backend/routers/system.router'
import { PromptService } from '@perocore/backend/services/prompt/promptService'

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

function createEnriched(overrides: Record<string, string> = {}) {
  return {
    currentTime: '2026-01-01',
    flattenedDesktopHistory: '桌面历史',
    flattenedGroupHistory: '群聊历史',
    memoryContext: '记忆',
    graphContext: '图谱',
    weeklyReportContext: '周报',
    mood: '开心',
    vibe: '轻松',
    mind: '专注',
    ownerName: '主人',
    userPersona: '用户画像',
    environmentInfo: '环境',
    socialContext: '社交上下文',
    ...overrides,
  }
}

function createAgent() {
  return {
    id: 'pero',
    name: 'Pero',
    description: '猫娘助手',
    workPersona: '工作人设',
    socialPersona: '社交人设',
  }
}

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
      body: JSON.stringify({ temperature: 0.2 }),
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
    expect(await readJson(updated)).toMatchObject({ code: 'OK', data: { id: 1, temperature: 0.2 } })
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
        activeAgentId: 'pero',
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
        version: '0.9-rc2',
        runtime: { memoryUsage: { rss: 100, heapUsed: 50 }, cpuPercent: 12, totalMemoryMB: 16000 },
        storage: { sqliteSizeMB: 3, triviumSizeMB: 4 },
        agents: { total: 2, enabled: 1, activeId: 'pero' },
        gateway: { connectedNodes: 2 },
      },
    })
    expect(await readJson(open)).toEqual({ code: 'OK', message: '已请求打开' })
    expect(ctx.systemService.openPath).toHaveBeenCalledWith('C:/demo')
  })
})

describe('PromptService', () => {
  it('应当按默认槽位、内置预设和用户预设组装消息', () => {
    const slots = [{ id: 'base', role: 'system', template: 'base', enabled: true }]
    const builtinPreset = {
      name: 'social',
      description: '社交',
      slots: [{ id: 'social', enabled: true, position: 1 }],
    }
    const userPreset = {
      name: 'user',
      description: '用户',
      slots: [{ id: 'user', enabled: true, position: 2 }],
    }
    const mdp = {
      buildDefaultSlots: vi.fn(() => slots),
      applyPreset: vi.fn((input, preset) => [...input, ...preset.slots]),
      renderSlots: vi.fn(() => [{ role: 'system', content: '渲染结果' }]),
    }
    const agentManager = { getAgent: vi.fn(() => createAgent()) }
    const presetLoader = { getPresetForSource: vi.fn(() => builtinPreset) }
    const service = new PromptService(mdp as never, agentManager as never, presetLoader as never)

    const result = service.buildPromptMessages(
      'pero',
      'social',
      createEnriched() as never,
      userPreset as never,
      { extra: '覆盖' },
    )

    expect(result.messages).toEqual([{ role: 'system', content: '渲染结果' }])
    expect(result.slots).toEqual([...slots, ...builtinPreset.slots, ...userPreset.slots])
    expect(mdp.renderSlots).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        agent_name: 'Pero',
        source: 'social',
        extra: '覆盖',
        social_context: '社交上下文',
      }),
      { mergeAdjacentRoles: true, skipEmpty: true },
    )
  })

  it('应当用内置预设兼容 assemble 的 systemPrompt 汇总模式', () => {
    const mdp = {
      buildDefaultSlots: vi.fn(() => [{ id: 'base', enabled: true }]),
      applyPreset: vi.fn((input) => input),
      renderSlots: vi.fn(() => [
        { role: 'system', content: '第一段' },
        { role: 'user', content: '用户段' },
        { role: 'system', content: '第二段' },
      ]),
    }
    const service = new PromptService(
      mdp as never,
      { getAgent: vi.fn(() => createAgent()) } as never,
      {
        getPresetForSource: vi.fn(() => ({ name: 'work', description: '工作', slots: [] })),
      } as never,
    )

    const result = service.assemble('pero', 'work', createEnriched() as never)

    expect(result).toEqual({ systemPrompt: '第一段\n\n第二段', footer: '' })
  })

  it('应当在无预设时使用单模板并追加来源人设和有效 footer', () => {
    const mdp = {
      render: vi.fn((key: string) => (key === 'system_prompt' ? '系统提示词' : 'Footer 内容')),
      renderString: vi.fn((template: string) => `渲染:${template}`),
      buildDefaultSlots: vi.fn(() => []),
    }
    const service = new PromptService(
      mdp as never,
      { getAgent: vi.fn(() => createAgent()) } as never,
      { getPresetForSource: vi.fn(() => undefined) } as never,
    )

    const result = service.assemble('pero', 'ide', createEnriched() as never)
    const rendered = service.renderTemplate('task', { a: 1 })
    const renderedString = service.renderString('你好 {{name}}', { name: '主人' })

    expect(result).toEqual({ systemPrompt: '系统提示词\n\n工作人设', footer: 'Footer 内容' })
    expect(rendered).toBe('Footer 内容')
    expect(renderedString).toBe('渲染:你好 {{name}}')
  })

  it('应当在 Agent 不存在时抛出配置错误并隐藏缺失 footer', () => {
    const missingAgentService = new PromptService(
      { buildDefaultSlots: vi.fn(), render: vi.fn() } as never,
      { getAgent: vi.fn(() => null) } as never,
      { getPresetForSource: vi.fn(() => undefined) } as never,
    )
    const footerService = new PromptService(
      {
        render: vi.fn((key: string) =>
          key === 'system_prompt' ? '系统提示词' : '{{Missing footer}}',
        ),
      } as never,
      { getAgent: vi.fn(() => createAgent()) } as never,
      { getPresetForSource: vi.fn(() => undefined) } as never,
    )

    expect(() =>
      missingAgentService.buildPromptMessages('missing', 'desktop', createEnriched() as never),
    ).toThrow('Agent missing 未找到')
    expect(() =>
      missingAgentService.assemble('missing', 'desktop', createEnriched() as never),
    ).toThrow('Agent missing 未找到')
    expect(footerService.assemble('pero', 'desktop', createEnriched() as never)).toEqual({
      systemPrompt: '系统提示词',
      footer: '',
    })
  })
})
