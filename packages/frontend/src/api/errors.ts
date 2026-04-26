/**
 * API 错误类型定义
 *
 */

/** 业务级 API 错误 (后端返回了有效的错误信封) */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 网络级错误 (请求根本没到后端) */
export class NetworkError extends Error {
  constructor(
    public status: number,
    statusText: string,
  ) {
    super(`网络错误: ${status} ${statusText}`)
    this.name = 'NetworkError'
  }
}

/** 错误严重性等级 */
export enum ErrorSeverity {
  /** 仅记日志 */
  SILENT = 'silent',
  /** Toast 通知 (非阻断) */
  TOAST = 'toast',
  /** 模态对话框 (阻断) */
  MODAL = 'modal',
}

/** 错误码 → UI 严重性映射 */
export const ERROR_UI_MAP: Record<string, ErrorSeverity> = {
  // ── 客户端错误 (4xx) ──
  VALIDATION_ERROR: ErrorSeverity.TOAST,
  MISSING_FIELD: ErrorSeverity.TOAST,
  INVALID_FORMAT: ErrorSeverity.TOAST,
  OUT_OF_RANGE: ErrorSeverity.TOAST,
  INVALID_PARAMETER: ErrorSeverity.TOAST,
  UNAUTHORIZED: ErrorSeverity.MODAL,
  TOKEN_EXPIRED: ErrorSeverity.MODAL,
  NOT_FOUND: ErrorSeverity.TOAST,
  AGENT_NOT_FOUND: ErrorSeverity.TOAST,
  MODEL_NOT_FOUND: ErrorSeverity.TOAST,
  MEMORY_NOT_FOUND: ErrorSeverity.TOAST,
  RATE_LIMITED: ErrorSeverity.TOAST,
  RESOURCE_BUSY: ErrorSeverity.TOAST,

  // ── 服务端错误 (5xx) ──
  INTERNAL_ERROR: ErrorSeverity.TOAST,
  DB_ERROR: ErrorSeverity.MODAL,
  CONFIG_ERROR: ErrorSeverity.TOAST,
  LLM_ERROR: ErrorSeverity.TOAST,
  LLM_RATE_LIMITED: ErrorSeverity.TOAST,
  LLM_TIMEOUT: ErrorSeverity.TOAST,
  EMBEDDING_ERROR: ErrorSeverity.TOAST,
  EXTERNAL_ERROR: ErrorSeverity.TOAST,
  MCP_ERROR: ErrorSeverity.TOAST,
  SERVICE_UNAVAILABLE: ErrorSeverity.TOAST,
  SERVICE_INITIALIZING: ErrorSeverity.TOAST,
  GATEWAY_TIMEOUT: ErrorSeverity.TOAST,

  // ── 前端客户端专用 code (不来自后端，由 Transport/SSE 层生成) ──
  NETWORK_ERROR: ErrorSeverity.TOAST,
  STREAM_ERROR: ErrorSeverity.TOAST,
}

/** 错误码 → 用户友好标题映射 (用于 Toast 标题显示) */
export const ERROR_TITLE_MAP: Record<string, string> = {
  LLM_ERROR: 'AI 服务异常',
  LLM_RATE_LIMITED: 'AI 服务繁忙',
  LLM_TIMEOUT: 'AI 响应超时',
  EMBEDDING_ERROR: '向量服务异常',
  MCP_ERROR: '工具调用失败',
  MODEL_NOT_FOUND: '模型未配置',
  AGENT_NOT_FOUND: 'Agent 未找到',
  CONFIG_ERROR: '配置异常',
  DB_ERROR: '数据库错误',
  NETWORK_ERROR: '网络连接失败',
  STREAM_ERROR: '流式传输中断',
  RATE_LIMITED: '请求频率过高',
  GATEWAY_TIMEOUT: '服务响应超时',
  SERVICE_UNAVAILABLE: '服务不可用',
  SERVICE_INITIALIZING: '服务启动中',
  UNAUTHORIZED: '认证失败',
  INTERNAL_ERROR: '内部错误',
}
