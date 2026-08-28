/**
 * @file API 响应类型定义
 * @description统一信封规范
 * @module @infos/shared/types/api
 */

// ─────────────────────────────────────────────
// 统一响应信封
// ─────────────────────────────────────────────

export type ThreadChannel = 'desktop' | 'group'

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
// SSE 流式事件类型
// ─────────────────────────────────────────────

/** Chat SSE 仅承载 Internal Surface 帧与执行终态。 */
export type SseEventType = 'surface' | 'done' | 'error'

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

/** SSE 事件联合类型。SurfaceFrame 由 Internal Surface Protocol 单独定义。 */
export type SseEvent =
  | { event: 'done'; data: SseDoneEvent }
  | { event: 'error'; data: SseErrorEvent }
