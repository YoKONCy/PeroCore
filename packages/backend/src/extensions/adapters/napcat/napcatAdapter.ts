/**
 * NapCat 适配器 — OneBot v11 WebSocket 客户端 (Layer 3)
 *
 * 这是整个社交系统中**唯一知道 QQ / OneBot 协议**的层。
 * 负责:
 * 1. 连接 NapCat 的 OneBot v11 反向 WebSocket
 * 2. 接收 WS 事件 → 解析为 InboundMessage → emit('message')
 * 3. 接收 OutboundMessage → 转为 OneBot API → 通过 WS 发出
 * 4. 好友请求自动处理 (平台特有逻辑)
 *
 * 兼容两种模式: 当作为 WS Server 时由 socialRouter 注入连接。
 *
 * @module packages/backend/src/extensions/adapters/napcat/napcatAdapter
 */

import { v4 as uuidv4 } from 'uuid'
import { AbstractSocialAdapter } from '../ISocialAdapter'
import type { OutboundMessage, AdapterStatus } from '../../../services/social/types'
import type { OneBotMessageEvent, OneBotSegment } from './napcatParser'
import {
  cleanCQCodes,
  extractAttachments,
  checkIsMentioned,
  toOneBotSegments,
  buildSendParams,
} from './napcatParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('NapcatAdapter')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

/** NapCat 适配器配置 */
export interface NapcatConfig {
  /** QQ 号 → Agent ID 映射 */
  qqAgentMap: Record<string, string>
  /** 默认 Agent ID (未映射的连接使用) */
  defaultAgentId?: string
  /** 好友请求自动接受 */
  autoAcceptFriend?: boolean
}

// ─────────────────────────────────────────────
// WebSocket 发送接口 (解耦 WebSocket 实现)
// ─────────────────────────────────────────────

/** WS 发送接口 — 允许外部注入 WebSocket 实例 */
export interface WsSender {
  send(data: string): void | Promise<void>
  close(): void
}

// ─────────────────────────────────────────────
// 适配器
// ─────────────────────────────────────────────

export class NapcatAdapter extends AbstractSocialAdapter {
  readonly platform = 'qq'

  private config: NapcatConfig
  /** WS 连接池: selfId → sender */
  private connections = new Map<string, WsSender>()
  /** 默认连接 (无 selfId 时使用) */
  private defaultConnection: WsSender | null = null
  /** Bot 信息缓存 */
  private botInfos = new Map<string, Record<string, unknown>>()
  /** 待响应的 API 请求 */
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (reason: unknown) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(config: NapcatConfig) {
    super()
    this.config = config
    logger.info(`NapcatAdapter 已创建, 映射: ${JSON.stringify(config.qqAgentMap)}`)
  }

  // ── Layer 2 接口实现 ──

  async connect(): Promise<void> {
    // NapCat 使用反向 WS (NapCat 主动连接我们)
    // 实际连接注入由 socialRouter 的 WS 升级端点处理
    logger.info('NapcatAdapter 等待反向 WS 连接...')
  }

  async disconnect(): Promise<void> {
    for (const [id, conn] of this.connections) {
      conn.close()
      logger.info(`已关闭 QQ 连接: ${id}`)
    }
    this.connections.clear()
    this.defaultConnection = null
    this.emitDisconnected('手动断开')
  }

  async sendMessage(msg: OutboundMessage): Promise<void> {
    const segments = toOneBotSegments(msg.content, msg.attachments)
    const params = buildSendParams(msg.channelId, msg.channelType, segments)

    // 如果有回复引用，添加 reply 段
    if (msg.replyTo) {
      ;(params.message as OneBotSegment[]).unshift({
        type: 'reply',
        data: { id: msg.replyTo },
      })
    }

    await this.callApi('send_msg', params)
    logger.debug(`消息已发送: channel=${msg.channelId}, type=${msg.channelType}`)
  }

  async getStatus(): Promise<AdapterStatus> {
    const connected = this.connections.size > 0 || this.defaultConnection !== null
    let latencyMs = -1

    if (connected) {
      const start = Date.now()
      try {
        const resp = (await this.callApi('get_version_info', {}, 3000)) as Record<
          string,
          unknown
        > | null
        if (resp && resp.status === 'ok') {
          latencyMs = Date.now() - start
        }
      } catch {
        // 超时, 保持 -1
      }
    }

    // 取第一个 Bot 的信息
    const firstBotInfo = this.botInfos.size > 0 ? this.botInfos.values().next().value : undefined

    return {
      connected,
      platform: 'qq',
      latencyMs,
      accountInfo: firstBotInfo as Record<string, unknown> | undefined,
    }
  }

