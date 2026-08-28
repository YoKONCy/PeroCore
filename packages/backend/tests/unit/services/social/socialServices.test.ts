import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialSessionManager } from '@infos/social/runtime/socialSessionManager'
import type { InboundMessage } from '@infos/social/runtime/types'
import { StickerService } from '@infos/social/runtime/stickerService'
import { setSocialDiaryReaderProvider, socialReadDiaryTool } from '@infos/social/tools'

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

describe('社交日记读取工具', () => {
  afterEach(() => {
    setSocialDiaryReaderProvider(null)
  })

  it('应按当前角色列出日记，并限制数量上限', async () => {
    const list = vi.fn().mockResolvedValue([{ date: '2026-08-27', parts: 2 }])
    setSocialDiaryReaderProvider({ list, read: vi.fn() })

    const output = await socialReadDiaryTool.execute(
      { action: 'list', limit: 999 },
      {
        agentId: 'nana',
        sessionId: 'social-realm',
        source: 'application',
        threadId: 'social-realm',
        channel: 'application',
      },
    )

    expect(list).toHaveBeenCalledWith('nana', 60)
    expect(JSON.parse(String(output))).toEqual({
      success: true,
      entries: [{ date: '2026-08-27', parts: 2 }],
      total: 1,
    })
  })

  it('应读取指定日期并拒绝非法日期', async () => {
    const read = vi.fn().mockResolvedValue({
      date: '2026-08-27',
      parts: 2,
      content: '# 2026-08-27\n\n日记正文',
      truncated: false,
    })
    setSocialDiaryReaderProvider({ list: vi.fn(), read })
    const context = {
      agentId: 'pero',
      sessionId: 'social-realm',
      source: 'application',
      threadId: 'social-realm',
      channel: 'application',
    }

    const output = await socialReadDiaryTool.execute(
      { action: 'read', date: '2026-08-27' },
      context,
    )
    const invalid = await socialReadDiaryTool.execute(
      { action: 'read', date: '../secret' },
      context,
    )

    expect(read).toHaveBeenCalledWith('pero', '2026-08-27')
    expect(JSON.parse(String(output))).toMatchObject({ success: true, parts: 2 })
    expect(JSON.parse(String(invalid))).toEqual({ error: 'date 必须使用 YYYY-MM-DD 格式' })
  })
})

describe('SocialSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当创建会话并按最近消息时间排序返回活跃会话', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue({ type: 'pass' })
    const manager = new SocialSessionManager(callback)

    await manager.handleInbound(createMessage({ channelId: 'old' }))
    vi.advanceTimersByTime(10)
    await manager.handleInbound(createMessage({ channelId: 'new' }))

    const sessions = manager.getActiveSessions('group', 2)

    expect(sessions.map((session) => session.channelId)).toEqual(['new', 'old'])
    expect(manager.getOrCreate(createMessage({ channelId: 'new' }))).toBe(sessions[0])
  })

  it('群聊被提及时进入 listening/collecting，并在收集结束后处理批次', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue({ type: 'pass' })
    const manager = new SocialSessionManager(callback, { groupCollectTimeout: 2 })

    await manager.handleInbound(
      createMessage({ rawEvent: { _isMentioned: true }, content: '@pero 第一条' }),
    )
    await manager.handleInbound(createMessage({ content: '第二条' }))
    const session = manager.getActiveSessions('group')[0]!

    expect(session).toMatchObject({ participation: 'listening', phase: 'collecting' })
    expect(session.pendingMessages).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2000)

    expect(callback).toHaveBeenCalledWith(
      session,
      expect.arrayContaining([expect.objectContaining({ content: '@pero 第一条' })]),
      'direct_timeout',
    )
    expect(session.pendingMessages).toEqual([])
  })

  it('私聊始终直接触发，并使用私聊收集时长', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue({ type: 'pass' })
    const manager = new SocialSessionManager(callback, { privateCollectTimeout: 1 })

    await manager.handleInbound(createMessage({ channelType: 'private', channelId: 'dm-1' }))
    const session = manager.getActiveSessions('private')[0]!

    expect(session).toMatchObject({ participation: 'listening', phase: 'collecting' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledWith(session, expect.any(Array), 'direct_timeout')
  })

  it('普通群消息只进入观察窗口，不会按超时或消息数直接唤醒 Agent', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockResolvedValue({ type: 'pass' })
    const manager = new SocialSessionManager(callback, { bufferTimeout: 1, maxBufferSize: 2 })

    await manager.handleInbound(createMessage({ channelId: 'g1', content: '一' }))
    await manager.handleInbound(createMessage({ channelId: 'g1', content: '二' }))
    await manager.handleInbound(createMessage({ channelId: 'g1', content: '三' }))
    await vi.advanceTimersByTimeAsync(2000)

    const session = manager.getActiveSessions('group')[0]!
    expect(callback).not.toHaveBeenCalled()
    expect(session.phase).toBe('ready')
    expect(session.pendingMessages.map((item) => item.content)).toEqual(['二', '三'])
  })

  it('回复后进入 engaged/cooldown，并在过期后回到 idle/ready', () => {
    vi.useFakeTimers()
    const manager = new SocialSessionManager(vi.fn(), { engagedDuration: 1 })
    const session = manager.getOrCreate(createMessage())

    manager.markReplied(session)
    expect(session).toMatchObject({ participation: 'engaged', phase: 'cooldown' })
    vi.advanceTimersByTime(1001)
    manager.checkActiveExpiry(session)

    expect(session).toMatchObject({ participation: 'idle', phase: 'ready' })
  })

  it('flush 回调失败时保留批次并进入 retrying', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockRejectedValue(new Error('失败'))
    const manager = new SocialSessionManager(callback, { maxBufferSize: 1 })

    await manager.handleInbound(
      createMessage({ channelId: 'g3', rawEvent: { _isMentioned: true } }),
    )
    const session = manager.getActiveSessions('group')[0]!

    expect(callback).toHaveBeenCalled()
    expect(session.phase).toBe('retrying')
    expect(session.pendingMessages).toHaveLength(1)
  })
})

describe('StickerService', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `infos-stickers-${Date.now()}-${Math.random()}`)
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
