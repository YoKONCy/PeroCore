/**
 * socialOps — 跨平台社交操作工具
 *
 * 功能列表 (完全平台无关):
 * - social_send_message     → 发送消息 (私聊/群聊)
 * - social_get_contacts     → 获取联系人列表
 * - social_get_groups       → 获取群组列表
 * - social_get_contact_info → 查询用户详情
 * - social_get_group_info   → 查询群组详情
 * - social_get_group_members → 查询群组成员
 * - social_handle_request   → 处理好友请求
 * - social_notify_owner     → 通知主人
 *
 * 通过 SocialMessagingProvider 抽象接口解耦，
 * Provider 由 container.ts 根据已注册适配器动态注入。
 * 无适配器时: 工具返回 "社交服务未初始化" 友好错误。
 *
 * @module packages/backend/src/tools/socialOps
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

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
 * 由 container.ts 根据已注册的社交适配器动态注入。
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

  // ━━ 通知 ━━
  /** 向主人发送通知 (走 GatewayHub 或社交平台渠道) */
  notifyOwner(content: string, importance?: string): Promise<void>
}

// ─────────────────────────────────────────────
// Provider 注入
// ─────────────────────────────────────────────

/** 模块引用 */
let _messagingProvider: SocialMessagingProvider | null = null

/** 设置社交消息提供者 */
export function setSocialMessagingProvider(provider: SocialMessagingProvider | null): void {
  _messagingProvider = provider
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
// social_notify_owner — 通知主人
// ─────────────────────────────────────────────

export const socialNotifyOwnerTool: BuiltinTool = {
  name: 'social_notify_owner',

  async execute(args) {
    const provider = requireProvider()
    if (typeof provider === 'string') return provider

    const content = args.content as string
    const importance = (args.importance as string) ?? 'medium'

    try {
      await provider.notifyOwner(content, importance)
      return JSON.stringify({ success: true, message: '已通知主人' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `通知主人失败: ${errMsg}` })
    }
  },
}
