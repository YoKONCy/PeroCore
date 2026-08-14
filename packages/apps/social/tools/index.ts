import type { BuiltinTool } from '../../../backend/src/tools/index'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialOps')

export interface SocialContact {
  id: string
  name: string
  remark?: string
  platform: string
}

export interface SocialGroup {
  id: string
  name: string
  memberCount?: number
  platform: string
}

export interface SocialMessagingProvider {
  readonly platform: string
  sendMessage(
    agentId: string,
    target: string,
    content: string,
    type: 'private' | 'group',
  ): Promise<void>
  getContacts(): Promise<SocialContact[]>
  getGroups(): Promise<SocialGroup[]>
  getContactInfo(userId: string): Promise<SocialContact | null>
  getGroupInfo(groupId: string): Promise<SocialGroup | null>
  getGroupMembers(groupId: string): Promise<SocialContact[]>
  handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<void>
  removeFriend(userId: string): Promise<void>
  getForwardMsg(forwardId: string): Promise<
    Array<{
      senderName: string
      senderId: string
      content: string
      hasNestedForward: boolean
    }>
  >
  notifyOwner(content: string, importance?: string): Promise<void>
}

export interface SocialImageReaderProvider {
  readImages(agentId: string, messageIds: string[], maxImages?: number): Promise<string[]>
}

export interface SocialContactMemoryProvider {
  rememberImpression(input: {
    agentId: string
    userId: string
    displayName?: string
    identity?: string
    impression: string
    sourceChannelId?: string
  }): Promise<void>
  getContactHistory(input: {
    agentId: string
    userId: string
    groupId?: string
    privateLimit?: number
    groupLimit?: number
    selfMessageLimit?: number
  }): Promise<Record<string, unknown>>
}

let messagingProvider: SocialMessagingProvider | null = null
let imageReaderProvider: SocialImageReaderProvider | null = null
let contactMemoryProvider: SocialContactMemoryProvider | null = null

export function setSocialMessagingProvider(provider: SocialMessagingProvider | null): void {
  messagingProvider = provider
}

export function setSocialImageReaderProvider(provider: SocialImageReaderProvider | null): void {
  imageReaderProvider = provider
}

export function setSocialContactMemoryProvider(provider: SocialContactMemoryProvider | null): void {
  contactMemoryProvider = provider
}

function requireMessagingProvider(): SocialMessagingProvider | string {
  return (
    messagingProvider ??
    JSON.stringify({ error: '社交服务未初始化。当前环境可能无社交适配器连接。' })
  )
}

export const socialSendMessageTool: BuiltinTool = {
  name: 'social_send_message',
  async execute(args, context) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    try {
      const target = String(args.target ?? '')
      const content = String(args.content ?? '')
      const type = args.type as 'private' | 'group'
      await provider.sendMessage(context.agentId, target, content, type)
      return JSON.stringify({
        success: true,
        message: `已发送消息到${type === 'group' ? `群 ${target}` : `用户 ${target}`}`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`发送消息失败: ${message}`)
      return JSON.stringify({ error: `发送消息失败: ${message}` })
    }
  },
}

