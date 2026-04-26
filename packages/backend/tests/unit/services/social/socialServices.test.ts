import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialSessionManager } from '@perocore/backend/services/social/socialSessionManager'
import type { InboundMessage } from '@perocore/backend/services/social/types'
import { StickerService } from '@perocore/backend/services/social/stickerService'

function createMessage(partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'napcat',
    channelId: partial.channelId ?? 'group-1',
    channelType: partial.channelType ?? 'group',
    senderId: partial.senderId ?? 'u1',
    senderName: partial.senderName ?? '主人',
    content: partial.content ?? '你好',
    agentId: partial.agentId ?? 'pero',
    rawEvent: partial.rawEvent ?? {},
    attachments: partial.attachments,
  }
}

describe('SocialSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当创建会话并按最近消息时间排序返回活跃会话', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue(undefined)
    const manager = new SocialSessionManager(callback)

    await manager.handleInbound(createMessage({ channelId: 'old' }))
    vi.advanceTimersByTime(10)
    await manager.handleInbound(createMessage({ channelId: 'new' }))

    const sessions = manager.getActiveSessions('group', 2)

    expect(sessions.map((session) => session.channelId)).toEqual(['new', 'old'])
    expect(manager.getOrCreate(createMessage({ channelId: 'new' }))).toBe(sessions[0])
  })

  it('应当在群聊被提及时进入 summoned 并在固定超时后 flush', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue(undefined)
    const manager = new SocialSessionManager(callback, { groupSummonTimeout: 2 })

    await manager.handleInbound(
      createMessage({ rawEvent: { _isMentioned: true }, content: '@pero 第一条' }),
    )
    await manager.handleInbound(createMessage({ content: '第二条' }))
    const session = manager.getActiveSessions('group')[0]!

    expect(session.state).toBe('summoned')
    expect(session.buffer).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2000)

    expect(callback).toHaveBeenCalledWith(
      session,
      expect.arrayContaining([expect.objectContaining({ content: '@pero 第一条' })]),
      'summon_timeout',
    )
    expect(session.buffer).toEqual([])
  })

  it('应当把私聊始终视为被提及并使用私聊超时', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue(undefined)
    const manager = new SocialSessionManager(callback, { privateSummonTimeout: 1 })

    await manager.handleInbound(createMessage({ channelType: 'private', channelId: 'dm-1' }))
    const session = manager.getActiveSessions('private')[0]!

    expect(session.state).toBe('summoned')
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledWith(session, expect.any(Array), 'summon_timeout')
  })

  it('应当在 observing 缓冲超时或缓冲区满时 flush', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue(undefined)
    const timeoutManager = new SocialSessionManager(callback, { bufferTimeout: 1 })

    await timeoutManager.handleInbound(createMessage({ channelId: 'g1' }))
    const timeoutSession = timeoutManager.getActiveSessions('group')[0]!
    await vi.advanceTimersByTimeAsync(1000)

    expect(callback).toHaveBeenCalledWith(timeoutSession, expect.any(Array), 'buffer_timeout')

    const fullCallback = vi.fn().mockResolvedValue(undefined)
    const fullManager = new SocialSessionManager(fullCallback, { maxBufferSize: 2 })
    await fullManager.handleInbound(createMessage({ channelId: 'g2', content: '一' }))
    await fullManager.handleInbound(createMessage({ channelId: 'g2', content: '二' }))

    expect(fullCallback).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'g2' }),
      expect.any(Array),
      'buffer_full',
    )
  })

  it('应当标记回复进入 active，并在过期后回到 observing', () => {
    vi.useFakeTimers()
    const manager = new SocialSessionManager(vi.fn(), { activeDuration: 1 })
    const session = manager.getOrCreate(createMessage())

    manager.markReplied(session)
    expect(session.state).toBe('active')
    vi.advanceTimersByTime(1001)
    manager.checkActiveExpiry(session)

    expect(session.state).toBe('observing')
  })

  it('应当吞掉 flush 回调失败并清空缓冲', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockRejectedValue(new Error('失败'))
    const manager = new SocialSessionManager(callback, { maxBufferSize: 1 })

    await manager.handleInbound(createMessage({ channelId: 'g3' }))
    const session = manager.getActiveSessions('group')[0]!

    expect(callback).toHaveBeenCalled()
    expect(session.buffer).toEqual([])
  })
})

describe('StickerService', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-stickers-${Date.now()}-${Math.random()}`)
    mkdirSync(join(root, 'pero', 'stickers'), { recursive: true })
    writeFileSync(join(root, 'pero', 'stickers', '开心.jpg'), 'jpg')
    writeFileSync(join(root, 'pero', 'stickers', 'Wave.PNG'), 'png')
    writeFileSync(join(root, 'pero', 'stickers', '说明.txt'), 'txt')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当加载支持格式的表情包并缓存结果', () => {
    const service = new StickerService(root)

    const names = service.loadAgentStickers('pero')
    const cached = service.loadAgentStickers('pero')

    expect(names.split(', ').sort()).toEqual(['Wave', '开心'])
    expect(cached.split(', ').sort()).toEqual(['Wave', '开心'])
    expect(service.hasStickers('pero')).toBe(true)
  })

  it('应当把回复拆分为文字和表情段并支持大小写匹配', () => {
    const service = new StickerService(root)

    const segments = service.splitIntoSegments(
      '好的 [sticker:开心] 再见 [sticker:wave] [sticker:不存在]',
      'pero',
    )

    expect(segments).toEqual([
      { type: 'text', content: '好的' },
      { type: 'sticker', name: '开心', filePath: join(root, 'pero', 'stickers', '开心.jpg') },
      { type: 'text', content: '再见' },
      { type: 'sticker', name: 'wave', filePath: join(root, 'pero', 'stickers', 'Wave.PNG') },
    ])
  })

  it('应当在没有表情包时返回整段文字或空数组', () => {
    const service = new StickerService(root)

    expect(service.loadAgentStickers('missing')).toBe('')
    expect(service.hasStickers('missing')).toBe(false)
    expect(service.splitIntoSegments('纯文字', 'missing')).toEqual([
      { type: 'text', content: '纯文字' },
    ])
    expect(service.splitIntoSegments('   ', 'missing')).toEqual([])
  })

  it('应当支持清理单个或全部缓存', () => {
    const service = new StickerService(root)
    service.loadAgentStickers('pero')

    service.clearCache('pero')
    expect(service.hasStickers('pero')).toBe(true)
    service.clearCache()
    expect(service.hasStickers('pero')).toBe(true)
  })
})
