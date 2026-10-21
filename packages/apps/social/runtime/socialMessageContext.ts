import type { SocialMessageRecord } from '@infos/shared'
import {
  extractAttachments,
  extractReplyId,
  type OneBotSegment,
} from '../adapters/napcat/napcatParser'
import type { InboundMessage } from './types'

export function socialOwnerId(value: unknown): string | undefined {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  return /^[1-9]\d{4,19}$/.test(id) ? id : undefined
}

export function isSocialMention(message: InboundMessage): boolean {
  const raw = message.rawEvent as Record<string, unknown> | undefined
  return message.isMentioned === true || raw?._isMentioned === true
}

/** 同一回合只以最后一个明确提及者为主要对话对象，普通消息不会继承主人的身份。 */
export function socialTriggerMessage(messages: InboundMessage[]): InboundMessage | undefined {
  return [...messages].reverse().find(isSocialMention) ?? messages.at(-1)
}

export function socialMessageId(message: InboundMessage): string {
  return String((message.rawEvent as Record<string, unknown> | undefined)?.message_id ?? '')
}

export function formatSocialMessage(
  message: InboundMessage,
  ownerId?: string,
  isBot?: (id: string) => boolean,
): string {
  const identity =
    message.senderId === 'self'
      ? '自己'
      : ownerId && message.senderId === ownerId
        ? '主人'
        : '普通联系人'
  const id = socialMessageId(message)
  const reference = message.replyTo ? ` [引用:${message.replyTo}]` : ''
  const bot =
    identity === '普通联系人' && (isBot ? isBot(message.senderId) : message.senderKind === 'bot')
      ? ' [bot·无需刻意回应@]'
      : ''
  return `[${JSON.stringify(message.senderName)} QQ:${message.senderId} 身份:${identity}]${bot}${id ? ` [msg:${id}]` : ''}${reference}: ${message.content}`
}

/** 历史与恢复队列共用同一份规范化信息，也识别已保存的原始平台附件。 */
export function restoreSocialMessage(row: SocialMessageRecord): InboundMessage {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(row.rawEventJson || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      raw = parsed as Record<string, unknown>
  } catch {
    // 旧消息的原始数据损坏时仍保留正文与发送者。
  }
  const normalized = raw._infosInbound as Partial<InboundMessage> | undefined
  const segments = Array.isArray(raw.message)
    ? raw.message.filter((item): item is OneBotSegment =>
        Boolean(
          item &&
          typeof item === 'object' &&
          typeof item.type === 'string' &&
          item.data &&
          typeof item.data === 'object',
        ),
      )
    : []
  return {
    platform: row.platform,
    agentId: row.agentId,
    channelId: row.channelId,
    channelType: row.channelType as 'private' | 'group',
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    attachments: Array.isArray(normalized?.attachments)
      ? normalized.attachments
      : extractAttachments(segments),
    replyTo: normalized?.replyTo ?? extractReplyId(segments),
    routeThreadId: normalized?.routeThreadId,
    isMentioned: normalized?.isMentioned === true || raw._isMentioned === true,
    senderKind: normalized?.senderKind,
    rawEvent: { ...raw, self_id: row.accountId, message_id: row.msgId },
  }
}
