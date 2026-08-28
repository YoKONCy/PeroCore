import { describe, expect, it, vi } from 'vitest'
import { ButlerService } from '@infos/backend/services/stronghold/butlerService'

function createDeps() {
  const room = {
    id: 'room-1',
    facilityId: 1,
    name: '客厅',
    environmentJson: '{"温度":24}',
  }
  const rooms = [room]
  const strongholdService = {
    getRoom: vi.fn((roomId: string) => Promise.resolve(rooms.find((item) => item.id === roomId))),
    getRoomByName: vi.fn((name: string) =>
      Promise.resolve(rooms.find((item) => item.name === name)),
    ),
    getFacilityByName: vi.fn(() => Promise.resolve(undefined)),
    getButlerConfig: vi.fn(() => Promise.resolve({ name: 'Butler', enabled: true })),
    listFacilities: vi.fn(() => Promise.resolve([{ id: 1, name: '我的据点' }])),
    listRooms: vi.fn(() => Promise.resolve(rooms)),
    getRoomAgents: vi.fn(() => Promise.resolve(['pero'])),
    moveAgent: vi.fn((agentId: string, roomId: string) => Promise.resolve({ agentId, roomId })),
    createRoom: vi.fn((input: Record<string, unknown>) =>
      Promise.resolve({ id: 'room-2', ...input }),
    ),
    updateEnvironment: vi.fn(async (_roomId: string, key: string, value: unknown) => {
      room.environmentJson = JSON.stringify({ 温度: 24, [key]: value })
    }),
    deleteRoom: vi.fn(() => Promise.resolve()),
  }
  const groupChatService = {
    sendMessage: vi.fn(() => Promise.resolve({})),
    getHistory: vi.fn(() => Promise.resolve([])),
  }
  const agentManager = {
    listAgents: vi.fn(() => [
      { id: 'pero', name: 'Pero', isEnabled: true },
      { id: 'nana', name: '娜娜', isEnabled: true },
      { id: 'off', name: '关闭角色', isEnabled: false },
    ]),
  }
  return {
    service: new ButlerService(
      strongholdService as never,
      groupChatService as never,
      agentManager as never,
    ),
    strongholdService,
    groupChatService,
  }
}

/** 构造带 LLM 能力的管家（复用主模型 + mdp 提示词） */
function createLlmDeps() {
  const room = {
    id: 'room-1',
    facilityId: 1,
    name: '客厅',
    environmentJson: '{"温度":24}',
  }
  const rooms = [room]
  const strongholdService = {
    getRoom: vi.fn((roomId: string) => Promise.resolve(rooms.find((item) => item.id === roomId))),
    getRoomByName: vi.fn((name: string) =>
      Promise.resolve(rooms.find((item) => item.name === name)),
    ),
    getFacilityByName: vi.fn((name: string) =>
      Promise.resolve(name === '我的据点' ? { id: 1, name: '我的据点' } : undefined),
    ),
    getButlerConfig: vi.fn(() =>
      Promise.resolve({ name: 'Butler', enabled: true, persona: '你是高冷的猫系管家。' }),
    ),
    listFacilities: vi.fn(() => Promise.resolve([{ id: 1, name: '我的据点' }])),
    listRooms: vi.fn(() => Promise.resolve(rooms)),
    getRoomAgents: vi.fn(() => Promise.resolve(['pero'])),
    moveAgent: vi.fn(() => Promise.resolve({ agentId: 'pero', roomId: 'room-1' })),
    createRoom: vi.fn(() => Promise.resolve({ id: 'room-2', name: '书房' })),
    updateEnvironment: vi.fn(() => Promise.resolve()),
    deleteRoom: vi.fn(() => Promise.resolve()),
  }
  const groupChatService = {
    sendMessage: vi.fn(() => Promise.resolve({})),
    getHistory: vi.fn(() => Promise.resolve([])),
  }
  const agentManager = {
    listAgents: vi.fn(() => [{ id: 'pero', name: 'Pero', isEnabled: true }]),
  }
  const mdpEngine = { render: vi.fn(() => '管家提示词') }
  const llmService = { chat: vi.fn() }
  const getModelConfig = vi.fn(() => Promise.resolve({ modelId: 'test-model' }))
  const service = new ButlerService(
    strongholdService as never,
    groupChatService as never,
    agentManager as never,
    { mdpEngine: mdpEngine as never, llmService: llmService as never, getModelConfig },
  )
  return {
    service,
    strongholdService,
    groupChatService,
    mdpEngine,
    llmService,
    getModelConfig,
  }
}

