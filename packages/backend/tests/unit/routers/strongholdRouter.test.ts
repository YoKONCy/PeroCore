import { describe, expect, it, vi } from 'vitest'
import { createStrongholdRouter } from '@infos/backend/routers/stronghold.router'
import { StrongholdTurnService } from '@infos/backend/services/stronghold/strongholdTurnService'
import { StrongholdService } from '@infos/backend/services/stronghold/strongholdService'
import { GroupChatService } from '@infos/backend/services/stronghold/groupChatService'
import { createDrizzleConnection, closeDrizzleConnection } from '@infos/backend/database'
import { GroupChatDispatcher } from '@infos/backend/services/stronghold/groupChatDispatcher'
import { agentLocations, strongholdRooms, groupChatMembers } from '@infos/backend/database/schema'

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function createCtx() {
  const facility = { id: 1, name: '我的据点' }
  const room = { id: 'room-1', facilityId: 1, name: '客厅' }
  const message = { id: 1, roomId: 'room-1', senderId: 'user', content: '你好', role: 'user' }
  const ctx = {
    strongholdService: {
      getFacility: vi.fn(() => Promise.resolve(facility)),
      listFacilities: vi.fn(() => Promise.resolve([facility])),
      createFacility: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
      getRoom: vi.fn(() => Promise.resolve({ ...room, environmentJson: '{"温度":24}' })),
      listRooms: vi.fn(() => Promise.resolve([room])),
      getRoomAgents: vi.fn(() => Promise.resolve(['pero'])),
      createRoom: vi.fn((body: Record<string, unknown>) =>
        Promise.resolve({ id: 'room-2', ...body }),
      ),
      updateRoom: vi.fn((id: string, body: Record<string, unknown>) =>
        Promise.resolve({ id, ...body }),
      ),
      deleteRoom: vi.fn(() => Promise.resolve()),
      updateEnvironment: vi.fn(() => Promise.resolve()),
      moveAgent: vi.fn((agentId: string, roomId: string) => Promise.resolve({ agentId, roomId })),
      getAgentLocation: vi.fn(() => Promise.resolve(room)),
      getButlerConfig: vi.fn(() => Promise.resolve({ id: 1, name: 'Butler', enabled: true })),
      updateButlerEnabled: vi.fn(() => Promise.resolve()),
    },
    butlerService: {
      execute: vi.fn(() =>
        Promise.resolve({ action: 'inspect_environment', message: '当前房间环境：温度 24' }),
      ),
    },
    agentManager: {
      listAgents: vi.fn(() => [
        { id: 'pero', name: 'Pero', isEnabled: true },
        { id: 'nana', name: 'Nana', isEnabled: false },
      ]),
      getAgent: vi.fn((id: string) => {
        if (id === 'pero') {
          return {
            id: 'pero',
            name: 'Pero',
            description: '猫猫助手',
            publicProfile: {
              gender: '女',
              identity: '据点助手',
            },
          }
        }
        if (id === 'nana') {
          return {
            id: 'nana',
            name: 'Nana & <伙伴>',
            description: '傲娇伙伴',
            publicProfile: {
              appearance: '紫发 & 紫瞳',
              personality: '自信 <傲娇>',
            },
          }
        }
        return undefined
      }),
      enabledAgents: new Set(['pero']),
    },
    groupChatService: {
      getHistory: vi.fn(() => Promise.resolve([message])),
      getHistoryPairs: vi.fn(() => Promise.resolve([message])),
      getVisibleHistoryPairs: vi.fn(() => Promise.resolve([message])),
      recordPairVisibility: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
      deleteMessagePair: vi.fn(() =>
        Promise.resolve({ deletedCount: 2, deletedMessageIds: [1, 2] }),
      ),
      isPairActive: vi.fn(() => Promise.resolve(true)),
      getRoomMembers: vi.fn(() => Promise.resolve([{ agentId: 'pero', role: 'member' }])),
      addMember: vi.fn(() => Promise.resolve()),
      convertPerspective: vi.fn(() => [{ role: 'user', content: '历史' }]),
    },
    groupChatDispatcher: {
      decideNextTurn: vi.fn(() => Promise.resolve({ agentIds: [], reason: '无需接话' })),
    },
    agentService: {
      chatStreamWithCompiledMessages: vi.fn(async function* () {
        yield {
          event: 'narration_delta' as const,
          data: { blockId: 'reply', turn: 1, delta: '猫猫回复' },
        }
      }),
    },
    threadService: {
      getThread: vi.fn(() => Promise.resolve(null)),
      createThread: vi.fn((input: Record<string, unknown>) => Promise.resolve(input)),
      saveMessagePair: vi.fn(() => Promise.resolve({ userMessage: {}, assistantMessage: {} })),
    },
    memoryTaskRunner: {
      triggerScorer: vi.fn(() => Promise.resolve()),
    },
    contextCompiler: {
      compile: vi.fn(() => Promise.resolve({ messages: [{ role: 'system', content: '人设' }] })),
    },
    strongholdTurnService: undefined as unknown as StrongholdTurnService,
    gatewayHub: {
      broadcast: vi.fn(() => Promise.resolve()),
    },
  }
  ctx.strongholdTurnService = createTurnService(ctx)
  return ctx
}

