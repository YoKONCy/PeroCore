import { describe, expect, it, vi } from 'vitest'
import { createAgentRouter } from '@perocore/backend/routers/agent.router'
import { createMemoryRouter } from '@perocore/backend/routers/memory.router'
import { createMcpRouter } from '@perocore/backend/routers/mcp.router'
import { createVoiceRouter } from '@perocore/backend/routers/voice.router'

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function createAgent() {
  return {
    id: 'pero',
    name: 'Pero',
    description: '猫娘助手',
    avatarPath: 'avatar.png',
    workTraits: ['认真'],
    socialTraits: ['活泼'],
    useStickers: true,
  }
}

describe('AgentRouter', () => {
  function createCtx() {
    const agent = createAgent()
    return {
      agentManager: {
        activeAgentId: 'pero',
        listAgents: vi.fn(() => [agent]),
        getActiveAgent: vi.fn(() => agent),
        getAvatarData: vi.fn(() => ({
          mime: 'image/png',
          buffer: new Uint8Array([1, 2, 3]).buffer,
        })),
        setActiveAgent: vi.fn((id: string) => id === 'pero'),
        getAgent: vi.fn((id: string) => (id === 'pero' ? agent : null)),
        createAgent: vi.fn((body: Record<string, unknown>) => body),
        deleteAgent: vi.fn(),
        enableAgent: vi.fn((id: string) => id === 'pero'),
        disableAgent: vi.fn((id: string) => id === 'pero'),
        reloadAgents: vi.fn(),
        getWaifuTexts: vi.fn((id: string) =>
          Promise.resolve(id === 'pero' ? { idle: ['喵'] } : null),
        ),
      },
      gatewayHub: { pushStateUpdate: vi.fn(() => Promise.resolve()) },
      capabilityGate: {
        getAgentModes: vi.fn(() => ['chat']),
        getAgentSkills: vi.fn(() => ['memory']),
      },
    }
  }

  it('应当管理 Agent 查询、切换、头像和能力配置', async () => {
    const ctx = createCtx()
    const router = createAgentRouter(ctx as never)

    const list = await router.request('http://test/')
    const active = await router.request('http://test/active')
    const avatar = await router.request('http://test/pero/avatar')
    const switched = await router.request('http://test/active', {
      method: 'PUT',
      body: JSON.stringify({ agentId: 'pero' }),
      headers: { 'content-type': 'application/json' },
    })
    const detail = await router.request('http://test/pero')
    const capabilities = await router.request('http://test/pero/capabilities')
    const texts = await router.request('http://test/pero/texts')

    expect(await readJson(list)).toMatchObject({
      code: 'OK',
      data: [{ id: 'pero', avatarUrl: '/agents/pero/avatar' }],
    })
    expect(await readJson(active)).toMatchObject({ code: 'OK', data: { id: 'pero' } })
    expect(avatar.headers.get('content-type')).toBe('image/png')
    expect(await avatar.arrayBuffer()).toHaveProperty('byteLength', 3)
    expect(await readJson(switched)).toMatchObject({ code: 'OK', data: { agentId: 'pero' } })
    expect(ctx.gatewayHub.pushStateUpdate).toHaveBeenCalledWith({
      action: 'agent_changed',
      agentId: 'pero',
    })
    expect(await readJson(detail)).toMatchObject({
      code: 'OK',
      data: { id: 'pero', useStickers: true },
    })
    expect(await readJson(capabilities)).toMatchObject({
      code: 'OK',
      data: { agentId: 'pero', modes: ['chat'], skills: ['memory'] },
    })
    expect(await readJson(texts)).toMatchObject({ code: 'OK', data: { idle: ['喵'] } })
  })

  it('应当创建、删除、启用、禁用和重载 Agent', async () => {
    const ctx = createCtx()
    const router = createAgentRouter(ctx as never)

    const created = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ id: 'neko', name: 'Neko', description: '测试' }),
      headers: { 'content-type': 'application/json' },
    })
    const deleted = await router.request('http://test/neko', { method: 'DELETE' })
    const enabled = await router.request('http://test/pero/enable', { method: 'POST' })
    const disabled = await router.request('http://test/pero/disable', { method: 'POST' })
    const reloaded = await router.request('http://test/reload', { method: 'POST' })

    expect(created.status).toBe(201)
    expect(await readJson(created)).toMatchObject({
      code: 'CREATED',
      data: { id: 'neko', name: 'Neko' },
    })
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: 'Agent "neko" 已删除' })
    expect(await readJson(enabled)).toEqual({ code: 'OK', message: 'Agent pero 已启用' })
    expect(await readJson(disabled)).toEqual({ code: 'OK', message: 'Agent pero 已禁用' })
    expect(await readJson(reloaded)).toMatchObject({ code: 'OK', data: [{ id: 'pero' }] })
  })

  it('应当处理缺失头像和非法创建请求', async () => {
    const ctx = createCtx()
    ctx.agentManager.getAvatarData.mockReturnValueOnce(null as never)
    const router = createAgentRouter(ctx as never)

    const avatar = await router.request('http://test/pero/avatar')
    const invalid = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ id: 'Bad ID', name: '' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(avatar.status).toBe(404)
    expect(await readJson(avatar)).toEqual({ code: 'NOT_FOUND', message: '该 Agent 没有头像' })
    expect(invalid.status).toBe(400)
  })
})

