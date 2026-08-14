/**
 * 应用级错误类
 *
 * 携带业务 code 和 HTTP 状态码，
 * 配合 errorHandler 中间件自动格式化响应。
 *
 * @module packages/backend/src/lib/appError
 */

import { CODE_MESSAGES, CODE_TO_HTTP, type ResponseCode } from '@infos/shared'

/** 自定义应用错误，携带业务 code 和 HTTP 状态码 */
export class AppError extends Error {
  public readonly httpStatus: number
  public readonly code: ResponseCode
  public readonly data?: unknown

  constructor(code: ResponseCode, options?: { message?: string; data?: unknown }) {
    const message = options?.message ?? CODE_MESSAGES[code] ?? '未知错误'
    super(message)
    this.name = 'AppError'
    this.code = code
    this.data = options?.data
    this.httpStatus = CODE_TO_HTTP[code] ?? 500
  }
}
