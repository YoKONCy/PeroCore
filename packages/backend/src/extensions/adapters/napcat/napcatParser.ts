/**
 * NapCat 消息解析器 — CQ码 ↔ 统一格式 双向转换
 *
 * 将 OneBot v11 的 CQ 码消息格式转换为平台无关的
 * InboundMessage / OutboundMessage 格式。
 *
 * 及 ~L1200-1600 的发送消息逻辑。
 *
 * @module packages/backend/src/extensions/adapters/napcat/napcatParser
 */

import type { Attachment } from '../../../services/social/types'

// ─────────────────────────────────────────────
// OneBot v11 类型
// ─────────────────────────────────────────────

/** OneBot v11 消息段 */
export interface OneBotSegment {
  type: string
  data: Record<string, unknown>
}

/** OneBot v11 消息事件 */
export interface OneBotMessageEvent {
  post_type: 'message' | 'meta_event' | 'notice' | 'request'
  message_type?: 'private' | 'group'
  message_id?: number
  self_id?: number | string
  user_id?: number | string
  group_id?: number | string
  sender?: {
    user_id?: number | string
    nickname?: string
    card?: string
  }
  message?: OneBotSegment[]
  raw_message?: string
  echo?: string
  status?: string
  retcode?: number
  data?: unknown
  request_type?: string
  flag?: string
  comment?: string
}

// ─────────────────────────────────────────────
// CQ码清洗 (入站: 平台 → 后端)
// ─────────────────────────────────────────────

/**
 * 清洗 CQ 码为人类可读文本
 *
 */
export function cleanCQCodes(content: string): string {
  if (!content.includes('[CQ:')) return content

  // 图片 → [图片] 或 [summary文本]
  content = content.replace(/\[CQ:image,[^\]]*\]/g, (match) => {
    const summaryMatch = match.match(/summary=\[?(.*?)\]?(?:,|\])/)
    if (summaryMatch?.[1]) {
      const text = summaryMatch[1]
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&amp;/g, '&')
      return text.startsWith('[') ? text : `[${text}]`
    }
    return '[图片]'
  })

  // 文件 → [文件: xxx]
  content = content.replace(/\[CQ:file,[^\]]*\]/g, (match) => {
    const nameMatch = match.match(/name=([^,\]]+)/)
    return `[文件: ${nameMatch?.[1] ?? '未知文件'}]`
  })

  // 表情 → [表情]
  content = content.replace(/\[CQ:face,[^\]]*\]/g, '[表情]')

  // at → @昵称
  content = content.replace(/\[CQ:at,[^\]]*\]/g, (match) => {
    const nameMatch = match.match(/name=([^,\]]+)/)
    const qqMatch = match.match(/qq=([^,\]]+)/)
    return `@${nameMatch?.[1] ?? qqMatch?.[1] ?? '未知'}`
  })

  // 回复引用 → 移除
  content = content.replace(/\[CQ:reply,[^\]]*\]/g, '')

  // 其他未知 CQ码 → 移除
  content = content.replace(/\[CQ:[^\]]*\]/g, '')

  return content.trim()
}

/**
 * 从 OneBot 消息段提取附件
 */
export function extractAttachments(segments: OneBotSegment[]): Attachment[] {
  const attachments: Attachment[] = []
  for (const seg of segments) {
    if (seg.type === 'image') {
      attachments.push({
        type: 'image',
        url: seg.data.url as string | undefined,
        name: seg.data.file as string | undefined,
      })
    } else if (seg.type === 'file') {
      attachments.push({
        type: 'file',
        url: seg.data.url as string | undefined,
        name: seg.data.name as string | undefined,
      })
    }
  }
  return attachments
}

/**
 * 检查消息段中是否 at 了指定 QQ
 */
export function checkIsMentioned(segments: OneBotSegment[], selfId: string): boolean {
  for (const seg of segments) {
    if (seg.type === 'at' && String(seg.data.qq) === selfId) {
      return true
    }
  }
  return false
}

// ─────────────────────────────────────────────
// 出站转换 (后端 → 平台)
// ─────────────────────────────────────────────

/**
 * 将 OutboundMessage 的内容转换为 OneBot v11 消息段数组
 */
export function toOneBotSegments(content: string, attachments?: Attachment[]): OneBotSegment[] {
  const segments: OneBotSegment[] = []

  // 文本段
  if (content) {
    segments.push({ type: 'text', data: { text: content } })
  }

  // 附件段
  if (attachments) {
    for (const att of attachments) {
      if (att.type === 'image') {
        const file = att.localPath ? `file:///${att.localPath}` : (att.url ?? '')
        segments.push({ type: 'image', data: { file } })
      }
    }
  }

  return segments
}

/**
 * 构建 OneBot v11 send_msg API 参数
 */
export function buildSendParams(
  channelId: string,
  channelType: 'private' | 'group',
  segments: OneBotSegment[],
): Record<string, unknown> {
  if (channelType === 'group') {
    return {
      group_id: Number(channelId),
      message: segments,
    }
  }
  return {
    user_id: Number(channelId),
    message: segments,
  }
}
