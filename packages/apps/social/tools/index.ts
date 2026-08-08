/**
 * socialOps — 跨平台社交操作工具（社交应用内部使用）
 *
 * 功能列表 (完全平台无关):
 * - social_send_message     → 发送消息 (私聊/群聊)
 * - social_get_contacts     → 获取联系人列表
 * - social_get_groups       → 获取群组列表
 * - social_get_contact_info → 查询用户详情
 * - social_get_group_info   → 查询群组详情
 * - social_get_group_members → 查询群组成员
 * - social_handle_request   → 处理好友请求
 *
 * 注意：social_notify_owner 保留在主 Agent 内核（notifyOwner.ts）。
 *
 * 通过 SocialMessagingProvider 抽象接口解耦，
 * Provider 由 SocialAppRuntime 根据已注册适配器动态注入。
 * 无适配器时: 工具返回 "社交服务未初始化" 友好错误。
 *
 * @module packages/apps/social/tools
 */

import type { BuiltinTool } from '../../../backend/src/tools/index'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialOps')

// ─────────────────────────────────────────────
// SocialMessagingProvider — 抽象接口
// ─────────────────────────────────────────────

/** 平台无关的联系人信息 */
export interface SocialContact {
  /** 平台用户唯一标识 */
  id: string
  /** 显示名/昵称 */
  name: string
  /** 备注名 */
  remark?: string
  /** 来源平台 */
  platform: string
}

/** 平台无关的群组信息 */
export interface SocialGroup {
  /** 平台群组唯一标识 */
  id: string
  /** 群名 */
  name: string
  /** 成员数量 */
  memberCount?: number
  /** 来源平台 */
  platform: string
}

/**
 * 社交消息服务提供者接口
 *
 * 抽象所有平台的消息收发 + 联系人/群组查询 + 关系管理能力。
 * 由 SocialAppRuntime 根据已注册的社交适配器动态注入。
 *
 * 实现方应将调用代理到对应平台的 AbstractSocialAdapter:
 * - NapcatAdapter → OneBot v11 API
 * - DiscordAdapter → Discord REST API
 * - TelegramAdapter → Telegram Bot API
 */
export interface SocialMessagingProvider {
  /** 当前连接的平台标识 */
  readonly platform: string

  // ━━ 消息收发 ━━
  /** 发送消息到指定会话 */
  sendMessage(target: string, content: string, type: 'private' | 'group'): Promise<void>

  // ━━ 联系人查询 ━━
  /** 获取联系人列表 */
  getContacts(): Promise<SocialContact[]>
  /** 获取群组列表 */
  getGroups(): Promise<SocialGroup[]>
  /** 查询指定用户信息 */
  getContactInfo(userId: string): Promise<SocialContact | null>
  /** 查询指定群组信息 */
  getGroupInfo(groupId: string): Promise<SocialGroup | null>
  /** 查询群组成员列表 */
  getGroupMembers(groupId: string): Promise<SocialContact[]>

  // ━━ 关系管理 ━━
  /** 处理好友请求 */
  handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<void>
  /** 删除好友 */
  removeFriend(userId: string): Promise<void>

  // ━━ 转发消息 ━━
  /**
   * 读取转发消息（合并转发）的内容
   *
   * @param forwardId 转发消息 ID
   * @returns 转发消息内容列表
   */
  getForwardMsg(
    forwardId: string,
  ): Promise<
    Array<{
      senderName: string
      senderId: string
      content: string
      hasNestedForward: boolean
    }>
  >

  // ━━ 通知 ━━
  /** 向主人发送通知 (走 GatewayHub 或社交平台渠道) */
  notifyOwner(content: string, importance?: string): Promise<void>
}

// ─────────────────────────────────────────────
// SocialImageReaderProvider — 图片读取接口
// ─────────────────────────────────────────────

