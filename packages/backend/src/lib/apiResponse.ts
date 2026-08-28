/**
 * apiResponse — 通用基础设施
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { CODE_MESSAGES, type ApiResponse, type ResponseCode } from '@infos/shared'

export function apiResponse<T>(
  c: Context,
  code: ResponseCode,
  data?: T,
  options?: { message?: string; status?: ContentfulStatusCode },
): Response {
  const body: ApiResponse<T> = {
    code,
    message: options?.message ?? CODE_MESSAGES[code],
    ...(data === undefined ? {} : { data }),
  }
  return c.json(body, options?.status)
}

export function ok<T>(c: Context, data?: T, message?: string): Response {
  return apiResponse(c, 'OK', data, { message })
}

export function created<T>(c: Context, data: T, message?: string): Response {
  return apiResponse(c, 'CREATED', data, { message, status: 201 })
}

export function accepted<T>(c: Context, data?: T, message?: string): Response {
  return apiResponse(c, 'ACCEPTED', data, { message, status: 202 })
}