describe('MemoryRouter', () => {
  function createCtx() {
    return {
      memoryService: {
        list: vi.fn(() => Promise.resolve({ items: [{ id: 1, content: '记忆' }], total: 1 })),
        create: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
        getGraph: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
        delete: vi.fn(() => Promise.resolve()),
      },
      memoryImporter: {
        importStory: vi.fn(() => Promise.resolve({ imported: 2 })),
      },
      memorySearchService: {
        search: vi.fn(() => Promise.resolve([{ id: 1, score: 0.9 }])),
      },
    }
  }

  it('应当提供记忆列表、创建、导入、搜索、图谱和删除', async () => {
    const ctx = createCtx()
    const router = createMemoryRouter(ctx as never)

    const list = await router.request('http://test/?agentId=pero&page=2&pageSize=5')
    const created = await router.request('http://test/', {
      method: 'POST',
      body: JSON.stringify({ content: '新记忆', agentId: 'pero' }),
      headers: { 'content-type': 'application/json' },
    })
    const imported = await router.request('http://test/import', {
      method: 'POST',
      body: JSON.stringify({ story: '很长的故事', source: 'story' }),
      headers: { 'content-type': 'application/json' },
    })
    const searched = await router.request('http://test/search', {
      method: 'POST',
      body: JSON.stringify({ query: '猫咪', agentId: 'pero', topK: 3 }),
      headers: { 'content-type': 'application/json' },
    })
    const graph = await router.request('http://test/graph?agentId=pero&limit=10')
    const deleted = await router.request('http://test/1?agentId=pero&source=desktop', {
      method: 'DELETE',
    })

    expect(await readJson(list)).toMatchObject({ code: 'OK', data: { total: 1 } })
    expect(ctx.memoryService.list).toHaveBeenCalledWith({ agentId: 'pero', page: 2, pageSize: 5 })
    expect(created.status).toBe(201)
    expect(await readJson(created)).toMatchObject({
      code: 'CREATED',
      data: {
        content: '新记忆',
        importance: 5,
        sentiment: 'neutral',
        type: 'event',
        source: 'desktop',
      },
    })
    expect(await readJson(imported)).toMatchObject({ code: 'OK', message: '导入完成: 2 条记忆' })
    expect(await readJson(searched)).toMatchObject({ code: 'OK', data: [{ score: 0.9 }] })
    expect(ctx.memorySearchService.search).toHaveBeenCalledWith({
      query: '猫咪',
      agentId: 'pero',
      source: 'desktop',
      topK: 3,
      minScore: undefined,
    })
    expect(await readJson(graph)).toMatchObject({ code: 'OK', data: { nodes: [], edges: [] } })
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '记忆已删除' })
    expect(ctx.memoryService.delete).toHaveBeenCalledWith(1, 'pero', 'desktop')
  })

  it('应当拒绝空导入和非法删除 ID', async () => {
    const router = createMemoryRouter(createCtx() as never)

    const emptyImport = await router.request('http://test/import', {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
      headers: { 'content-type': 'application/json' },
    })
    const invalidDelete = await router.request('http://test/not-number', { method: 'DELETE' })

    expect(emptyImport.status).toBe(400)
    expect(await readJson(emptyImport)).toMatchObject({ code: 'MISSING_FIELD' })
    expect(invalidDelete.status).toBe(400)
    expect(await readJson(invalidDelete)).toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})