export const socialGetContactsTool: BuiltinTool = {
  name: 'social_get_contacts',
  async execute() {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    try {
      const contacts = await provider.getContacts()
      return JSON.stringify({
        success: true,
        contacts: contacts.map((item) => ({
          id: item.id,
          name: item.remark || item.name,
          platform: item.platform,
        })),
        total: contacts.length,
      })
    } catch (err) {
      return JSON.stringify({
        error: `获取联系人列表失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialGetGroupsTool: BuiltinTool = {
  name: 'social_get_groups',
  async execute() {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    try {
      const groups = await provider.getGroups()
      return JSON.stringify({ success: true, groups, total: groups.length })
    } catch (err) {
      return JSON.stringify({
        error: `获取群组列表失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialGetContactInfoTool: BuiltinTool = {
  name: 'social_get_contact_info',
  async execute(args) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    const userId = String(args.user_id ?? '')
    try {
      const contact = await provider.getContactInfo(userId)
      return contact
        ? JSON.stringify({ success: true, contact })
        : JSON.stringify({ error: `未找到用户: ${userId}` })
    } catch (err) {
      return JSON.stringify({
        error: `查询用户信息失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialGetGroupInfoTool: BuiltinTool = {
  name: 'social_get_group_info',
  async execute(args) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    const groupId = String(args.group_id ?? '')
    try {
      const group = await provider.getGroupInfo(groupId)
      return group
        ? JSON.stringify({ success: true, group })
        : JSON.stringify({ error: `未找到群组: ${groupId}` })
    } catch (err) {
      return JSON.stringify({
        error: `查询群组信息失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialGetGroupMembersTool: BuiltinTool = {
  name: 'social_get_group_members',
  async execute(args) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    try {
      const members = await provider.getGroupMembers(String(args.group_id ?? ''))
      return JSON.stringify({
        success: true,
        members: members.map((item) => ({ id: item.id, name: item.remark || item.name })),
        total: members.length,
      })
    } catch (err) {
      return JSON.stringify({
        error: `查询群组成员失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialHandleRequestTool: BuiltinTool = {
  name: 'social_handle_request',
  async execute(args) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    try {
      const approve = args.approve === true
      await provider.handleFriendRequest(
        String(args.flag ?? ''),
        approve,
        typeof args.remark === 'string' ? args.remark : undefined,
      )
      return JSON.stringify({ success: true, message: `已${approve ? '接受' : '拒绝'}好友请求` })
    } catch (err) {
      return JSON.stringify({
        error: `处理好友请求失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialReadForwardMsgTool: BuiltinTool = {
  name: 'social_read_forward_msg',
  async execute(args) {
    const provider = requireMessagingProvider()
    if (typeof provider === 'string') return provider
    const forwardId = String(args.forward_id ?? '')
    if (!forwardId) return JSON.stringify({ error: '缺少 forward_id 参数' })
    try {
      const messages = await provider.getForwardMsg(forwardId)
      const hasNestedForward = messages.some((item) => item.hasNestedForward)
      return JSON.stringify({
        success: true,
        total: messages.length,
        hasNestedForward,
        hint: hasNestedForward
          ? '内容中包含嵌套转发，可使用对应 forward_id 再次调用本工具。'
          : undefined,
        messages: messages.map((item, index) => ({
          index: index + 1,
          sender: item.senderName,
          senderId: item.senderId,
          content: item.content,
          hasNestedForward: item.hasNestedForward,
        })),
      })
    } catch (err) {
      return JSON.stringify({
        error: `读取转发消息失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialReadImageTool: BuiltinTool = {
  name: 'social_read_image',
  async execute(args, context) {
    if (!imageReaderProvider) return JSON.stringify({ error: '图片读取服务未初始化' })
    const messageIds = Array.isArray(args.message_ids)
      ? args.message_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (messageIds.length === 0) return JSON.stringify({ error: '缺少 message_ids 参数' })
    try {
      const maxImages = typeof args.max_images === 'number' ? Math.min(args.max_images, 3) : 3
      const images = await imageReaderProvider.readImages(context.agentId, messageIds, maxImages)
      return JSON.stringify({
        success: true,
        count: images.length,
        message: `已读取 ${images.length} 张图片`,
        images,
      })
    } catch (err) {
      return JSON.stringify({
        error: `读取图片失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const socialRememberContactImpressionTool: BuiltinTool = {
  name: 'social_remember_contact_impression',
  async execute(args, context) {
    if (!contactMemoryProvider) return JSON.stringify({ error: '联系人印象服务未初始化' })
    const userId = String(args.user_id ?? '').trim()
    const impression = String(args.impression ?? '')
      .trim()
      .slice(0, 500)
    const identity =
      typeof args.identity === 'string' ? args.identity.trim().slice(0, 500) : undefined
    if (!userId || !impression) return JSON.stringify({ error: 'user_id 和 impression 不能为空' })
    await contactMemoryProvider.rememberImpression({
      agentId: context.agentId,
      userId,
      displayName:
        typeof args.display_name === 'string' ? args.display_name.trim().slice(0, 100) : undefined,
      identity,
      impression,
      sourceChannelId:
        typeof args.source_channel_id === 'string' ? args.source_channel_id : undefined,
    })
    return JSON.stringify({ success: true, message: `已更新对用户 ${userId} 的印象与身份` })
  },
}

export const socialGetContactHistoryTool: BuiltinTool = {
  name: 'social_get_contact_history',
  async execute(args, context) {
    if (!contactMemoryProvider) return JSON.stringify({ error: '联系人历史服务未初始化' })
    const userId = String(args.user_id ?? '').trim()
    if (!userId) return JSON.stringify({ error: 'user_id 不能为空' })
    const result = await contactMemoryProvider.getContactHistory({
      agentId: context.agentId,
      userId,
      groupId: typeof args.group_id === 'string' ? args.group_id : undefined,
      privateLimit:
        typeof args.private_limit === 'number' ? Math.min(Math.max(args.private_limit, 1), 50) : 20,
      groupLimit:
        typeof args.group_limit === 'number' ? Math.min(Math.max(args.group_limit, 1), 80) : 30,
      selfMessageLimit:
        typeof args.self_message_limit === 'number'
          ? Math.min(Math.max(args.self_message_limit, 1), 20)
          : 5,
    })
    return JSON.stringify({ success: true, ...result })
  },
}
