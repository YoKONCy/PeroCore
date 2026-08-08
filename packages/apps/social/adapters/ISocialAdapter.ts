/**
 * ISocialAdapter — 跨平台社交适配器抽象接口 (Layer 2)
 *
 * 所有平台适配器（NapCat, Discord, Telegram...）都实现此接口。
 * SocialScheduler / SocialBridge 只依赖此接口，不知道具体平台。
 *
 * @module packages/apps/social/adapters/ISocialAdapter
 */

import { EventEmitter } from 'node:events'
import type {
  InboundMessage,
  OutboundMessage,
  InboundEvent,
  AdapterStatus,
} from '../runtime/types'
import type { SocialContact, SocialGroup } from '../tools'

// ─────────────────────────────────────────────
// 事件类型映射
// ─────────────────────────────────────────────

/** 适配器事件映射 (类型安全 EventEmitter) */
export interface SocialAdapterEvents {
  /** 收到入站消息 */
  message: [msg: InboundMessage]
  /** 收到平台事件 (好友请求/群变动等) */
  event: [evt: InboundEvent]
  /** 连接成功 */
  connected: []
  /** 连接断开 */
  disconnected: [reason?: string]
  /** 发生错误 */
  error: [err: Error]
}

// ─────────────────────────────────────────────
// 抽象接口
// ─────────────────────────────────────────────

/**
 * 社交平台适配器抽象基类
 *
 * 使用 EventEmitter 实现事件驱动通信。
 * 适配器负责:
 * 1. 管理与平台的连接
 * 2. 将平台特有格式转换为 InboundMessage
 * 3. 将 OutboundMessage 转换为平台特有格式发出
 * 4. 提供联系人/群组查询能力 (供 SocialMessagingProvider 桥接)
 */
export abstract class AbstractSocialAdapter extends EventEmitter {
  /** 平台标识 (如 'qq', 'discord') */
  abstract readonly platform: string

  // ━━ 生命周期 ━━

  /** 连接到平台 */
  abstract connect(): Promise<void>

  /** 断开连接 */
  abstract disconnect(): Promise<void>

  // ━━ 消息 ━━

  /** 发送消息到指定会话 */
  abstract sendMessage(msg: OutboundMessage): Promise<void>

  /** 获取当前连接状态 */
  abstract getStatus(): Promise<AdapterStatus>

  // ━━ 联系人 & 群组查询 (社交工具层使用) ━━

  /** 获取联系人列表 */
  abstract getContacts(): Promise<SocialContact[]>

  /** 获取群组列表 */
  abstract getGroups(): Promise<SocialGroup[]>

  /** 查询指定用户信息 */
  abstract getContactInfo(userId: string): Promise<SocialContact | null>

  /** 查询指定群组信息 */
  abstract getGroupInfo(groupId: string): Promise<SocialGroup | null>

  /** 查询群组成员列表 */
  abstract getGroupMembers(groupId: string): Promise<SocialContact[]>

  // ━━ 关系管理 ━━

  /** 处理好友请求 */
  abstract handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<void>

  /** 删除好友 */
  abstract removeFriend(userId: string): Promise<void>

  // ━━ 转发消息 ━━

  /**
   * 读取转发消息（合并转发）的内容
   *
   * @param forwardId 转发消息 ID（来自 OneBot forward 段的 id/resId）
   * @returns 转发消息内容列表，每条含发送者、内容、是否含嵌套转发
   */
  abstract getForwardMsg(
    forwardId: string,
  ): Promise<Array<{ senderName: string; senderId: string; content: string; hasNestedForward: boolean }>>

  // ── 类型安全的 emit 辅助 ──

  protected emitMessage(msg: InboundMessage): void {
    this.emit('message', msg)
  }

  protected emitEvent(evt: InboundEvent): void {
    this.emit('event', evt)
  }

  protected emitError(err: Error): void {
    this.emit('error', err)
  }

  protected emitConnected(): void {
    this.emit('connected')
  }

  protected emitDisconnected(reason?: string): void {
    this.emit('disconnected', reason)
  }
}

export type { InboundMessage, OutboundMessage, InboundEvent, AdapterStatus }