describe('McpRouter', () => {
  function createCtx(hasManager = true) {
    return {
      mcpRepo: {
        findAll: vi.fn(() =>
          Promise.resolve([{ id: 1, name: 'fs', args: '["--root"]', env: '{"A":"B"}' }]),
        ),
        findByName: vi.fn(() => Promise.resolve(null)),
        create: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
        update: vi.fn((id: number, body: Record<string, unknown>) =>
          Promise.resolve({ id, ...body }),
        ),
        findById: vi.fn(() => Promise.resolve({ id: 1, name: 'fs' })),
        delete: vi.fn(() => Promise.resolve(true)),
        toggleEnabled: vi.fn((id: number) => Promise.resolve({ id, enabled: false })),
      },
      mcpManager: hasManager
        ? {
            disconnectOne: vi.fn(() => Promise.resolve()),
            connectAll: vi.fn(() => Promise.resolve()),
            reconnectOne: vi.fn(() =>
              Promise.resolve({
                name: 'fs',
                status: 'connected',
                tools: [{ name: 'read' }],
                error: undefined,
              }),
            ),
            getStatus: vi.fn(() => ({
              totalServers: 1,
              connectedServers: 1,
              totalTools: 1,
              connections: [],
            })),
            getAllTools: vi.fn(() => [{ name: 'read' }]),
          }
        : undefined,
      skillLoader: {
        getAllManifests: vi.fn(() => [{ id: 'skill-a' }]),
        loadSkillContent: vi.fn((id: string) => (id === 'skill-a' ? '内容' : null)),
        reloadAll: vi.fn(),
        importFromPath: vi.fn(() => 'skill-b'),
        deleteById: vi.fn(),
      },
    }
  }

  it('应当管理 MCP 配置、连接状态和工具列表', async () => {
    const ctx = createCtx()
    const router = createMcpRouter(ctx as never)

    const configs = await router.request('http://test/configs')
    const created = await router.request('http://test/configs', {
      method: 'POST',
      body: JSON.stringify({ name: 'shell', command: 'node' }),
      headers: { 'content-type': 'application/json' },
    })
    const updated = await router.request('http://test/configs/1', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
      headers: { 'content-type': 'application/json' },
    })
    const toggled = await router.request('http://test/configs/1/toggle', { method: 'POST' })
    const connected = await router.request('http://test/connect', { method: 'POST' })
    const reconnected = await router.request('http://test/fs/reconnect', { method: 'POST' })
    const status = await router.request('http://test/status')
    const tools = await router.request('http://test/tools')
    const deleted = await router.request('http://test/configs/1', { method: 'DELETE' })

    expect(await readJson(configs)).toMatchObject({
      code: 'OK',
      data: [{ args: ['--root'], env: { A: 'B' } }],
    })
    expect(created.status).toBe(201)
    expect(await readJson(created)).toMatchObject({
      code: 'CREATED',
      data: { id: 2, name: 'shell' },
    })
    expect(await readJson(updated)).toMatchObject({ code: 'OK', data: { id: 1, enabled: false } })
    expect(await readJson(toggled)).toMatchObject({ code: 'OK', data: { id: 1, enabled: false } })
    expect(await readJson(connected)).toMatchObject({ code: 'OK', data: { totalServers: 1 } })
    expect(await readJson(reconnected)).toMatchObject({
      code: 'OK',
      data: { name: 'fs', status: 'connected', toolCount: 1 },
    })
    expect(await readJson(status)).toMatchObject({ code: 'OK', data: { connectedServers: 1 } })
    expect(await readJson(tools)).toMatchObject({ code: 'OK', data: [{ name: 'read' }] })
    expect(await readJson(deleted)).toMatchObject({ code: 'OK', data: { deleted: true } })
    expect(ctx.mcpManager!.disconnectOne).toHaveBeenCalledWith('fs')
  })

  it('应当管理 Skill 内容、重载、导入和删除', async () => {
    const ctx = createCtx()
    const router = createMcpRouter(ctx as never)

    const skills = await router.request('http://test/skills')
    const content = await router.request('http://test/skills/skill-a/content')
    const reloaded = await router.request('http://test/skills/reload', { method: 'POST' })
    const imported = await router.request('http://test/skills/import', {
      method: 'POST',
      body: JSON.stringify({ sourcePath: 'C:/skills/demo' }),
      headers: { 'content-type': 'application/json' },
    })
    const deleted = await router.request('http://test/skills/skill-a', { method: 'DELETE' })

    expect(await readJson(skills)).toMatchObject({ code: 'OK', data: [{ id: 'skill-a' }] })
    expect(await readJson(content)).toMatchObject({
      code: 'OK',
      data: { id: 'skill-a', content: '内容' },
    })
    expect(await readJson(reloaded)).toMatchObject({ code: 'OK', message: '已重新加载 1 个 Skill' })
    expect(await readJson(imported)).toMatchObject({
      code: 'OK',
      message: 'Skill "skill-b" 已成功导入',
    })
    expect(await readJson(deleted)).toMatchObject({ code: 'OK', message: 'Skill "skill-a" 已删除' })
  })

  it('应当在 MCP Manager 缺失时返回未初始化状态', async () => {
    const router = createMcpRouter(createCtx(false) as never)

    const status = await router.request('http://test/status')
    const tools = await router.request('http://test/tools')

    expect(await readJson(status)).toMatchObject({
      code: 'OK',
      message: 'MCP 未初始化',
      data: { totalServers: 0 },
    })
    expect(await readJson(tools)).toEqual({ code: 'OK', message: '获取成功', data: [] })
  })
})