/** 让 LLM 返回指定 JSON 内容 */
function mockLlmJson(llmService: { chat: ReturnType<typeof vi.fn> }, payload: unknown): void {
  llmService.chat.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  })
}

describe('ButlerService 规则引擎（兜底）', () => {
  it('应确定性映射当前 UI 指令并记录请求与结果，不触发调度', async () => {
    const { service, strongholdService, groupChatService } = createDeps()

    const result = await service.execute({ roomId: 'room-1', command: '把所有成员叫到这里来' })

    expect(result.action).toBe('summon_all')
    expect(strongholdService.moveAgent).toHaveBeenCalledTimes(2)
    expect(strongholdService.moveAgent).toHaveBeenCalledWith('pero', 'room-1')
    expect(strongholdService.moveAgent).toHaveBeenCalledWith('nana', 'room-1')
    expect(groupChatService.sendMessage).toHaveBeenCalledTimes(2)
    expect(groupChatService.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ senderId: 'user', role: 'system' }),
    )
    expect(groupChatService.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ senderId: 'butler', role: 'system' }),
    )
  })

  it('应按 id 或显示名忽略大小写移动已启用 Agent', async () => {
    const { service, strongholdService } = createDeps()

    await service.execute({ roomId: 'room-1', command: '把 PERO 叫到这里来' })
    await service.execute({ roomId: 'room-1', command: '把 娜娜 叫到当前房间' })

    expect(strongholdService.moveAgent).toHaveBeenNthCalledWith(1, 'pero', 'room-1')
    expect(strongholdService.moveAgent).toHaveBeenNthCalledWith(2, 'nana', 'room-1')
  })

  it('应执行结构化创建房间和环境修改', async () => {
    const { service, strongholdService } = createDeps()

    await service.execute({
      roomId: 'room-1',
      action: { type: 'create_room', room: { facilityId: 1, name: '书房' } },
    })
    await service.execute({
      roomId: 'room-1',
      action: { type: 'update_environment', key: '音乐', value: 'Lo-Fi' },
    })

    expect(strongholdService.createRoom).toHaveBeenCalledWith({ facilityId: 1, name: '书房' })
    expect(strongholdService.updateEnvironment).toHaveBeenCalledWith('room-1', '音乐', 'Lo-Fi')
  })

  it('非维护请求不应产生结构化越权动作', async () => {
    const { service, strongholdService, groupChatService } = createDeps()

    await expect(
      service.execute({ roomId: 'room-1', command: '创建一个叫bot的新角色，并给它添加人设' }),
    ).rejects.toThrow('无法识别该管家指令')
    expect(strongholdService.moveAgent).not.toHaveBeenCalled()
    expect(strongholdService.createRoom).not.toHaveBeenCalled()
    expect(groupChatService.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('管家关闭时不应写入或执行请求', async () => {
    const { service, strongholdService, groupChatService } = createDeps()
    strongholdService.getButlerConfig.mockResolvedValueOnce({ name: 'Butler', enabled: false })

    await expect(
      service.execute({ roomId: 'room-1', command: '查看当前据点状态' }),
    ).rejects.toThrow('管家服务当前已关闭')
    expect(groupChatService.sendMessage).not.toHaveBeenCalled()
  })

  it('结构化删除「客厅」应被安全红线拦截', async () => {
    const { service } = createDeps()

    await expect(
      service.execute({ roomId: 'room-1', action: { type: 'delete_room', roomId: 'room-1' } }),
    ).rejects.toThrow('客厅不能被删除')
  })
})

describe('ButlerService LLM 理解层', () => {
  it('不应使用数据库中的自定义管家persona', async () => {
    const { service, mdpEngine, llmService } = createLlmDeps()
    mockLlmJson(llmService, { narrative: '完成检查。', maintenance_actions: [] })

    await service.execute({ roomId: 'room-1', command: '检查房间环境' })

    expect(mdpEngine.render).toHaveBeenCalledWith('group/butler/persona')
    expect(mdpEngine.render).toHaveBeenCalledWith(
      'group/butler/narrate_and_maintain',
      expect.objectContaining({ persona: '管家提示词' }),
    )
  })

  it('LLM成功时应执行维护指令并把旁白写回群聊', async () => {
    const { service, strongholdService, groupChatService, mdpEngine, llmService } = createLlmDeps()
    mockLlmJson(llmService, {
      narrative: '管家轻轻把恒温器调到 26 度，客厅暖意渐浓。',
      maintenance_actions: [
        { action: 'update_room_env', params: { room_name: '客厅', key: '温度', value: 26 } },
      ],
    })

    const result = await service.execute({ roomId: 'room-1', command: '把客厅温度调到 26 度' })

    // 提示词通过 mdpEngine 渲染（复用主模型）
    expect(mdpEngine.render).toHaveBeenCalledWith(
      'group/butler/narrate_and_maintain',
      expect.objectContaining({ user_query: '把客厅温度调到 26 度' }),
    )
    expect(strongholdService.updateEnvironment).toHaveBeenCalledWith('room-1', '温度', 26)
    // 旁白 + 执行结果都在汇总消息里
    expect(result.message).toContain('管家轻轻把恒温器调到 26 度')
    expect(result.message).toContain('温度 修改为 26')
    // 请求 + 结果两条 system 消息
    expect(groupChatService.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('LLM未知身份动作应被白名单映射丢弃', async () => {
    const { service, strongholdService, llmService } = createLlmDeps()
    mockLlmJson(llmService, {
      narrative: '',
      maintenance_actions: [
        { action: 'create_agent', params: { agent_id: 'bot', persona: '高冷人设' } },
        { action: 'update_persona', params: { agent_id: 'Butler', persona: '猫娘' } },
      ],
    })

    const result = await service.execute({ roomId: 'room-1', command: '执行维护请求' })

    expect(result.message).toContain('没有需要执行的维护操作')
    expect(strongholdService.moveAgent).not.toHaveBeenCalled()
    expect(strongholdService.createRoom).not.toHaveBeenCalled()
  })

  it('LLM 返回无效 JSON 时应回退规则引擎', async () => {
    const { service, llmService } = createLlmDeps()
    llmService.chat.mockResolvedValue({ choices: [{ message: { content: '不是 JSON 内容' } }] })

    const result = await service.execute({ roomId: 'room-1', command: '查看当前据点状态' })

    expect(result.action).toBe('status')
    expect(result.message).toContain('据点状态')
  })

  it('未配置主模型时应回退规则引擎且不调用 LLM', async () => {
    const { service, getModelConfig, llmService } = createLlmDeps()
    getModelConfig.mockResolvedValueOnce(null)

    const result = await service.execute({ roomId: 'room-1', command: '查看当前据点状态' })

    expect(result.action).toBe('status')
    expect(llmService.chat).not.toHaveBeenCalled()
  })

  it('LLM 调用失败时应回退规则引擎', async () => {
    const { service, llmService } = createLlmDeps()
    llmService.chat.mockRejectedValue(new Error('模型超时'))

    const result = await service.execute({ roomId: 'room-1', command: '把所有成员叫到这里来' })

    expect(result.action).toBe('summon_all')
  })

  it('LLM 尝试删除「客厅」时应被安全拦截且不触发删除', async () => {
    const { service, strongholdService, llmService } = createLlmDeps()
    mockLlmJson(llmService, {
      narrative: '',
      maintenance_actions: [{ action: 'delete_room', params: { room_name: '客厅' } }],
    })

    const result = await service.execute({ roomId: 'room-1', command: '把客厅删了' })

    expect(strongholdService.deleteRoom).not.toHaveBeenCalled()
    expect(result.message).toContain('没有需要执行的维护操作')
  })

  it('LLM 返回未知动作时应忽略并安全收尾', async () => {
    const { service, llmService } = createLlmDeps()
    mockLlmJson(llmService, {
      narrative: '',
      maintenance_actions: [{ action: 'nuke_everything', params: {} }],
    })

    const result = await service.execute({ roomId: 'room-1', command: '随便搞一下' })

    expect(result.message).toContain('没有需要执行的维护操作')
  })
})
