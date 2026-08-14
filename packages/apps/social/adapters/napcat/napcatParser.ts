/**
 * NapCat 消息解析器 — CQ码 ↔ 统一格式 双向转换
 *
 * 将 OneBot v11 的 CQ 码消息格式转换为平台无关的
 * InboundMessage / OutboundMessage 格式。
 *
 * @module packages/apps/social/adapters/napcat/napcatParser
 */

import type { Attachment } from '../../runtime/types'

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
  /** NapCat 会话内消息序号 */
  message_seq?: number | string
  messageSeq?: number | string
  msg_seq?: number | string
  /** Unix 秒时间戳 */
  time?: number
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

  // 转发消息 → [转发消息: id=xxx]（不默认展开，让 AI 通过 tool 主动读取）
  content = content.replace(/\[CQ:forward,[^\]]*\]/g, (match) => {
    const idMatch = match.match(/id=([^,\]]+)/)
    const forwardId = idMatch?.[1] ?? '未知'
    return `[转发消息: id=${forwardId}]`
  })

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
    } else if (seg.type === 'forward') {
      // 转发消息：记录 ID，AI 可通过 social_read_forward_msg tool 主动读取内容
      attachments.push({
        type: 'forward',
        forwardId: String(seg.data.id ?? seg.data.resId ?? ''),
      })
    }
  }
  return attachments
}

/**
 * 将 OneBot 消息段数组转换为 CQ 码字符串
 *
 * 用于 getForwardMsg：当转发节点没有 raw_message 字段时，
 * 从 segments 重建 CQ 码字符串，再用 cleanCQCodes 清洗。
 */
export function segmentsToCQString(segments: OneBotSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return String(seg.data.text ?? '')
      // 其他段转为 [CQ:type,key=val,...] 格式，让 cleanCQCodes 处理
      const dataStr = Object.entries(seg.data)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')
      return `[CQ:${seg.type},${dataStr}]`
    })
    .join('')
}

/**
 * 检查消息段中是否 at 了指定 QQ
 *
 * 匹配规则：
 * 1. at 段的 qq 字段 === selfId（精确匹配）
 * 2. at 段的 qq 字段 === 'all'（@全体成员，视为被提及）
 *
 * @param segments OneBot v11 消息段数组
 * @param selfId   Bot 自身 QQ 号
 */
export function checkIsMentioned(segments: OneBotSegment[], selfId: string): boolean {
  for (const seg of segments) {
    if (seg.type !== 'at') continue
    const qq = String(seg.data.qq ?? '')
    // @全体成员 (OneBot v11 中 qq='all')
    if (qq === 'all') return true
    // 精确匹配 Bot QQ
    if (selfId && qq === selfId) return true
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
      if (att.type === 'sticker') {
        // 表情包: 使用 subType=1 让 QQ 显示为表情而非普通图片
        const file = att.localPath
          ? `file:///${att.localPath.replace(/\\/g, '/')}`
          : (att.url ?? '')
        segments.push({
          type: 'image',
          data: {
            file,
            subType: 1, // 关键: 告诉 NTQQ 这是表情包
            summary: '[表情]', // 非图形界面的摘要显示
          },
        })
      } else if (att.type === 'image') {
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
