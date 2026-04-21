/**
 * Phase 1: Ingress — 消息预处理 + 社交适配器统一入口
 *
 * 从原始 ChatMessage[] 中提取用户文本和多模态标记。
 * 无副作用，不访问数据库。
 *
 * 支持来源:
 * - desktop / work: 标准 ChatMessage 格式
 * - social: NapCat Adapter 的统一消息格式
 * - group_chat: 群聊消息 (含 @mention 检测)
 *
 * @module packages/backend/src/services/pipeline/ingress
 */

import type { ChatMessage, IngressResult, MultimodalContent } from './types'
import type { MemorySource } from '@perocore/shared'

/** 社交消息入站格式 (NapCat Adapter 统一) */
export interface InboundSocialMessage {
  /** 发送者 ID */
  senderId: string
  /** 发送者名称 */
  senderName: string
  /** 文本内容 */
  text: string
  /** 图片 URL 列表 */
  images?: string[]
  /** 是否 @了 Agent */
  isMentioned?: boolean
  /** 群组 ID (社交群聊时) */
  groupId?: string
  /** 原始时间戳 */
  timestamp?: number
}

/**
 * 从消息列表中提取用户文本 (标准入口)
 *
 * 策略：从后往前找最近一条 user 消息，
 * 如果是多模态内容则提取所有 text 块拼接。
 */
export function runIngress(messages: ChatMessage[], source?: MemorySource): IngressResult {
  let userText = ''
  let isMultimodal = false
  const attachments: string[] = []

  // 从后往前查找最近的 user 消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role !== 'user') continue

    if (typeof msg.content === 'string') {
      userText = msg.content
    } else if (Array.isArray(msg.content)) {
      isMultimodal = true
      const parts = msg.content as MultimodalContent[]
      userText = parts
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
        .join(' ')

      // 收集图片附件
      for (const part of parts) {
        if (part.type === 'image_url' && part.image_url?.url) {
          attachments.push(part.image_url.url)
        }
      }
    }
    break
  }

  // 来源特殊处理
  if (source === 'group_chat') {
    // 群聊中移除 @mention 前缀
    userText = userText.replace(/^@\S+\s*/, '').trim()
  }

  return {
    userText: userText.trim(),
    isMultimodal,
    rawMessages: messages,
    attachments,
    source: source ?? 'desktop',
  }
}

/**
 * 社交消息转标准 ChatMessage (社交适配器入口)
 *
 * NapCat / 社交 Extension 将原始消息转为统一格式后，
 * 调用此函数转为 ChatMessage[] → 走正常 Pipeline。
 */
export function convertSocialToChat(msg: InboundSocialMessage): ChatMessage[] {
  const messages: ChatMessage[] = []

  if (msg.images?.length) {
    // 多模态消息
    const parts: MultimodalContent[] = [{ type: 'text', text: msg.text }]
    for (const imgUrl of msg.images) {
      parts.push({ type: 'image_url', image_url: { url: imgUrl } })
    }
    messages.push({ role: 'user', content: parts })
  } else {
    // 纯文本消息
    messages.push({
      role: 'user',
      content: msg.isMentioned ? `[来自 ${msg.senderName}] ${msg.text}` : msg.text,
    })
  }

  return messages
}

/**
 * 检测群聊中是否需要回复
 *
 * 规则:
 * 1. 被 @mention → 一定回复
 * 2. 最近 3 条都是同一 Agent → 冷却
 * 3. 短回复 ("嗯", "好") → 降低概率
 */
export function shouldReplyInGroup(
  msg: InboundSocialMessage,
  recentSenderIds: string[],
  agentId: string,
): boolean {
  // 被 @ 一定回复
  if (msg.isMentioned) return true

  // 冷却期: 最近 3 条都是自己说的
  const recentSelf = recentSenderIds.slice(-3).filter((id) => id === agentId)
  if (recentSelf.length >= 3) return false

  // 短回复降低概率
  const shortReplies = ['嗯', '好', '好的', 'ok', '哦', '是', '对']
  if (shortReplies.includes(msg.text.trim().toLowerCase())) {
    return Math.random() < 0.2
  }

  // 默认概率回复
  return Math.random() < 0.5
}