function createTurnService(ctx: ReturnType<typeof createCtx>) {
  return new StrongholdTurnService(
    ctx.strongholdService as never,
    ctx.groupChatService as never,
    ctx.threadService as never,
    ctx.contextCompiler as never,
    ctx.agentService as never,
    ctx.memoryTaskRunner as never,
    undefined as never,
    ctx.gatewayHub as never,
    ctx.agentManager as never,
  )
}

describe('据点角色可见回合状态机', () => {
  it('应跨房间携带离场前历史，并隔离离场后的旧房间消息', async () => {
    const db = createDrizzleConnection(':memory:')
    const chat = new GroupChatService(db, () => true)
    try {
      const first = await chat.sendMessage({
        roomId: 'living',
        senderId: 'user',
        content: '客厅共同消息',
        role: 'user',
        pairId: 'pair-before-move',
      })
      await chat.recordPairVisibility('living', 'pair-before-move', ['pero', 'nana'])
      await chat.sendMessage({
        roomId: 'living',
        senderId: 'user',
        content: 'Pero离开后的客厅消息',
        role: 'user',
        pairId: 'pair-after-move',
      })
      await chat.recordPairVisibility('living', 'pair-after-move', ['nana'])
      await chat.sendMessage({
        roomId: 'bedroom',
        senderId: 'user',
        content: '卧室新消息',
        role: 'user',
        pairId: 'pair-bedroom',
      })
      await chat.recordPairVisibility('bedroom', 'pair-bedroom', ['pero'])

      const peroHistory = await chat.getVisibleHistoryPairs('pero', 20)
      const nanaHistory = await chat.getVisibleHistoryPairs('nana', 20)
      expect(first.id).toBeGreaterThan(0)
      expect(peroHistory.map((item) => item.content)).toEqual(['客厅共同消息', '卧室新消息'])
      expect(nanaHistory.map((item) => item.content)).toEqual([
        '客厅共同消息',
        'Pero离开后的客厅消息',
      ])
    } finally {
      closeDrizzleConnection(db)
    }
  })

  it('应在多角色连续回合中显式保留每条消息的真实发言者', async () => {
    const db = createDrizzleConnection(':memory:')
    const chat = new GroupChatService(db, () => true)
    try {
      const messages = [
        await chat.sendMessage({
          roomId: 'living',
          senderId: 'user',
          content: '@nana 你怎么看？',
          role: 'user',
          pairId: 'pair-1',
        }),
        await chat.sendMessage({
          roomId: 'living',
          senderId: 'nana',
          content: '我觉得很好。',
          role: 'assistant',
          pairId: 'pair-1',
        }),
        await chat.sendMessage({
          roomId: 'living',
          senderId: 'pero',
          content: '我也赞同。',
          role: 'assistant',
          pairId: 'pair-1',
        }),
        await chat.sendMessage({
          roomId: 'living',
          senderId: 'user',
          content: '@nana 再详细说说。',
          role: 'user',
          pairId: 'pair-2',
        }),
      ]

      expect(chat.convertPerspective(messages, 'nana', '秋月佑空')).toEqual([
        {
          role: 'user',
          content: '<秋月佑空>@nana 你怎么看？</秋月佑空>',
        },
        {
          role: 'assistant',
          content: expect.stringMatching(/^<nana, time=[^>]+>我觉得很好。<\/nana>$/),
        },
        {
          role: 'user',
          content: expect.stringMatching(/^<pero, time=[^>]+>我也赞同。<\/pero>$/),
        },
        {
          role: 'user',
          content: '<秋月佑空>@nana 再详细说说。</秋月佑空>',
        },
      ])
    } finally {
      closeDrizzleConnection(db)
    }
  })

  it('应按完整回合窗口截取角色最近亲历记录', async () => {
    const db = createDrizzleConnection(':memory:')
    const chat = new GroupChatService(db, () => true)
    try {
      for (const index of [1, 2, 3]) {
        const pairId = `pair-${index}`
        await chat.sendMessage({
          roomId: 'room',
          senderId: 'user',
          content: `问题${index}`,
          role: 'user',
          pairId,
        })
        await chat.sendMessage({
          roomId: 'room',
          senderId: 'pero',
          content: `回答${index}`,
          role: 'assistant',
          pairId,
        })
        await chat.recordPairVisibility('room', pairId, ['pero'])
      }

      expect((await chat.getVisibleHistoryPairs('pero', 2)).map((item) => item.content)).toEqual([
        '问题2',
        '回答2',
        '问题3',
        '回答3',
      ])
    } finally {
      closeDrizzleConnection(db)
    }
  })
})