  // ── 连接管理 (由 socialRouter WS 端点调用) ──

  /**
   * 注入一个反向 WS 连接
   *
   * NapCat 主动连接我们的 WS 端点时调用此方法。
   * selfId 从 `X-Self-ID` header 获取。
   */
  registerConnection(selfId: string | undefined, sender: WsSender): void {
    if (selfId) {
      this.connections.set(String(selfId), sender)
      const agentId = this.config.qqAgentMap[String(selfId)]
      if (agentId) {
        logger.info(`已注册 QQ 连接: ${selfId} → Agent ${agentId}`)
      } else {
        logger.warn(`已注册 QQ 连接: ${selfId}, 但未映射到任何 Agent`)
      }
    } else {
      this.defaultConnection = sender
      logger.info('已注册默认 QQ 连接 (无 X-Self-ID)')
    }
    this.emitConnected()
  }

  /** 注销连接 */
  unregisterConnection(selfId: string | undefined): void {
    if (selfId && this.connections.has(String(selfId))) {
      this.connections.delete(String(selfId))
      logger.info(`QQ 连接已断开: ${selfId}`)
    } else if (!selfId && this.defaultConnection) {
      this.defaultConnection = null
      logger.info('默认 QQ 连接已断开')
    }

    if (this.connections.size === 0 && !this.defaultConnection) {
      this.emitDisconnected('所有连接关闭')
    }
  }

  // ── 原始事件处理 ──

  /**
   * 处理来自 WS 的原始 JSON 文本
   *
   * 由 socialRouter 的 WS onMessage 调用。
   */
  async handleRawEvent(rawData: string): Promise<void> {
    let event: OneBotMessageEvent
    try {
      event = JSON.parse(rawData) as OneBotMessageEvent
    } catch {
      return // 非 JSON, 忽略
    }

    // 处理 API 响应 (echo 字段)
    if (event.echo) {
      const pending = this.pendingRequests.get(event.echo)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(event.echo)
        pending.resolve(event)
      }
      return
    }

    const postType = event.post_type

    // 心跳忽略
    if (postType === 'meta_event') return

    // 消息事件
    if (postType === 'message') {
      await this.handleMessageEvent(event)
      return
    }

    // 好友请求事件
    if (postType === 'request' && event.request_type === 'friend') {
      await this.handleAutoFriendRequest(event)
      return
    }

