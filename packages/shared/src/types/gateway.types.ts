/**
 * Gateway WebSocket 协议类型 (共享包)
 *
 * 前后端共用的 WS 消息信封和 payload schema。
 * 消除后端 gateway/types.ts 和前端 useGateway.ts 中
 * 对 Record<string, unknown> 的松散依赖。
 *
 * @module packages/shared/src/types/gateway.types
 */

// ─────────────────────────────────────────────
// 信封 (Envelope)
// ─────────────────────────────────────────────

/** WS 消息类型 */
export type GatewayMessageType =
  // 握手
  | 'hello'
  | 'hello_ack'
  // 心跳
  | 'heartbeat'
  | 'heartbeat_ack'
  // 请求/响应
  | 'request'
  | 'response'
  // 推送 (广播)
  | 'push'
  // 错误
  | 'error'

/** WS 消息信封 (类 JSON-RPC) */
export interface GatewayEnvelope<T = GatewayPayload> {
  /** 消息 ID (UUID) */
  id: string
  /** 消息类型 */
  type: GatewayMessageType
  /** 发送方 ID */
  sourceId: string
  /** 目标 ID ("broadcast" = 广播) */
  targetId: string
  /** 时间戳 (ms) */
  timestamp: number
  /** 负载 */
  payload: T
}

// ─────────────────────────────────────────────
// Payload 联合类型
// ─────────────────────────────────────────────

/** 所有 Push 推送 Payload 的联合类型 */
export type GatewayPayload =
  | StateUpdatePayload
  | StreamDeltaPayload
  | StreamEndPayload
  | ToolStatusPayload
  | TaskProgressPayload
  | NotificationPayload
  | SystemErrorPayload
  | HelloPayload
  | HelloAckPayload
  | HeartbeatPayload
  | ChatRequestPayload
  | GenericPayload

// ─────────────────────────────────────────────
// 已定型的 Payload
// ─────────────────────────────────────────────

/** PetState 更新推送 */
export interface StateUpdatePayload {
  action: 'state_update'
  affection?: number
  energy?: number
  mood?: string
  currentAction?: string
}

/** 流式增量推送 */
export interface StreamDeltaPayload {
  action: 'stream_delta'
  content: string
  sessionId: string
}

/** 流式结束推送 */
export interface StreamEndPayload {
  action: 'stream_end'
  sessionId: string
}

/** 工具执行状态推送 */
export interface ToolStatusPayload {
  action: 'tool_status'
  name: string
  state: 'calling' | 'completed' | 'error'
  sessionId: string
  result?: string
  durationMs?: number
}

/** 任务进度推送 */
export interface TaskProgressPayload {
  action: 'task_progress'
  sessionId: string
  turn: number
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  message?: string
}

/** 通知推送 */
export interface NotificationPayload {
  action: 'notification'
  title: string
  body?: string
  level?: 'info' | 'success' | 'warning' | 'error'
  duration?: number
  source?: string
}

/** 系统错误推送 */
export interface SystemErrorPayload {
  action: 'system_error'
  message: string
  title?: string
}

/** Hello 握手请求 */
export interface HelloPayload {
  action?: undefined
  token?: string
  deviceName?: string
}

/** Hello 握手确认 */
export interface HelloAckPayload {
  action?: undefined
  nodeId: string
}

/** 心跳空 payload */
export interface HeartbeatPayload {
  action?: undefined
}

/** 聊天请求 payload */
export interface ChatRequestPayload {
  action: 'chat' | 'chat_stream' | 'stop_generation' | 'switch_agent' | 'inject_instruction'
  content?: string
  sessionId?: string
  agentId?: string
  [key: string]: unknown
}

/** 通用兜底 payload (向下兼容) */
export interface GenericPayload {
  action?: string
  [key: string]: unknown
}

// ─────────────────────────────────────────────
// Push Action 枚举 (用于 switch/case)
// ─────────────────────────────────────────────

/** Push 推送的 action 名 */
export type PushAction =
  | 'state_update'
  | 'stream_delta'
  | 'stream_end'
  | 'tool_status'
  | 'task_progress'
  | 'notification'
  | 'system_error'

/** Request 请求的 action 名 */
export type RequestAction =
  | 'chat'
  | 'chat_stream'
  | 'stop_generation'
  | 'switch_agent'
  | 'inject_instruction'
