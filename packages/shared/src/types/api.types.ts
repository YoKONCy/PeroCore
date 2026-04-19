/**
 * @file API 响应类型定义
 * @description 遵循 02_API_RESPONSE_SPEC.md 统一信封规范
 * @module @perocore/shared/types/api
 */

// ─────────────────────────────────────────────
// 统一响应信封
// ─────────────────────────────────────────────

/** API 统一响应格式 */
export interface ApiResponse<T = unknown> {
  /** 业务状态码 (UPPER_SNAKE_CASE) */
  code: string
  /** 面向用户的中文消息 */
  message: string
  /** 响应数据 (仅成功时存在) */
  data?: T
}

/** 分页响应数据 */
export interface PaginatedData<T> {
  /** 当前页数据列表 */
  items: T[]
  /** 总记录数 */
  total: number
  /** 当前页码 (1-indexed) */
  page: number
  /** 每页大小 */
  pageSize: number
  /** 是否还有更多 */
  hasMore: boolean
}

/** 分页请求参数 */
export interface PaginationParams {
  /** 页码 (默认: 1) */
  page?: number
  /** 每页大小 (默认: 20, 最大: 100) */
  pageSize?: number
}

// ─────────────────────────────────────────────
// SSE 流式事件类型 (02_API_RESPONSE_SPEC §9)
// ─────────────────────────────────────────────

/** SSE 事件类型标识 */
export type SseEventType =
  | 'delta'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'done'
  | 'error'

/** 文本增量事件 */
export interface SseDeltaEvent {
  content: string
}

/** 工具调用请求事件 */
export interface SseToolCallEvent {
  /** 本次调用的唯一 ID */
  callId: string
  /** 工具名称 */
  name: string
  /** 工具参数 (JSON) */
  args: Record<string, unknown>
}

/** 工具调用结果事件 */
export interface SseToolResultEvent {
  /** 对应的调用 ID */
  callId: string
  /** 工具名称 */
  name: string
  /** 执行结果 */
  result: unknown
  /** 是否成功 */
  success: boolean
  /** 错误信息 (失败时) */
  error?: string
}

/** 状态更新事件 (思考中、工具执行中等) */
export interface SseStatusEvent {
  /** 状态标识 */
  state: 'thinking' | 'tool_executing' | 'generating'
  /** 面向用户的状态消息 */
  message: string
  /** 当前轮次 (ReAct 循环计数) */
  turn: number
}

/** 流结束事件 */
export interface SseDoneEvent {
  /** Token 用量 */
  usage: {
    promptTokens: number
    completionTokens: number
  }
}

/** 流错误事件 */
export interface SseErrorEvent {
  /** 业务错误码 */
  code: string
  /** 错误消息 */
  message: string
}

/** SSE 事件联合类型 (按 event 字段区分) */
export type SseEvent =
  | { event: 'delta'; data: SseDeltaEvent }
  | { event: 'tool_call'; data: SseToolCallEvent }
  | { event: 'tool_result'; data: SseToolResultEvent }
  | { event: 'status'; data: SseStatusEvent }
  | { event: 'done'; data: SseDoneEvent }
  | { event: 'error'; data: SseErrorEvent }
