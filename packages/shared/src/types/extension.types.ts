/**
 * 扩展系统类型定义
 *
 * 对齐
 * - 三种扩展类型：Tool / Hook / Service
 * - Hook 事件清单 + 处理函数签名
 * - manifest.json 结构
 *
 * @module @perocore/shared/types/extension
 */

// ─────────────────────────────────────────────
// 扩展清单 (manifest.json)
// ─────────────────────────────────────────────

/** 扩展类型 */
export type ExtensionType = 'tool' | 'hook' | 'service'

/** 扩展分类 */
export type ExtensionCategory = 'core' | 'work' | 'group' | 'community'

/** 平台标识 */
export type PlatformId = 'windows' | 'linux' | 'darwin' | 'docker'

/** 扩展权限声明 */
export type ExtensionPermission =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network:local'
  | 'network:internet'
  | 'process:spawn'
  | 'database:read'
  | 'database:write'
  | 'system:info'

/** 外部二进制依赖声明 */
export interface BinaryDependency {
  /** 用途说明 */
  purpose: string
  /** 是否必须 (false = 有降级方案) */
  required: boolean
  /** 安装提示 URL */
  installHint?: string
}

/** 统一扩展清单 (manifest.json) */
export interface ExtensionManifest {
  /** 唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 版本号 */
  version: string
  /** 作者 */
  author?: string
  /** 描述 */
  description?: string
  /** 扩展类型 */
  type: ExtensionType
  /** 入口文件 */
  entry: string
  /** 分类 */
  category?: ExtensionCategory
  /** 支持平台 */
  platforms?: PlatformId[]
  /** 权限声明 */
  permissions?: ExtensionPermission[]
  /** Tool 专属: 工具定义 (给 LLM function calling) */
  toolDefinition?: ToolDefinition
  /** Service 专属配置 */
  service?: {
    transport: 'stdio' | 'http'
    port?: number
    healthCheck?: string
  }
  /** 是否已预打包 (true = 无需 npm install，推荐) */
  bundled?: boolean
  /** npm 依赖 (仅 bundled=false 时，安装时自动 npm install) */
  dependencies?: Record<string, string>
  /** 外部二进制依赖 (如 ripgrep, Everything 等) */
  binaries?: Record<string, BinaryDependency>
  /** 加载路径 (运行时注入，非清单原始字段) */
  path?: string
}

// ─────────────────────────────────────────────
// 工具定义 (给 LLM function calling)
// ─────────────────────────────────────────────

/** JSON Schema 风格的参数定义 */
export interface ToolParameterSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: string
      description?: string
      enum?: string[]
    }
  >
  required?: string[]
}

/** 工具定义 (暴露给 LLM 的 function schema) */
export interface ToolDefinition {
  /** 工具名称 (snake_case) */
  name: string
  /** 工具描述 (供 LLM 理解用途) */
  description: string
  /** 参数 schema */
  parameters: ToolParameterSchema
}

// ─────────────────────────────────────────────
// Tool 扩展
// ─────────────────────────────────────────────

/** 工具执行上下文 */
export interface ToolContext {
  /** 当前 Agent ID */
  agentId: string
  /** 当前会话 ID */
  sessionId: string
  /** 日志器 */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void
    warn(msg: string, meta?: Record<string, unknown>): void
    error(msg: string, meta?: Record<string, unknown>): void
  }
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

/** Tool 扩展接口 */
export interface ToolExtension {
  /** 工具定义 (给 LLM) */
  definition: ToolDefinition
  /** 执行函数 */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
  /** 可选：初始化 */
  onLoad?(): Promise<void>
  /** 可选：清理 */
  dispose?(): Promise<void>
}

// ─────────────────────────────────────────────
// Hook 扩展
// ─────────────────────────────────────────────

/**
 * 已定义的 Hook 事件清单
 *
 * 初始清单，后续深入代码逻辑时补充完善。
 * 每个 Hook 的触发位置：
 * - chat:beforeSend → Pipeline.ingress()
 * - chat:afterReply → Pipeline.egress()
 * - chat:beforeToolCall → ToolExecutor.execute()
 * - chat:afterToolCall → ToolExecutor.execute()
 * - memory:beforeCreate → MemoryService.create()
 * - memory:afterCreate → MemoryService.create()
 * - memory:beforeDelete → MemoryService.delete()
 * - memory:afterRetrieve → MemorySearchService.recall()
 * - agent:onSwitch → AgentService.switchAgent()
 * - agent:onMoodChange → AgentService.updateMood()
 * - app:onStart → app.ts 启动
 * - app:onShutdown → app.ts 关闭
 */
export type HookEvent =
  // === 聊天 ===
  | 'chat:beforeSend'
  | 'chat:afterReply'
  | 'chat:beforeToolCall'
  | 'chat:afterToolCall'
  // === 记忆 ===
  | 'memory:beforeCreate'
  | 'memory:afterCreate'
  | 'memory:beforeDelete'
  | 'memory:afterRetrieve'
  // === Agent ===
  | 'agent:onSwitch'
  | 'agent:onMoodChange'
  // === 生命周期 ===
  | 'app:onStart'
  | 'app:onShutdown'

/** Hook 上下文 */
export interface HookContext {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void
    warn(msg: string, meta?: Record<string, unknown>): void
    error(msg: string, meta?: Record<string, unknown>): void
  }
  /** 中断后续 Hook 执行 */
  abort(reason?: string): void
}

/** Hook 处理函数 */
export type HookHandler<T = unknown> = (data: T, ctx: HookContext) => Promise<T | undefined | void>

/** Hook 扩展接口 */
export interface HookExtension {
  /** 要监听的事件及处理函数 */
  hooks: Partial<Record<HookEvent, HookHandler>>
  /** 可选：初始化 */
  onLoad?(): Promise<void>
  /** 可选：清理 */
  dispose?(): Promise<void>
}

// ─────────────────────────────────────────────
// Service 扩展
// ─────────────────────────────────────────────

/** Service 扩展接口 */
export interface ServiceExtension {
  /** 清单信息 */
  manifest: ExtensionManifest
  /** 接收 JSON-RPC 请求 */
  handleRequest(method: string, params: unknown): Promise<unknown>
  /** 启动时初始化 */
  onStart?(): Promise<void>
  /** 关闭时清理 */
  onStop?(): Promise<void>
}

// ─────────────────────────────────────────────
// 入站消息 (Service → Core)
// ─────────────────────────────────────────────

/** 统一入站消息格式 (平台无关) */
export interface InboundMessage {
  /** 消息来源平台 */
  platform: string
  /** 会话标识 (平台侧 ID) */
  channelId: string
  /** 会话类型 */
  channelType: 'private' | 'group'
  /** 发送者 ID */
  senderId: string
  /** 发送者显示名 */
  senderName: string
  /** 纯文本内容 */
  content: string
  /** 附件 */
  attachments?: Array<{ type: string; url: string; name?: string }>
  /** 引用消息 ID */
  replyTo?: string
  /** 关联 Agent ID */
  agentId: string
}

/** 平台事件 (好友请求/群变动等) */
export interface InboundEvent {
  platform: string
  eventType: string
  data: Record<string, unknown>
  agentId: string
}

/** 扩展信息 (listExtensions 返回) */
export interface ExtensionInfo {
  id: string
  name: string
  type: ExtensionType
  version: string
  status: 'loaded' | 'error' | 'disabled'
}