/**
 * 社交图片读取提供者接口
 *
 * 按 message_id 从 DB 查询消息的 rawEvent，提取图片 URL，
 * 通过 ImageCacheManager 下载并转换为 data URL。
 *
 * 由 SocialAppRuntime 实现，注入到 social_read_image 工具。
 */
export interface SocialImageReaderProvider {
  /**
   * 按消息 ID 列表读取图片
   *
   * @param messageIds 消息 ID 列表（对应 social_messages.msg_id）
   * @param maxImages  最多读取几张图片（默认 3）
   * @returns 图片 data URL 数组（可能为空）
   */
  readImages(messageIds: string[], maxImages?: number): Promise<string[]>
}

// ─────────────────────────────────────────────
// Provider 注入
// ─────────────────────────────────────────────

/** 模块引用 */
let _messagingProvider: SocialMessagingProvider | null = null
let _imageReaderProvider: SocialImageReaderProvider | null = null

/** 设置社交消息提供者 */
export function setSocialMessagingProvider(provider: SocialMessagingProvider | null): void {
  _messagingProvider = provider
}

/** 设置图片读取提供者 */
export function setSocialImageReaderProvider(provider: SocialImageReaderProvider | null): void {
  _imageReaderProvider = provider
}

/** 辅助: 检查 Provider 可用性，不可用时返回错误 JSON */
function requireProvider(): SocialMessagingProvider | string {
  if (!_messagingProvider) {
    return JSON.stringify({
      error: '社交服务未初始化。当前环境可能无社交适配器连接。',
    })
  }
  return _messagingProvider
}

// ─────────────────────────────────────────────
// social_send_message — 发送消息
// ─────────────────────────────────────────────

