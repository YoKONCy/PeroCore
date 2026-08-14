/**
 * socialOps/notifyOwner — 通知用户工具（保留在主 Agent 内核）
 *
 * 社交系统其余工具已迁移到 packages/apps/social/tools/，
 * 仅 social_notify_owner 保留在主 Agent 内核供通用通知使用。
 *
 * @module packages/backend/src/tools/socialOps/notifyOwner
 */

import type { BuiltinTool } from '../index'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SocialOps')

// ─────────────────────────────────────────────
// SocialMessagingProvider — 抽象接口（内核保留副本）
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
  /** 向用户发送通知 (走 GatewayHub 或社交平台渠道) */
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
// social_notify_owner — 通知用户
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
      return JSON.stringify({ success: true, message: '已通知用户' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`通知用户失败: ${errMsg}`)
      return JSON.stringify({ error: `通知用户失败: ${errMsg}` })
    }
  },
}
