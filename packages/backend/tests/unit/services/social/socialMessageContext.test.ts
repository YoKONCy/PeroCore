import { fileURLToPath } from 'node:url'
import { MdpEngine } from '@infos/backend/services/prompt/mdpEngine'
import { describe, expect, it, vi } from 'vitest'
import type { SocialMessageRecord } from '@infos/shared'
import { SocialAppCompiler } from '@infos/social/runtime/compiler'
import {
  formatSocialMessage,
  isSocialMention,
  restoreSocialMessage,
  socialOwnerId,
  socialTriggerMessage,
} from '@infos/social/runtime/socialMessageContext'
import type { InboundMessage } from '@infos/social/runtime/types'
import { splitStickerSegments } from '@infos/social/runtime/stickerService'

function message(patch: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'qq',
    agentId: 'pero',
    channelId: 'group',
    channelType: 'group',
    senderId: '123456',
    senderName: '群友',
    content: '你好',
    rawEvent: { message_id: 1 },
    ...patch,
  }
}

describe('社交消息身份与附件上下文', () => {
  it('主要对话对象取最后一个实际提及者，不继承同批主人的身份或冒充主人的昵称', () => {
    const owner = message({ senderId: '654321', isOwner: true, isMentioned: true })
    const visitor = message({
      senderId: '123456',
      senderName: '主人',
      rawEvent: { _isMentioned: true },
    })
    expect(socialTriggerMessage([owner, visitor])).toBe(visitor)
    expect(isSocialMention(visitor)).toBe(true)
    expect(formatSocialMessage(visitor, '654321')).toContain('QQ:123456 身份:普通联系人')
    expect(formatSocialMessage(owner, '654321')).toContain('身份:主人')
  })

  it('恢复队列保留引用、图片和提及，待处理标记不冒充真实提及', () => {
    const row = {
      agentId: 'pero',
      platform: 'qq',
      accountId: '111111',
      channelId: 'group',
      channelType: 'group',
      senderId: '123456',
      senderName: '群友',
      msgId: '22',
      content: '[图片]',
      rawEventJson: JSON.stringify({
        _isMentioned: true,
        message: [
          { type: 'reply', data: { id: 21 } },
          { type: 'image', data: { url: 'https://example.test/image' } },
        ],
      }),
    } as SocialMessageRecord
    const restored = restoreSocialMessage(row)
    expect(restored).toMatchObject({
      replyTo: '21',
      isMentioned: true,
      attachments: [{ type: 'image', url: 'https://example.test/image' }],
      rawEvent: { self_id: '111111', message_id: '22' },
    })
    expect(
      isSocialMention(
        restoreSocialMessage({
          ...row,
          rawEventJson: '{"_infosQueuedForReply":true}',
        }),
      ),
    ).toBe(false)
    expect(restoreSocialMessage({ ...row, rawEventJson: 'null' }).content).toBe('[图片]')
  })

  it('普通文本保持标点、换行与长句，表情包只保留必要的媒体顺序', () => {
    const content = `你现在方便吗？已经准备好了！\n${'这是完整的长句，'.repeat(30)}结束。`
    expect(splitStickerSegments(content)).toEqual([{ type: 'text', content }])
    expect(
      splitStickerSegments('第一句。\n第二句。[sticker:s_0123456789abcdef01234567]再见！'),
    ).toEqual([
      { type: 'text', content: '第一句。\n第二句。' },
      { type: 'sticker', stickerId: 's_0123456789abcdef01234567' },
      { type: 'text', content: '再见！' },
    ])
  })

  it('主人配置规范化，未配置或非法值不赋予主人身份', () => {
    expect(socialOwnerId(' 654321 ')).toBe('654321')
    for (const value of ['', undefined, 'undefined', 'QQ654321', 0])
      expect(socialOwnerId(value)).toBeUndefined()
  })

  it('编译器按 QQ 独立核验身份，并给多模态图片标明原消息来源', async () => {
    const compiler = new SocialAppCompiler(
      { queryGrants: vi.fn(async () => []) } as never,
      {} as never,
      new MdpEngine(
        fileURLToPath(new URL('../../../../src/services/mdp/prompts/', import.meta.url)),
      ),
      {} as never,
      async () => false,
    )
    const compiled = await compiler.compile({
      instanceId: 'test',
      hostAgentId: 'pero',
      channelType: 'group',
      ownerQq: '654321',
      ownerAppellation: '主人',
      triggerSenderId: '123456',
      triggerSenderName: '主人',
      isOwner: true,
      userMessage: '看看这张图',
      images: ['data:image/png;base64,aW1hZ2U='],
      imageSources: ['消息 22，发送者群友'],
      history: [
        {
          role: 'user',
          content: '你好',
          senderName: '同名群友',
          senderId: '123456',
          timestamp: '',
        },
      ],
    })
    expect(compiled.messages.map((message) => message.content).join('\n')).toContain(
      '当前主要对话对象不是你的主人',
    )
    expect(compiled.messages.map((message) => message.content).join('\n')).toContain(
      'QQ:123456 身份:普通联系人',
    )
    expect(compiled.messages.at(-1)?.content).toEqual([
      { type: 'text', text: '看看这张图' },
      { type: 'text', text: '图片 1 来源：消息 22，发送者群友' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
    ])
  })
})