describe('StrongholdService 默认出生', () => {
  function createService(existingLocation?: { agentId: string; roomId: string }) {
    const livingRoom = {
      id: 'living-room',
      facilityId: 1,
      name: '客厅',
      description: null,
      allowedAgentsJson: '[]',
      environmentJson: '{}',
    }
    const locations = new Map<string, { agentId: string; roomId: string }>()
    if (existingLocation) locations.set(existingLocation.agentId, existingLocation)
    const members: Array<{ roomId: string; agentId: string; role: string }> = []

    const db = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            get: vi.fn(() => {
              if (table === agentLocations) return locations.values().next().value
              if (table === strongholdRooms) return livingRoom
              return undefined
            }),
            all: vi.fn(() => Promise.resolve(table === groupChatMembers ? members : [])),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: { agentId: string; roomId: string; role?: string }) => {
          if (value.role) members.push({ ...value, role: value.role })
          else locations.set(value.agentId, { agentId: value.agentId, roomId: value.roomId })
          return Promise.resolve()
        }),
      })),
    }
    return {
      service: new StrongholdService(db as never, (agentId) => ['pero', 'nana'].includes(agentId)),
      locations,
      members,
    }
  }

  it('应将未定位 Agent 放入客厅并加入群聊成员', async () => {
    const { service, locations, members } = createService()

    await service.ensureAgentLocation('pero', 'living-room')

    expect(locations.get('pero')).toEqual({ agentId: 'pero', roomId: 'living-room' })
    expect(members).toContainEqual({ roomId: 'living-room', agentId: 'pero', role: 'member' })
  })

  it('应按房间白名单判断角色准入', () => {
    const { service } = createService()
    const publicRoom = {
      id: 'public',
      facilityId: 1,
      name: '公共房间',
      description: null,
      allowedAgentsJson: '[]',
      environmentJson: '{}',
      createdAt: null,
    }
    const privateRoom = { ...publicRoom, id: 'private', allowedAgentsJson: '["pero"]' }

    expect(service.canAgentEnterRoom(publicRoom as never, 'nana')).toBe(true)
    expect(service.canAgentEnterRoom(privateRoom as never, 'pero')).toBe(true)
    expect(service.canAgentEnterRoom(privateRoom as never, 'nana')).toBe(false)
    expect(
      service.canAgentEnterRoom({ ...privateRoom, allowedAgentsJson: 'invalid' } as never, 'pero'),
    ).toBe(false)
  })

  it('应拒绝为未注册ID创建据点位置', async () => {
    const { service, locations, members } = createService()

    await expect(service.ensureAgentLocation('bot', 'living-room')).rejects.toThrow(
      'Agent bot 不存在',
    )

    expect(locations.has('bot')).toBe(false)
    expect(members.some((member) => member.agentId === 'bot')).toBe(false)
  })

  it('不应覆盖已有明确位置', async () => {
    const { service, locations } = createService({ agentId: 'nana', roomId: 'studio' })

    await service.ensureAgentLocation('nana', 'living-room')

    expect(locations.get('nana')).toEqual({ agentId: 'nana', roomId: 'studio' })
  })
})

