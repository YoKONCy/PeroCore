import { describe, expect, it, vi } from 'vitest'
import { createStrongholdRouter } from '@perocore/backend/routers/stronghold.router'

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function createCtx() {
  const facility = { id: 1, name: '我的据点' }
  const room = { id: 'room-1', facilityId: 1, name: '客厅' }
  const message = { id: 1, roomId: 'room-1', senderId: 'user', content: '你好', role: 'user' }
  return {
    strongholdService: {
      listFacilities: vi.fn(() => Promise.resolve([facility])),
      createFacility: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
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
    groupChatService: {
      getHistory: vi.fn(() => Promise.resolve([message])),
      sendMessage: vi.fn((body: Record<string, unknown>) => Promise.resolve({ id: 2, ...body })),
      getRoomMembers: vi.fn(() => Promise.resolve([{ agentId: 'pero', role: 'member' }])),
      addMember: vi.fn(() => Promise.resolve()),
      convertPerspective: vi.fn(() => [{ role: 'user', content: '历史' }]),
    },
    groupChatDispatcher: {
      decideNextTurn: vi.fn(() => Promise.resolve({ agentId: null, reason: '无需接话' })),
    },
    agentService: {
      chat: vi.fn(() => Promise.resolve('猫猫回复')),
    },
    gatewayHub: {
      broadcast: vi.fn(() => Promise.resolve()),
    },
  }
}

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
    const butler = await router.request('http://test/butler')
    const toggled = await router.request('http://test/butler/toggle', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
      headers: { 'content-type': 'application/json' },
    })

    expect(await readJson(history)).toMatchObject({ code: 'OK', data: [{ content: '你好' }] })
    expect(ctx.groupChatService.getHistory).toHaveBeenCalledWith('room-1', 5)
    expect(sent.status).toBe(201)
    expect(await readJson(sent)).toMatchObject({
      code: 'CREATED',
      data: { content: '你好', mentions: ['pero'] },
    })
    expect(systemSent.status).toBe(201)
    expect(await readJson(members)).toMatchObject({ code: 'OK', data: [{ agentId: 'pero' }] })
    expect(await readJson(added)).toEqual({ code: 'OK', message: '成员已添加' })
    expect(ctx.groupChatService.addMember).toHaveBeenCalledWith('room-1', 'pero', 'member')
    expect(await readJson(butler)).toMatchObject({
      code: 'OK',
      data: { name: 'Butler', enabled: true },
    })
    expect(await readJson(toggled)).toEqual({ code: 'OK', message: '管家状态已更新' })
    expect(ctx.strongholdService.updateButlerEnabled).toHaveBeenCalledWith(false)
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
