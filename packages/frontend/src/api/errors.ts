import { t as __t } from '../i18n/index'
import { translateDiagnostic } from '@infos/shared/i18n'
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
    super(translateDiagnostic(message))
    this.name = 'ApiError'
  }
}

/** 网络级错误 (请求根本没到后端) */
export class NetworkError extends Error {
  constructor(
    public status: number,
    statusText: string,
  ) {
    super(translateDiagnostic(`网络错误: ${status} ${statusText}`))
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
  get LLM_ERROR() {
    return __t('ui.errors', 'AI 服务异常')
  },
  get LLM_RATE_LIMITED() {
    return __t('ui.errors', 'AI 服务繁忙')
  },
  get LLM_TIMEOUT() {
    return __t('ui.errors', 'AI 响应超时')
  },
  get EMBEDDING_ERROR() {
    return __t('ui.errors', '向量服务异常')
  },
  get MCP_ERROR() {
    return __t('ui.errors', '工具调用失败')
  },
  get MODEL_NOT_FOUND() {
    return __t('ui.errors', '模型未配置')
  },
  get AGENT_NOT_FOUND() {
    return __t('ui.errors', 'Agent 未找到')
  },
  get CONFIG_ERROR() {
    return __t('ui.errors', '配置异常')
  },
  get DB_ERROR() {
    return __t('ui.errors', '数据库错误')
  },
  get NETWORK_ERROR() {
    return __t('ui.errors', '网络连接失败')
  },
  get STREAM_ERROR() {
    return __t('ui.errors', '流式传输中断')
  },
  get RATE_LIMITED() {
    return __t('ui.errors', '请求频率过高')
  },
  get GATEWAY_TIMEOUT() {
    return __t('ui.errors', '服务响应超时')
  },
  get SERVICE_UNAVAILABLE() {
    return __t('ui.errors', '服务不可用')
  },
  get SERVICE_INITIALIZING() {
    return __t('ui.errors', '服务启动中')
  },
  get UNAUTHORIZED() {
    return __t('ui.errors', '认证失败')
  },
  get INTERNAL_ERROR() {
    return __t('ui.errors', '内部错误')
  },
}