describe('GroupChatDispatcher 用户消息语义', () => {
  it('短用户消息也必须选择在场 Agent 回复', async () => {
    const chatService = {
      getCandidateAgents: vi.fn(() => Promise.resolve(['pero'])),
    }
    const dispatcher = new GroupChatDispatcher(chatService as never)

    const result = await dispatcher.decideNextTurn('living-room', [
      {
        senderId: 'user',
        content: '你好',
        role: 'user',
        mentionsJson: '[]',
      },
    ])

    expect(result).toEqual({ agentIds: ['pero'], reason: '用户发言，随机选择 Agent 回复' })
  })

  it('多个@mention应去重并严格保持出现顺序', async () => {
    const chatService = {
      getCandidateAgents: vi.fn(() => Promise.resolve(['pero', 'nana', 'mika'])),
    }
    const dispatcher = new GroupChatDispatcher(chatService as never)

    const result = await dispatcher.decideNextTurn('living-room', [
      {
        senderId: 'user',
        content: '@Nana @佩罗 请依次回答',
        role: 'user',
        mentionsJson: '["nana","pero","nana"]',
      },
    ])

    expect(result).toEqual({
      agentIds: ['nana', 'pero'],
      reason: '被 @mention: nana、pero',
    })
  })

  it('@全体成员 应返回哨兵 agentId=@all', async () => {
    const chatService = {
      getCandidateAgents: vi.fn(() => Promise.resolve(['pero', 'nana'])),
    }
    const dispatcher = new GroupChatDispatcher(chatService as never)

    const result = await dispatcher.decideNextTurn('living-room', [
      {
        senderId: 'user',
        content: '@全体成员 集合！',
        role: 'user',
        mentionsJson: '["@all"]',
      },
    ])

    expect(result).toEqual({ agentIds: ['@all'], reason: '被 @mention: 全体成员' })
  })
})

