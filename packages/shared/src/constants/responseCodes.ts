/**
 * API 业务状态码定义与默认消息注册表
 *
 * 完整定义 41 个业务 Code、中文默认消息和 HTTP 状态码映射。
 * 新增 code 必须先更新 .docs/S02_API_SPEC.md 并经过 review。
 *
 * @module packages/shared/src/constants/responseCodes
 */

// ─────────────────────────────────────────────
// 业务状态码枚举
// ─────────────────────────────────────────────

/** 成功类 (2xx) */
export const SUCCESS_CODES = {
  OK: 'OK',
  CREATED: 'CREATED',
  ACCEPTED: 'ACCEPTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const

/** 客户端错误类 (4xx) */
export const CLIENT_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  MEMORY_NOT_FOUND: 'MEMORY_NOT_FOUND',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  UNPROCESSABLE: 'UNPROCESSABLE',
  RESOURCE_BUSY: 'RESOURCE_BUSY',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

/** 服务端错误类 (5xx) */
export const SERVER_ERROR_CODES = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DB_ERROR: 'DB_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
  LLM_ERROR: 'LLM_ERROR',
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  EMBEDDING_ERROR: 'EMBEDDING_ERROR',
  EXTERNAL_ERROR: 'EXTERNAL_ERROR',
  MCP_ERROR: 'MCP_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SERVICE_INITIALIZING: 'SERVICE_INITIALIZING',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
} as const

/** 全部 41 个 Code 的联合类型 */
export type ResponseCode =
  | (typeof SUCCESS_CODES)[keyof typeof SUCCESS_CODES]
  | (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES]
  | (typeof SERVER_ERROR_CODES)[keyof typeof SERVER_ERROR_CODES]

// ─────────────────────────────────────────────
// 默认消息注册表
// ─────────────────────────────────────────────

/** 每个 Code 对应的默认中文消息（面向用户） */
export const CODE_MESSAGES: Record<ResponseCode, string> = {
  // 成功类 (2xx)
  OK: '操作成功',
  CREATED: '创建成功',
  ACCEPTED: '任务已提交，正在后台处理',
  NOT_CONFIGURED: '配置未设置',

  // 客户端错误 — 400
  BAD_REQUEST: '请求参数有误',
  VALIDATION_ERROR: '请求参数校验失败',
  MISSING_FIELD: '缺少必填字段',
  INVALID_FORMAT: '请求格式错误',
  OUT_OF_RANGE: '参数值超出允许范围',
  INVALID_PARAMETER: '参数类型或值无效',

  // 客户端错误 — 401
  UNAUTHORIZED: '未认证，请先登录',
  TOKEN_EXPIRED: '认证已过期，请重新登录',
  TOKEN_INVALID: '认证信息无效',

  // 客户端错误 — 403
  FORBIDDEN: '无权执行此操作',

  // 客户端错误 — 404
  NOT_FOUND: '请求的资源不存在',
  AGENT_NOT_FOUND: '指定的 Agent 不存在',
  MEMORY_NOT_FOUND: '指定的记忆不存在',
  MODEL_NOT_FOUND: '指定的模型配置不存在',

  // 客户端错误 — 405
  METHOD_NOT_ALLOWED: '不支持该请求方法',

  // 客户端错误 — 409
  CONFLICT: '资源冲突',
  DUPLICATE_NAME: '名称已存在',
  ALREADY_EXISTS: '资源已存在',

  // 客户端错误 — 413
  PAYLOAD_TOO_LARGE: '上传内容过大',

  // 客户端错误 — 415
  UNSUPPORTED_MEDIA_TYPE: '不支持该文件类型',

  // 客户端错误 — 422
  UNPROCESSABLE: '请求无法处理',
  RESOURCE_BUSY: '资源正忙，请稍后再试',
  TASK_ALREADY_RUNNING: '该任务已在运行中',
  PRECONDITION_FAILED: '前置条件不满足',

  // 客户端错误 — 429
  RATE_LIMITED: '请求过于频繁，请稍后再试',

  // 服务端错误 — 500
  INTERNAL_ERROR: '服务内部错误，请稍后再试',
  DB_ERROR: '数据库操作失败',
  CONFIG_ERROR: '配置异常',

  // 服务端错误 — 502
  LLM_ERROR: 'AI 服务异常，请稍后再试',
  LLM_RATE_LIMITED: 'AI 服务繁忙，请稍后再试',
  EMBEDDING_ERROR: '向量服务异常',
  EXTERNAL_ERROR: '外部服务异常',
  MCP_ERROR: 'MCP 服务调用失败',

  // 服务端错误 — 503
  SERVICE_UNAVAILABLE: '服务暂不可用',
  SERVICE_INITIALIZING: '服务正在启动中，请稍后再试',

  // 服务端错误 — 504
  GATEWAY_TIMEOUT: '上游服务响应超时',
  LLM_TIMEOUT: 'AI 服务响应超时',
} as const

// ─────────────────────────────────────────────
// Code → HTTP 状态码映射
// ─────────────────────────────────────────────

/** Code → HTTP Status 映射表 */
export const CODE_TO_HTTP: Record<ResponseCode, number> = {
  // 2xx
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NOT_CONFIGURED: 200,

  // 4xx
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  MISSING_FIELD: 400,
  INVALID_FORMAT: 400,
  OUT_OF_RANGE: 400,
  INVALID_PARAMETER: 400,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  AGENT_NOT_FOUND: 404,
  MEMORY_NOT_FOUND: 404,
  MODEL_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  DUPLICATE_NAME: 409,
  ALREADY_EXISTS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE: 422,
  RESOURCE_BUSY: 422,
  TASK_ALREADY_RUNNING: 422,
  PRECONDITION_FAILED: 422,
  RATE_LIMITED: 429,

  // 5xx
  INTERNAL_ERROR: 500,
  DB_ERROR: 500,
  CONFIG_ERROR: 500,
  LLM_ERROR: 502,
  LLM_RATE_LIMITED: 502,
  EMBEDDING_ERROR: 502,
  EXTERNAL_ERROR: 502,
  MCP_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  SERVICE_INITIALIZING: 503,
  GATEWAY_TIMEOUT: 504,
  LLM_TIMEOUT: 504,
} as const
