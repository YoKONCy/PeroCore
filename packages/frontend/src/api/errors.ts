/**
 * API 错误类型定义
 *
 * @see 05_FRONTEND_ARCHITECTURE.md §3
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
  VALIDATION_ERROR: ErrorSeverity.TOAST,
  LLM_ERROR: ErrorSeverity.TOAST,
  RATE_LIMITED: ErrorSeverity.TOAST,
  UNAUTHORIZED: ErrorSeverity.MODAL,
  DB_ERROR: ErrorSeverity.MODAL,
  INTERNAL_ERROR: ErrorSeverity.TOAST,
  NETWORK_ERROR: ErrorSeverity.TOAST,
  MODEL_NOT_FOUND: ErrorSeverity.TOAST,
  AGENT_NOT_FOUND: ErrorSeverity.TOAST,
}
