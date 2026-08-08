/**
 * 社交模式 — 跨层共享类型
 *
 * 所有类型设计为平台无关。
 * 只有 Layer 3 适配器（如 NapcatAdapter）包含平台特有逻辑。
 *
 * @module packages/apps/social/runtime/types
 */

// ─────────────────────────────────────────────
// 统一入站消息 (平台 → 后端)
// ─────────────────────────────────────────────

/** 统一入站消息 */
export interface InboundMessage {
  /** 消息来源平台 */
  platform: string
  /** 会话标识 (平台侧的唯一 ID) */
  channelId: string
  /** 会话类型 */
  channelType: 'private' | 'group'
  /** 发送者 ID */
  senderId: string
  /** 发送者显示名 */
  senderName: string
  /** 纯文本内容 (已由适配器清洗, 无平台特定标记) */
  content: string
  /** 附件 (图片/文件等) */
  attachments?: Attachment[]
  /** 引用的消息 ID */
  replyTo?: string
  /** 关联的 Agent ID (适配器根据平台映射确定) */
  agentId: string
  /**
   * 该消息发送者是否为"主人"（owner）
   *
   * 由适配器层根据配置的 ownerQq 与 senderId 比对后填充。
   * 用于权限控制：只有主人能执行敏感操作（删好友、改设置等）。
   * 未知/未配置主人时为 false。
   */
  isOwner?: boolean
  /**
   * 该消息是否提及（@）了 Bot
   *
   * 群聊场景下由适配器层解析 CQ 码填充。
   * 用于图片收集优先级判断：@消息的图片优先级最高。
   */
  isMentioned?: boolean
  /** 原始平台事件 (调试用, 可选) */
  rawEvent?: unknown
  /**
   * 入站路由表解析出的 channel
   *
   * 由 SocialBridge.handleInbound 在查询 inbound_routes 后填充。
   * 未命中路由时为 undefined，由 executeReply 按 channelType 推断（private→social, group→group）。
   */
  routeChannel?: string
  /**
   * 入站路由表解析出的 threadId
   *
   * 命中路由且路由配置了 threadId 时填充。
   * executeReply 会把它作为 sessionId 传给回复回调，
   * 确保同一频道的消息复用同一上下文。
   */
  routeThreadId?: string
}

// ─────────────────────────────────────────────
// 统一出站消息 (后端 → 平台)
// ─────────────────────────────────────────────

/** 统一出站消息 */
export interface OutboundMessage {
  /** 目标会话 ID */
  channelId: string
  /** 会话类型 */
  channelType: 'private' | 'group'
  /** 文本内容 */
  content: string
  /** 附件 (图片/文件等) */
  attachments?: Attachment[]
  /** 回复某条消息 ID */
  replyTo?: string
}

/** 附件 */
export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video' | 'sticker' | 'forward'
  /** 远程 URL */
  url?: string
  /** 本地文件路径 */
  localPath?: string
  /** 文件名 */
  name?: string
  /** MIME 类型 */
  mimeType?: string
  /** 转发消息 ID（type='forward' 时有值，用于调用 get_forward_msg API 读取内容） */
  forwardId?: string
}

// ─────────────────────────────────────────────
// 平台事件 (好友请求/群变动等)
// ─────────────────────────────────────────────

/** 平台事件 */
export interface InboundEvent {
  platform: string
  eventType: string
  data: Record<string, unknown>
  agentId: string
}

// ─────────────────────────────────────────────
// 适配器状态
// ─────────────────────────────────────────────

/** 适配器连接状态 */
export interface AdapterStatus {
  /** 是否已连接 */
  connected: boolean
  /** 平台名称 */
  platform: string
  /** 延迟 (ms) */
  latencyMs: number
  /** 账号信息 */
  accountInfo?: Record<string, unknown>
}

// ─────────────────────────────────────────────
// 社交配置 (Agent 级)
// ─────────────────────────────────────────────

/** Agent 社交绑定配置 */
export interface SocialBinding {
  /** 是否启用社交模式 */
  enabled: boolean
  /** 适配器类型 */
  adapter: string
  /** 平台侧账号 ID (如 QQ 号) */
  accountId: string
  /** 适配器特有配置 */
  config?: Record<string, unknown>
}
