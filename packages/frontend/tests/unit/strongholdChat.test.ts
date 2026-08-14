/* @vitest-environment happy-dom */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupMessage, Room } from '@infos/frontend/api/modules/strongholdApi'

const apiMocks = vi.hoisted(() => ({
  listFacilities: vi.fn(),
  listRooms: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
  callButler: vi.fn(),
  getButlerConfig: vi.fn(),
}))

vi.mock('@infos/frontend/api/modules/strongholdApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@infos/frontend/api/modules/strongholdApi')>()
  return {
    ...original,
    strongholdApi: apiMocks,
  }
})

const agentApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@infos/frontend/api/modules/agentApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@infos/frontend/api/modules/agentApi')>()
  return {
    ...original,
    agentApi: agentApiMocks,
  }
})

vi.mock('@infos/frontend/stores/useNotificationStore', () => ({
  useNotificationStore: () => ({ toast: vi.fn() }),
}))

vi.mock('@infos/frontend/lib/logger', () => ({
  logger: { error: vi.fn() },
}))

import { useStronghold } from '@infos/frontend/composables/useStronghold'

function room(id: string, name: string): Room {
  return { id, facilityId: 1, name, environmentJson: '{}', agents: ['pero'] }
}

function message(id: number, roomId: string, content: string): GroupMessage {
  return { id, roomId, senderId: 'pero', role: 'assistant', content }
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('据点聊天数据链路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.sendMessage.mockResolvedValue({
      data: {
        message: {
          id: 10,
          roomId: '33333333-3333-4333-8333-333333333333',
          senderId: 'user',
          role: 'user',
          content: '你好',
        },
        replyQueued: false,
        reason: '当前没有角色接话',
      },
    })
    apiMocks.callButler.mockResolvedValue({ data: undefined })
    apiMocks.listRooms.mockResolvedValue({ data: [] })
    agentApiMocks.list.mockResolvedValue({ data: [] })
  })

  it('切换房间时应隔离消息，并阻止旧请求覆盖新房间', async () => {
    const first = deferred<{ data: GroupMessage[] }>()
    const second = deferred<{ data: GroupMessage[] }>()
    apiMocks.getMessages.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const stronghold = useStronghold()
    const roomA = room('11111111-1111-4111-8111-111111111111', '客厅')
    const roomB = room('22222222-2222-4222-8222-222222222222', '书房')

    const selectingA = stronghold.selectRoom(roomA)
    expect(stronghold.messages.value).toEqual([])
    const selectingB = stronghold.selectRoom(roomB)
    expect(stronghold.messages.value).toEqual([])

    second.resolve({ data: [message(2, roomB.id, '书房消息')] })
    await selectingB
    first.resolve({ data: [message(1, roomA.id, '客厅旧消息')] })
    await selectingA

    expect(stronghold.currentRoom.value?.id).toBe(roomB.id)
    expect(stronghold.messages.value.map((item) => item.content)).toEqual(['书房消息'])
    expect(apiMocks.getMessages).toHaveBeenCalledTimes(2)
  })

  it('用户消息应走群聊消息 API，管家指令应走专用执行入口', async () => {
    apiMocks.getMessages.mockResolvedValue({ data: [] })
    const stronghold = useStronghold()
    const target = room('33333333-3333-4333-8333-333333333333', '工作室')
    await stronghold.selectRoom(target)

    await stronghold.sendMessage(' 你好 ')
    await stronghold.callButler('检查环境')

    expect(apiMocks.sendMessage).toHaveBeenCalledOnce()
    expect(apiMocks.sendMessage).toHaveBeenCalledWith(target.id, '你好', {
      senderId: 'user',
      role: 'user',
      mentions: [],
    })
    expect(apiMocks.callButler).toHaveBeenCalledWith(target.id, '检查环境')
  })

  it('发送消息时应把 @ 提及透传给后端', async () => {
    apiMocks.getMessages.mockResolvedValue({ data: [] })
    const stronghold = useStronghold()
    const target = room('33333333-3333-4333-8333-333333333333', '客厅')
    await stronghold.selectRoom(target)

    await stronghold.sendMessage('@佩罗 过来一下', ['pero'])

    expect(apiMocks.sendMessage).toHaveBeenCalledWith(target.id, '@佩罗 过来一下', {
      senderId: 'user',
      role: 'user',
      mentions: ['pero'],
    })
  })

  it('@全体成员 时应等待与成员数一致的回复落库', async () => {
    apiMocks.getMessages.mockResolvedValue({ data: [] })
    apiMocks.sendMessage.mockResolvedValueOnce({
      data: {
        message: {
          id: 20,
          roomId: '33333333-3333-4333-8333-333333333333',
          senderId: 'user',
          role: 'user',
          content: '@全体成员 集合！',
        },
        replyQueued: true,
        agentId: '@all',
        allAgentIds: ['pero', 'nana'],
        reason: '全体成员已召唤，随机顺序依次回复',
      },
    })
    const stronghold = useStronghold()
    const target = room('33333333-3333-4333-8333-333333333333', '客厅')
    await stronghold.selectRoom(target)

    await stronghold.sendMessage('@全体成员 集合！', ['@all'])

    expect(apiMocks.sendMessage).toHaveBeenCalledWith(target.id, '@全体成员 集合！', {
      senderId: 'user',
      role: 'user',
      mentions: ['@all'],
    })
    // 进入等待态（等待 2 位成员回复），并显示全体成员的等待文案
    expect(stronghold.isAwaitingReply.value).toBe(true)
    expect(stronghold.replyStatus.value).toContain('所有成员')

    // 切换房间会取消等待轮询，避免 1 秒拉取循环跨测试残留
    await stronghold.selectRoom(room('55555555-5555-4555-8555-555555555555', '撤离'))
    expect(stronghold.isAwaitingReply.value).toBe(false)
  })

  it('据点聊天应复用普通对话的气泡与 CHAR OPS，且不依赖 desktop 数据状态', async () => {
    const root = resolve(process.cwd(), 'packages/frontend/src')
    const files = await Promise.all([
      readFile(resolve(root, 'components/main/tabs/StrongholdTab.vue'), 'utf8'),
      readFile(resolve(root, 'components/stronghold/StrongholdChat.vue'), 'utf8'),
      readFile(resolve(root, 'composables/useStronghold.ts'), 'utf8'),
    ])
    const source = files.join('\n')
    const adapter = files[1]!

    expect(source).not.toContain('ChatContainer')
    expect(source).not.toContain('useChat')
    expect(source).not.toContain('useThreadStore')
    expect(adapter).toContain("import MessageBubble from '../chat/MessageBubble.vue'")
    expect(adapter).toContain(
      "import InputBar, { type MentionCandidate } from '../chat/InputBar.vue'",
    )
    expect(adapter).toContain('channel="group"')
  })

  it('删除消息成功后应从本地列表移除整个级联对话', async () => {
    apiMocks.getMessages.mockResolvedValue({
      data: [
        { ...message(5, '33333333-3333-4333-8333-333333333333', '用户提问'), role: 'user' },
        message(6, '33333333-3333-4333-8333-333333333333', '角色回复'),
        message(7, '33333333-3333-4333-8333-333333333333', '其他轮次'),
      ],
    })
    apiMocks.deleteMessage.mockResolvedValue({
      data: { deletedCount: 2, deletedMessageIds: [5, 6] },
    })
    const stronghold = useStronghold()
    const target = room('33333333-3333-4333-8333-333333333333', '客厅')
    await stronghold.selectRoom(target)

    expect(stronghold.messages.value).toHaveLength(3)
    const ok = await stronghold.deleteMessage(5)

    expect(ok).toBe(true)
    expect(apiMocks.deleteMessage).toHaveBeenCalledWith(target.id, 5)
    expect(stronghold.messages.value.map((item) => item.id)).toEqual([7])
  })

  it('删除消息失败时应保留本地列表并提示', async () => {
    apiMocks.getMessages.mockResolvedValue({
      data: [message(5, '33333333-3333-4333-8333-333333333333', '旧消息')],
    })
    apiMocks.deleteMessage.mockRejectedValue(new Error('网络错误'))
    const stronghold = useStronghold()
    const target = room('33333333-3333-4333-8333-333333333333', '客厅')
    await stronghold.selectRoom(target)

    const ok = await stronghold.deleteMessage(5)

    expect(ok).toBe(false)
    expect(stronghold.messages.value).toHaveLength(1)
  })

  it('角色档案加载后，成员展示应使用真实名字与头像', async () => {
    agentApiMocks.list.mockResolvedValue({
      data: [
        {
          id: 'pero',
          name: '佩罗',
          ownerAppellation: '主人',
          isActive: true,
          isEnabled: true,
          isUser: false,
          avatarUrl: '/api/agents/pero/avatar',
        },
      ],
    })
    apiMocks.listRooms.mockResolvedValue({
      data: [{ ...room('44444444-4444-4444-8444-444444444444', '客厅'), agents: ['pero'] }],
    })

    const stronghold = useStronghold()
    await stronghold.fetchAgentProfiles()
    await stronghold.fetchRooms(1)

    expect(agentApiMocks.list).toHaveBeenCalledOnce()
    expect(stronghold.agentProfiles.value.get('pero')?.name).toBe('佩罗')
    expect(stronghold.agentProfiles.value.get('pero')?.avatarUrl).toContain(
      '/api/agents/pero/avatar',
    )
    const member = stronghold.agentsStatus.value.find((agent) => agent.agentId === 'pero')
    expect(member?.name).toBe('佩罗')
    expect(member?.avatarUrl).toContain('/api/agents/pero/avatar')
  })
})
