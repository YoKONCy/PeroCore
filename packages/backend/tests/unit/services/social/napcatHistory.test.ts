import { describe, expect, it, vi } from 'vitest'
import { NapcatAdapter } from '@infos/social/adapters/napcat'
import type { OneBotMessageEvent } from '@infos/social/adapters/napcat/napcatParser'

describe('NapCat 历史消息补拉', () => {
  it('实时图片加提及会发布规范化字段，并保留引用消息 ID', async () => {
    const adapter = new NapcatAdapter({ defaultAgentId: 'pero', ownerQq: '654321' })
    const receive = vi.fn()
    adapter.on('message', receive)
    await (
      adapter as unknown as {
        handleMessageEvent(event: OneBotMessageEvent): Promise<void>
      }
    ).handleMessageEvent({
      post_type: 'message',
      message_type: 'group',
      self_id: 111111,
      user_id: 123456,
      group_id: 222222,
      message_id: 30,
      sender: { nickname: '主人' },
      message: [
        { type: 'reply', data: { id: 29 } },
        { type: 'image', data: { url: 'https://example.test/image' } },
        { type: 'at', data: { qq: '111111' } },
      ],
    })
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        isMentioned: true,
        isOwner: false,
        replyTo: '29',
        content: expect.stringContaining('[图片]'),
        attachments: [
          expect.objectContaining({ type: 'image', url: 'https://example.test/image' }),
        ],
      }),
    )
  })

  it('引用查询拒绝无效 ID、其他账号和其他会话的消息', async () => {
    const adapter = new NapcatAdapter({ defaultAgentId: 'pero' })
    vi.spyOn(adapter, 'getConnectedAccountIds').mockReturnValue(['111111'])
    const call = vi.spyOn(adapter, 'callApi').mockResolvedValue({
      status: 'ok',
      data: { message_id: 29, message_type: 'group', group_id: 999999, user_id: 123456 },
    })
    await expect(adapter.getMessage('undefined', '222222', 'group', '111111')).resolves.toBeNull()
    await expect(adapter.getMessage('29', '222222', 'group', '999999')).resolves.toBeNull()
    expect(call).not.toHaveBeenCalled()
    await expect(adapter.getMessage('29', '222222', 'group', '111111')).resolves.toBeNull()
    expect(call).toHaveBeenCalledWith('get_msg', { message_id: '29' }, 5000, '111111', undefined)
  })

  it.each(['private', 'group'] as const)('%s 空历史成功结束，不伪造分页游标', async (type) => {
    const adapter = new NapcatAdapter({ defaultAgentId: 'pero' })
    const call = vi.spyOn(adapter, 'callApi').mockResolvedValue({
      status: 'ok',
      retcode: 0,
      data: { messages: [] },
    })
    await expect(
      adapter.getMessageHistory('10000001', type, 100, undefined, '10000002'),
    ).resolves.toEqual([])
    expect(call).toHaveBeenCalledWith(
      type === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history',
      { [type === 'group' ? 'group_id' : 'user_id']: 10000001, count: 100, reverse_order: false },
      15000,
      '10000002',
    )
    await adapter.getMessageHistory('10000001', type, 100, 123, '10000002')
    expect(call.mock.lastCall?.[1].message_seq).toBe(123)
  })

  it.each([
    null,
    { status: 'failed', retcode: 1200, message: '消息123不存在' },
    { status: 'failed', retcode: 1200, wording: '历史不可访问' },
  ])('API 失败上抛，避免同步流程把失败当成空历史推进游标：%j', async (response) => {
    const adapter = new NapcatAdapter({ defaultAgentId: 'pero' })
    vi.spyOn(adapter, 'callApi').mockResolvedValue(response)
    await expect(adapter.getMessageHistory('10000001', 'private', 100)).rejects.toThrow(
      `历史消息查询失败（get_friend_msg_history）：${response?.message || response?.wording || 'NapCat 未返回成功响应'}`,
    )
  })
})