export const socialSendMessageTool: BuiltinTool = {
  name: 'social_send_message',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const target = args.target as string
    const content = args.content as string
    const type = args.type as 'private' | 'group'

    try {
      await provider.sendMessage(target, content, type)
      const label = type === 'group' ? `群 ${target}` : `用户 ${target}`
      return JSON.stringify({ success: true, message: `已发送消息到${label}` })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`发送消息失败: ${errMsg}`)
      return JSON.stringify({ error: `发送消息失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_get_contacts — 联系人列表
// ─────────────────────────────────────────────

export const socialGetContactsTool: BuiltinTool = {
  name: 'social_get_contacts',

  async execute() {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    try {
      const contacts = await provider.getContacts()
      if (contacts.length === 0) {
        return JSON.stringify({ success: true, contacts: [], message: '联系人列表为空' })
      }
      return JSON.stringify({
        success: true,
        contacts: contacts.map((c) => ({
          id: c.id,
          name: c.remark || c.name,
          platform: c.platform,
        })),
        total: contacts.length,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `获取联系人列表失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_get_groups — 群组列表
// ─────────────────────────────────────────────

export const socialGetGroupsTool: BuiltinTool = {
  name: 'social_get_groups',

  async execute() {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    try {
      const groups = await provider.getGroups()
      if (groups.length === 0) {
        return JSON.stringify({ success: true, groups: [], message: '群组列表为空' })
      }
      return JSON.stringify({
        success: true,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
          platform: g.platform,
        })),
        total: groups.length,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `获取群组列表失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_get_contact_info — 用户详情
// ─────────────────────────────────────────────

export const socialGetContactInfoTool: BuiltinTool = {
  name: 'social_get_contact_info',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const userId = args.user_id as string
    try {
      const info = await provider.getContactInfo(userId)
      if (!info) {
        return JSON.stringify({ error: `未找到用户: ${userId}` })
      }
      return JSON.stringify({ success: true, contact: info })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `查询用户信息失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_get_group_info — 群组详情
// ─────────────────────────────────────────────

export const socialGetGroupInfoTool: BuiltinTool = {
  name: 'social_get_group_info',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const groupId = args.group_id as string
    try {
      const info = await provider.getGroupInfo(groupId)
      if (!info) {
        return JSON.stringify({ error: `未找到群组: ${groupId}` })
      }
      return JSON.stringify({ success: true, group: info })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `查询群组信息失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_get_group_members — 群组成员
// ─────────────────────────────────────────────

export const socialGetGroupMembersTool: BuiltinTool = {
  name: 'social_get_group_members',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const groupId = args.group_id as string
    try {
      const members = await provider.getGroupMembers(groupId)
      return JSON.stringify({
        success: true,
        members: members.map((m) => ({ id: m.id, name: m.remark || m.name })),
        total: members.length,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `查询群组成员失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_handle_request — 处理好友请求
// ─────────────────────────────────────────────

export const socialHandleRequestTool: BuiltinTool = {
  name: 'social_handle_request',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const flag = args.flag as string
    const approve = args.approve as boolean
    const remark = args.remark as string | undefined

    try {
      await provider.handleFriendRequest(flag, approve, remark)
      const action = approve ? '接受' : '拒绝'
      return JSON.stringify({ success: true, message: `已${action}好友请求` })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `处理好友请求失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_read_forward_msg — 读取转发消息内容
// ─────────────────────────────────────────────

export const socialReadForwardMsgTool: BuiltinTool = {
  name: 'social_read_forward_msg',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const forwardId = args.forward_id as string
    if (!forwardId) {
      return JSON.stringify({ error: '缺少 forward_id 参数' })
    }

    try {
      const messages = await provider.getForwardMsg(forwardId)
      if (messages.length === 0) {
        return JSON.stringify({ success: true, messages: [], message: '转发消息为空或无法读取' })
      }

      // 检查是否有嵌套转发，提示 AI 可以继续读取
      const hasNested = messages.some((m) => m.hasNestedForward)

      return JSON.stringify({
        success: true,
        total: messages.length,
        hasNestedForward: hasNested,
        hint: hasNested
          ? '本转发消息内还包含嵌套的转发消息（标记为 hasNestedForward=true 的条目）。如需读取，请再次调用本工具并传入对应的 forward_id。'
          : undefined,
        messages: messages.map((m, i) => ({
          index: i + 1,
          sender: m.senderName,
          senderId: m.senderId,
          content: m.content,
          hasNestedForward: m.hasNestedForward,
        })),
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`读取转发消息失败: ${errMsg}`)
      return JSON.stringify({ error: `读取转发消息失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// social_read_image — 读取消息中的图片
// ─────────────────────────────────────────────

export const socialReadImageTool: BuiltinTool = {
  name: 'social_read_image',

  async execute(args) {
    if (!_imageReaderProvider) {
      return JSON.stringify({ error: '图片读取服务未初始化' })
    }

    // 接收 message_ids 数组，或单个 message_id 字符串
    const messageIds = Array.isArray(args.message_ids)
      ? (args.message_ids as string[]).filter((id) => typeof id === 'string' && id.length > 0)
      : typeof args.message_id === 'string' && args.message_id.length > 0
        ? [args.message_id as string]
        : []

    if (messageIds.length === 0) {
      return JSON.stringify({
        error: '缺少 message_ids 参数。请传入一个或多个消息 ID，指定要读取哪些消息中的图片。',
      })
    }

    try {
      const maxImages = typeof args.max_images === 'number' ? args.max_images : 3
      const images = await _imageReaderProvider.readImages(messageIds, Math.min(maxImages, 3))

      if (images.length === 0) {
        return JSON.stringify({
          success: true,
          count: 0,
          message: '指定消息中未找到可读取的图片',
        })
      }

      // 返回包含 images 字段的特殊 JSON
      // compiler 的工具调用循环会检测 images 字段，将图片作为多模态 content 注入下一轮 LLM 调用
      return JSON.stringify({
        success: true,
        count: images.length,
        message: `已读取 ${images.length} 张图片`,
        images,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`读取图片失败: ${errMsg}`)
      return JSON.stringify({ error: `读取图片失败: ${errMsg}` })
    }
  },
}