describe('StrongholdRouter', () => {
  it('应当管理设施、房间、环境和 Agent 位置', async () => {
    const ctx = createCtx()
    const router = createStrongholdRouter(ctx as never)

    const facilities = await router.request('http://test/facilities')
    const createdFacility = await router.request('http://test/facilities', {
      method: 'POST',
      body: JSON.stringify({ name: '新据点', description: '测试' }),
      headers: { 'content-type': 'application/json' },
    })
    const rooms = await router.request('http://test/rooms?facilityId=1')
    const createdRoom = await router.request('http://test/rooms', {
      method: 'POST',
      body: JSON.stringify({ facilityId: 1, name: '书房' }),
      headers: { 'content-type': 'application/json' },
    })
    const updatedRoom = await router.request('http://test/rooms/room-1', {
      method: 'PUT',
      body: JSON.stringify({ name: '新客厅' }),
      headers: { 'content-type': 'application/json' },
    })
    const env = await router.request('http://test/rooms/room-1/env', {
      method: 'PUT',
      body: JSON.stringify({ key: '温度', value: 24 }),
      headers: { 'content-type': 'application/json' },
    })
    const moved = await router.request('http://test/locations/move', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero', roomId: 'room-1' }),
      headers: { 'content-type': 'application/json' },
    })
    const location = await router.request('http://test/locations/pero')
    const deleted = await router.request('http://test/rooms/room-1', { method: 'DELETE' })

    expect(await readJson(facilities)).toMatchObject({ code: 'OK', data: [{ id: 1 }] })
    expect(createdFacility.status).toBe(201)
    expect(await readJson(createdFacility)).toMatchObject({
      code: 'CREATED',
      data: { id: 2, name: '新据点' },
    })
    expect(await readJson(rooms)).toMatchObject({
      code: 'OK',
      data: [{ id: 'room-1', agents: ['pero'] }],
    })
    expect(ctx.strongholdService.listRooms).toHaveBeenCalledWith(1)
    expect(createdRoom.status).toBe(201)
    expect(await readJson(createdRoom)).toMatchObject({
      code: 'CREATED',
      data: { id: 'room-2', name: '书房' },
    })
    expect(await readJson(updatedRoom)).toMatchObject({
      code: 'OK',
      data: { id: 'room-1', name: '新客厅' },
    })
    expect(await readJson(env)).toEqual({ code: 'OK', message: '环境变量已更新' })
    expect(ctx.strongholdService.updateEnvironment).toHaveBeenCalledWith('room-1', '温度', 24)
    expect(await readJson(moved)).toMatchObject({
      code: 'OK',
      data: { agentId: 'pero', roomId: 'room-1' },
    })
    expect(await readJson(location)).toMatchObject({ code: 'OK', data: { id: 'room-1' } })
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '房间已删除' })
  })

  it('成员接口应拒绝未知或未启用角色', async () => {
    const ctx = createCtx()
    const router = createStrongholdRouter(ctx as never)

    const unknown = await router.request('http://test/rooms/room-1/members', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'bot' }),
      headers: { 'content-type': 'application/json' },
    })
    const disabled = await router.request('http://test/rooms/room-1/members', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'nana' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(unknown.ok).toBe(false)
    expect(disabled.ok).toBe(false)
    expect(ctx.groupChatService.addMember).not.toHaveBeenCalled()
  })

  it('应当管理群聊消息、成员和管家配置', async () => {
    const ctx = createCtx()
    const router = createStrongholdRouter(ctx as never)

    const history = await router.request('http://test/rooms/room-1/messages?limit=5')
    const sent = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '你好', senderId: 'user', role: 'user', mentions: ['pero'] }),
      headers: { 'content-type': 'application/json' },
    })
    const systemSent = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '系统消息', role: 'system' }),
      headers: { 'content-type': 'application/json' },
    })
    const members = await router.request('http://test/rooms/room-1/members')
    const added = await router.request('http://test/rooms/room-1/members', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'pero', role: 'member' }),
      headers: { 'content-type': 'application/json' },
    })
    const command = await router.request('http://test/rooms/room-1/butler-command', {
      method: 'POST',
      body: JSON.stringify({ command: '扫描当前房间环境' }),
      headers: { 'content-type': 'application/json' },
    })
    const butler = await router.request('http://test/butler')
    const toggled = await router.request('http://test/butler/toggle', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(history)).toMatchObject({ code: 'OK', data: [{ content: '你好' }] })
    expect(ctx.groupChatService.getHistory).toHaveBeenCalledWith('room-1', 5)
    expect(sent.status).toBe(201)
    const sentData = await readJson(sent)
    expect(sentData).toMatchObject({
      code: 'CREATED',
      data: {
        message: { content: '你好', mentions: ['pero'] },
        replyQueued: true,
        agentIds: ['pero'],
      },
    })
    expect(ctx.groupChatService.recordPairVisibility).toHaveBeenCalledWith(
      'room-1',
      expect.any(String),
      ['pero'],
    )
    expect(systemSent.status).toBe(201)
    expect(await readJson(members)).toMatchObject({ code: 'OK', data: [{ agentId: 'pero' }] })
    expect(await readJson(added)).toEqual({ code: 'OK', message: '成员已添加' })
    expect(ctx.groupChatService.addMember).toHaveBeenCalledWith('room-1', 'pero', 'member')
    expect(await readJson(command)).toMatchObject({
      code: 'OK',
      data: { action: 'inspect_environment' },
    })
    expect(ctx.butlerService.execute).toHaveBeenCalledWith({
      roomId: 'room-1',
      command: '扫描当前房间环境',
      action: undefined,
      requesterId: 'user',
    })
    expect(await readJson(butler)).toMatchObject({
      code: 'OK',
      data: { name: 'Butler', enabled: true },
    })
    expect(await readJson(toggled)).toEqual({ code: 'OK', message: '管家状态已更新' })
    expect(ctx.strongholdService.updateButlerEnabled).toHaveBeenCalledWith(false)
  })

  it('空房间应在保存前拒绝用户消息', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoomAgents.mockResolvedValueOnce([])
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '有人吗', senderId: 'user', role: 'user' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.ok).toBe(false)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('Internal Server Error')
    expect(ctx.groupChatService.sendMessage).not.toHaveBeenCalled()
    expect(ctx.groupChatDispatcher.decideNextTurn).not.toHaveBeenCalled()
  })

  it('用户消息应返回明确的回复排队状态', async () => {
    const ctx = createCtx()
    ctx.groupChatDispatcher.decideNextTurn.mockResolvedValueOnce({
      agentIds: ['pero'],
      reason: '用户发言，选择在场角色回复',
    })
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '请回复我', senderId: 'user', role: 'user' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(201)
    expect(await readJson(response)).toMatchObject({
      code: 'CREATED',
      message: '消息已发送，角色正在回复',
      data: {
        message: { content: '请回复我' },
        replyQueued: true,
        agentId: 'pero',
      },
    })
  })

  it('多个@成员应按mention顺序串行发言', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoomAgents.mockResolvedValue(['nana', 'pero'])
    ctx.agentManager.listAgents.mockReturnValue([
      { id: 'pero', name: 'Pero', isEnabled: true },
      { id: 'nana', name: 'Nana', isEnabled: true },
    ])
    ctx.groupChatDispatcher.decideNextTurn.mockResolvedValueOnce({
      agentIds: ['nana', 'pero'],
      reason: '被 @mention: nana、pero',
    })
    const order: string[] = []
    ctx.agentService.chatStreamWithCompiledMessages.mockImplementation(async function* (input: {
      agentId: string
    }) {
      order.push(input.agentId)
      yield {
        event: 'narration_delta' as const,
        data: { blockId: 'reply', turn: 1, delta: `${input.agentId}回复` },
      }
    })
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: '@Nana @佩罗 请依次回答',
        senderId: 'user',
        role: 'user',
        mentions: ['nana', 'pero'],
      }),
      headers: { 'content-type': 'application/json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(response.status).toBe(201)
    expect(order).toEqual(['nana', 'pero'])
    expect((await readJson(response)).data).toMatchObject({
      agentId: 'nana',
      agentIds: ['nana', 'pero'],
    })
  })

  it('首位Agent传唤其他成员后应追加执行且禁止递归传唤', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoomAgents.mockResolvedValue(['pero', 'nana'])
    ctx.agentManager.listAgents.mockReturnValue([
      { id: 'pero', name: 'Pero', isEnabled: true },
      { id: 'nana', name: 'Nana', isEnabled: true },
    ])
    ctx.groupChatDispatcher.decideNextTurn
      .mockResolvedValueOnce({ agentIds: ['pero'], reason: '用户发言' })
      .mockResolvedValueOnce({ agentIds: [], reason: '无需自动接话' })
    const runs: Array<{ agentId: string; disabledTools?: string[] }> = []
    ctx.agentService.chatStreamWithCompiledMessages.mockImplementation(async function* (input: {
      agentId: string
      disabledTools?: string[]
      onToolCalls?: (calls: unknown[]) => void
    }) {
      runs.push({ agentId: input.agentId, disabledTools: input.disabledTools })
      if (input.agentId === 'pero') {
        input.onToolCalls?.([
          {
            name: 'stronghold_summon_agents',
            args: { agent_ids: ['nana'], reason: '请补充意见' },
            result: JSON.stringify({ success: true, queued_agent_ids: ['nana'] }),
            durationMs: 1,
            isError: false,
            callId: 'summon-1',
          },
        ])
      }
      yield {
        event: 'narration_delta' as const,
        data: { blockId: 'reply', turn: 1, delta: `${input.agentId}回复` },
      }
    })
    const router = createStrongholdRouter(ctx as never)

    await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '你们怎么看', senderId: 'user', role: 'user' }),
      headers: { 'content-type': 'application/json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(runs.map((run) => run.agentId)).toEqual(['pero', 'nana'])
    expect(runs[1]?.disabledTools).toContain('stronghold_summon_agents')
  })

  it('@全体成员 时应按随机顺序依次让所有在场成员回复', async () => {
    const ctx = createCtx()
    ctx.groupChatDispatcher.decideNextTurn.mockResolvedValueOnce({
      agentIds: ['@all'],
      reason: '被 @mention: 全体成员',
    })
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: '@全体成员 集合！',
        senderId: 'user',
        role: 'user',
        mentions: ['@all'],
      }),
      headers: { 'content-type': 'application/json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(response.status).toBe(201)
    const body = await readJson(response)
    const data = body.data as Record<string, unknown>
    expect(data.replyQueued).toBe(true)
    expect(data.agentId).toBe('pero')
    // 房间内启用的成员都会进入回复队列（随机顺序）
    expect(data.allAgentIds).toEqual(['pero'])
    expect(ctx.agentService.chatStreamWithCompiledMessages).toHaveBeenCalledTimes(1)
  })

  it('异步 Agent 回复失败时应写入用户可见的系统消息', async () => {
    const ctx = createCtx()
    ctx.groupChatDispatcher.decideNextTurn.mockResolvedValueOnce({
      agentIds: ['pero'],
      reason: '测试',
    })
    ctx.agentService.chatStreamWithCompiledMessages.mockImplementationOnce(async function* () {
      yield* [] as string[]
      throw new Error('模型暂不可用')
    })
    const router = createStrongholdRouter(ctx as never)

    await router.request('http://test/rooms/room-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: '请回复我', senderId: 'user', role: 'user' }),
      headers: { 'content-type': 'application/json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(ctx.groupChatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        senderId: 'system',
        role: 'system',
        content: expect.stringContaining('模型暂不可用'),
      }),
    )
  })

  it('应级联删除同一据点对话轮次的全部消息', async () => {
    const ctx = createCtx()
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/room-1/messages/1', {
      method: 'DELETE',
    })

    expect(await readJson(response)).toEqual({
      code: 'OK',
      message: '已删除 2 条关联消息',
      data: { deletedCount: 2, deletedMessageIds: [1, 2] },
    })
    expect(ctx.groupChatService.deleteMessagePair).toHaveBeenCalledWith('room-1', 1)
  })

  it('删除不存在或非法 ID 的消息应返回错误', async () => {
    const ctx = createCtx()
    ctx.groupChatService.deleteMessagePair.mockRejectedValueOnce(
      new Error('消息 999 不存在或不属于房间 room-1'),
    )
    const router = createStrongholdRouter(ctx as never)

    const missing = await router.request('http://test/rooms/room-1/messages/999', {
      method: 'DELETE',
    })
    const invalid = await router.request('http://test/rooms/room-1/messages/abc', {
      method: 'DELETE',
    })

    expect(missing.status).toBe(500)
    expect(ctx.groupChatService.deleteMessagePair).toHaveBeenCalledWith('room-1', 999)
    expect(invalid.status).toBe(500)
    // 非法 ID 不会触碰服务层
    expect(ctx.groupChatService.deleteMessagePair).toHaveBeenCalledTimes(1)
  })

  it('据点回合应使用隔离的 group Thread，并将视角问答写入 Thread 供记忆提炼', async () => {
    const ctx = createCtx()

    await createTurnService(ctx).execute('room-1', 'pero')

    expect(ctx.groupChatService.getVisibleHistoryPairs).toHaveBeenCalledWith('pero', 20)

    expect(ctx.threadService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stronghold_room-1_pero',
        channel: 'group',
        platformIdentifier: 'room-1:pero',
      }),
    )
    expect(ctx.contextCompiler.compile).toHaveBeenCalledWith('stronghold_room-1_pero', 'pero', {
      retrievalQuery: '历史',
      appendThreadMessages: false,
    })
    expect(ctx.threadService.saveMessagePair).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'stronghold_room-1_pero',
        agentId: 'pero',
        userContent: '历史',
        assistantContent: '猫猫回复',
      }),
    )
    expect(ctx.memoryTaskRunner.triggerScorer).toHaveBeenCalledWith(
      'stronghold_room-1_pero',
      'pero',
      'group',
    )
    expect(ctx.agentService.chatStreamWithCompiledMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'pero',
        channel: 'group',
        threadId: 'stronghold_room-1_pero',
      }),
    )
    const runArgs = ctx.agentService.chatStreamWithCompiledMessages.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    expect(runArgs.messages.some((item) => item.content.includes('当前在场角色ID列表：pero'))).toBe(
      true,
    )
    expect(
      runArgs.messages.some((item) => item.content.includes('新房间上下文从下一回合开始生效')),
    ).toBe(true)
    expect(ctx.groupChatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-1', senderId: 'pero', role: 'assistant' }),
    )
  })

  it('据点回合应只注入其他在场角色的公开档案并转义 XML', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoomAgents.mockResolvedValue(['pero', 'nana'])

    await createTurnService(ctx).execute('room-1', 'pero')

    const runArgs = ctx.agentService.chatStreamWithCompiledMessages.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const profileMessage = runArgs.messages.find((item) =>
      item.content.includes('<room_member_profiles observer="pero">'),
    )?.content

    expect(profileMessage).toContain(
      '<member id="nana" name="Nana &amp; &lt;伙伴&gt;"><appearance>紫发 &amp; 紫瞳</appearance><personality>自信 &lt;傲娇&gt;</personality></member>',
    )
    expect(profileMessage).not.toContain('<member id="pero"')
    expect(profileMessage).not.toContain('猫猫助手')
  })

  it('据点回合应在公开档案为空时回退到角色简介', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoomAgents.mockResolvedValue(['pero', 'nana'])
    ctx.agentManager.getAgent.mockImplementation((id: string) =>
      id === 'nana'
        ? {
            id: 'nana',
            name: 'Nana',
            description: '公开简介',
            publicProfile: {},
          }
        : undefined,
    )

    await createTurnService(ctx).execute('room-1', 'pero')

    const runArgs = ctx.agentService.chatStreamWithCompiledMessages.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    expect(
      runArgs.messages.some((item) =>
        item.content.includes(
          '<member id="nana" name="Nana"><description>公开简介</description></member>',
        ),
      ),
    ).toBe(true)
  })

  it('已删除的据点对话不应被迟到的 Agent 回复重新写回', async () => {
    const ctx = createCtx()
    ctx.groupChatService.isPairActive.mockResolvedValueOnce(false)

    await createTurnService(ctx).execute('room-1', 'pero', 'deleted-pair')

    expect(ctx.groupChatService.isPairActive).toHaveBeenCalledWith('room-1', 'deleted-pair')
    expect(ctx.groupChatService.sendMessage).not.toHaveBeenCalled()
  })

  it('不同房间和 Agent 的群聊回合应使用不同 Thread', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getRoom.mockImplementation((roomId: string) =>
      Promise.resolve({ id: roomId, name: roomId, environmentJson: '{}' }),
    )

    const service = createTurnService(ctx)
    await service.execute('room-a', 'pero')
    await service.execute('room-b', 'nana')

    expect(ctx.threadService.createThread).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'stronghold_room-a_pero' }),
    )
    expect(ctx.threadService.createThread).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'stronghold_room-b_nana' }),
    )
    expect(ctx.groupChatService.getVisibleHistoryPairs).toHaveBeenCalledWith('pero', 20)
    expect(ctx.groupChatService.getVisibleHistoryPairs).toHaveBeenCalledWith('nana', 20)
  })

  it('应当处理空位置和房间未找到分支', async () => {
    const ctx = createCtx()
    ctx.strongholdService.getAgentLocation.mockResolvedValueOnce(undefined as never)
    ctx.strongholdService.updateRoom.mockResolvedValueOnce(undefined as never)
    const router = createStrongholdRouter(ctx as never)

    const location = await router.request('http://test/locations/missing')
    const missingRoom = await router.request('http://test/rooms/missing', {
      method: 'PUT',
      body: JSON.stringify({ name: '不存在' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(location)).toEqual({ code: 'OK', message: '获取成功', data: null })
    expect(missingRoom.status).toBe(500)
  })

  it('应当在删除房间失败时转换为错误响应', async () => {
    const ctx = createCtx()
    ctx.strongholdService.deleteRoom.mockRejectedValueOnce(new Error('客厅不能被删除'))
    const router = createStrongholdRouter(ctx as never)

    const response = await router.request('http://test/rooms/living', { method: 'DELETE' })

    expect(response.status).toBe(500)
  })
})