    // 其他事件暂忽略 (notice 等)
  }

  // ── 私有方法 ──

  /**
   * 处理消息事件 → 转为 InboundMessage → emit
   */
  private async handleMessageEvent(event: OneBotMessageEvent): Promise<void> {
    const msgType = event.message_type
    if (!msgType) return

    const selfId = String(event.self_id ?? '')
    const userId = String(event.user_id ?? '')

    // 确定 Agent
    const agentId = this.config.qqAgentMap[selfId] ?? this.config.defaultAgentId ?? 'pero'

    // 忽略自己发的消息
    if (userId === selfId) return

    // 缓存 Bot 信息
    if (selfId && !this.botInfos.has(selfId)) {
      this.botInfos.set(selfId, { user_id: selfId })
      logger.info(`检测到 Bot: ${selfId} (Agent: ${agentId})`)
    }

    // 解析字段
    const channelId = msgType === 'group' ? String(event.group_id ?? '') : userId

    const senderName = event.sender?.nickname ?? event.sender?.card ?? `User${userId}`

    const rawContent = event.raw_message ?? ''
    const segments = event.message ?? []

    // 清洗 CQ 码
    const cleanedContent = cleanCQCodes(rawContent)

    // 提取附件
    const attachments = extractAttachments(segments)

    // 检测 @
    const isMentioned = checkIsMentioned(segments, selfId)

    // 构建统一 InboundMessage
    this.emitMessage({
      platform: 'qq',
      channelId,
      channelType: msgType === 'group' ? 'group' : 'private',
      senderId: userId,
      senderName,
      content: cleanedContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      agentId,
      rawEvent: {
        ...event,
        _isMentioned: isMentioned,
        _selfId: selfId,
      },
    })
  }

  /**
   * 处理好友请求 (NapCat 特有)
   */
  private async handleAutoFriendRequest(event: OneBotMessageEvent): Promise<void> {
    if (!this.config.autoAcceptFriend) {
      logger.info(`收到好友请求 (未启用自动接受), flag=${event.flag}`)
      return
    }

    if (!event.flag) return

    try {
      await this.callApi('set_friend_add_request', {
        flag: event.flag,
        approve: true,
      })
      logger.info(`已自动接受好友请求: flag=${event.flag}`)
    } catch (err) {
      logger.warn(`接受好友请求失败: ${err}`)
    }
  }

  /**
   * 调用 OneBot v11 API
   *
   * 通过 WS 发送 JSON-RPC 请求并等待 echo 响应。
   */
  async callApi(
    action: string,
    params: Record<string, unknown>,
    timeoutMs = 10000,
  ): Promise<unknown> {
    const sender = this.getActiveSender()
    if (!sender) {
      throw new Error('无可用的 NapCat 连接')
    }

    const echoId = uuidv4()
    const payload = JSON.stringify({ action, params, echo: echoId })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(echoId)
        reject(new Error(`NapCat API 调用超时: ${action} (${timeoutMs}ms)`))
      }, timeoutMs)

      this.pendingRequests.set(echoId, { resolve, reject, timer })
      sender.send(payload)
    })
  }

  /** 获取活跃的 WS 发送器 */
  private getActiveSender(): WsSender | null {
    if (this.defaultConnection) return this.defaultConnection
    if (this.connections.size > 0) {
      return this.connections.values().next().value ?? null
    }
    return null
  }

  // ── Layer 2 新增: 联系人/群组查询 (OneBot v11 API Bridge) ──

  async getContacts(): Promise<import('../../../tools/socialOps').SocialContact[]> {
    const resp = (await this.callApi('get_friend_list', {})) as Record<string, unknown>
    const data = resp?.data as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(data)) return []

    return data.map((f) => ({
      id: String(f.user_id ?? ''),
      name: String(f.nickname ?? ''),
      remark: f.remark ? String(f.remark) : undefined,
      platform: 'qq',
    }))
  }

  async getGroups(): Promise<import('../../../tools/socialOps').SocialGroup[]> {
    const resp = (await this.callApi('get_group_list', {})) as Record<string, unknown>
    const data = resp?.data as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(data)) return []

    return data.map((g) => ({
      id: String(g.group_id ?? ''),
      name: String(g.group_name ?? ''),
      memberCount: typeof g.member_count === 'number' ? g.member_count : undefined,
      platform: 'qq',
    }))
  }

  async getContactInfo(
    userId: string,
  ): Promise<import('../../../tools/socialOps').SocialContact | null> {
    try {
      const resp = (await this.callApi('get_stranger_info', { user_id: Number(userId) })) as Record<
        string,
        unknown
      >
      const data = resp?.data as Record<string, unknown> | undefined
      if (!data) return null

      return {
        id: String(data.user_id ?? userId),
        name: String(data.nickname ?? ''),
        remark: data.remark ? String(data.remark) : undefined,
        platform: 'qq',
      }
    } catch {
      return null
    }
  }

  async getGroupInfo(
    groupId: string,
  ): Promise<import('../../../tools/socialOps').SocialGroup | null> {
    try {
      const resp = (await this.callApi('get_group_info', { group_id: Number(groupId) })) as Record<
        string,
        unknown
      >
      const data = resp?.data as Record<string, unknown> | undefined
      if (!data) return null

      return {
        id: String(data.group_id ?? groupId),
        name: String(data.group_name ?? ''),
        memberCount: typeof data.member_count === 'number' ? data.member_count : undefined,
        platform: 'qq',
      }
    } catch {
      return null
    }
  }

  async getGroupMembers(
    groupId: string,
  ): Promise<import('../../../tools/socialOps').SocialContact[]> {
    try {
      const resp = (await this.callApi('get_group_member_list', {
        group_id: Number(groupId),
      })) as Record<string, unknown>
      const data = resp?.data as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(data)) return []

      return data.map((m) => ({
        id: String(m.user_id ?? ''),
        name: String(m.card || m.nickname || ''),
        remark: m.card ? String(m.card) : undefined,
        platform: 'qq',
      }))
    } catch {
      return []
    }
  }

  async handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<void> {
    await this.callApi('set_friend_add_request', {
      flag,
      approve,
      ...(remark ? { remark } : {}),
    })
  }

  async removeFriend(userId: string): Promise<void> {
    await this.callApi('delete_friend', { user_id: Number(userId) })
  }
}