describe('VoiceRouter', () => {
  function createDeps() {
    return {
      ttsService: {
        isAvailable: true,
        synthesize: vi.fn(() =>
          Promise.resolve({ audio: new Uint8Array([1, 2]).buffer, mimeType: 'audio/mpeg' }),
        ),
      },
      asrService: {
        isAvailable: false,
        recognize: vi.fn(() =>
          Promise.resolve({ text: '你好', language: 'zh', confidence: 0.9, durationMs: 12 }),
        ),
      },
    }
  }

  it('应当合成语音、识别二进制音频并返回状态', async () => {
    const deps = createDeps()
    const router = createVoiceRouter(deps as never)

    const tts = await router.request('http://test/tts', {
      method: 'POST',
      body: JSON.stringify({ text: '你好', voice: 'alloy', speed: 1, format: 'mp3' }),
      headers: { 'content-type': 'application/json' },
    })
    const asr = await router.request('http://test/asr?language=zh', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      headers: { 'content-type': 'audio/webm' },
    })
    const status = await router.request('http://test/status')

    expect(tts.headers.get('content-type')).toBe('audio/mpeg')
    expect(tts.headers.get('content-length')).toBe('2')
    expect(deps.ttsService.synthesize).toHaveBeenCalledWith({
      text: '你好',
      voice: 'alloy',
      speed: 1,
      format: 'mp3',
    })
    expect(await readJson(asr)).toMatchObject({
      code: 'OK',
      data: { text: '你好', language: 'zh' },
    })
    expect(deps.asrService.recognize).toHaveBeenCalledWith({
      audio: expect.any(ArrayBuffer),
      mimeType: 'audio/webm',
      language: 'zh',
    })
    expect(await readJson(status)).toMatchObject({
      code: 'OK',
      data: { tts: { available: true }, asr: { available: false } },
    })
  })

  it('应当识别 multipart 音频并拒绝空文本和空音频', async () => {
    const deps = createDeps()
    const router = createVoiceRouter(deps as never)
    const form = new FormData()
    form.set('audio', new File([new Uint8Array([1])], 'a.webm', { type: 'audio/webm' }))
    form.set('language', 'ja')

    const multipart = await router.request('http://test/asr', { method: 'POST', body: form })
    const emptyText = await router.request('http://test/tts', {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
      headers: { 'content-type': 'application/json' },
    })
    const emptyAudio = await router.request('http://test/asr', {
      method: 'POST',
      body: new Uint8Array([]),
      headers: { 'content-type': 'audio/webm' },
    })

    expect(await readJson(multipart)).toMatchObject({ code: 'OK', data: { text: '你好' } })
    expect(deps.asrService.recognize).toHaveBeenCalledWith({
      audio: expect.any(ArrayBuffer),
      mimeType: 'audio/webm',
      language: 'ja',
    })
    expect(emptyText.status).toBe(500)
    expect(emptyAudio.status).toBe(500)
  })
})
