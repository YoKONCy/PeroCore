/**
 * 统一 API 客户端
 *
 * 所有 HTTP 请求必须通过 ApiClient 发出，禁止直接调用 fetch。
 * 基于 Transport 层，自动处理信封解包和错误转化。
 *
 */

import { transport } from './transport'
import { ApiError } from './errors'
import type { ApiResponse } from '@infos/shared'

/** 成功码集合 (对齐 S02_API_SPEC §5.1) */
const SUCCESS_CODES = new Set(['OK', 'CREATED', 'ACCEPTED', 'NOT_CONFIGURED'])

function isSuccessCode(code: string): boolean {
  return SUCCESS_CODES.has(code)
}

class ApiClient {
  /** 通用请求 */
  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const res = await transport.request<T>(endpoint, options)

    if (!isSuccessCode(res.code)) {
      throw new ApiError(res.code, res.message, (res as any).data)
    }

    return res
  }

  /** GET */
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint)
  }

  /** POST */
  async post<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      // multipart 请求必须保留 FormData 本体，Transport 会据此省略 JSON Content-Type。
      body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
    })
  }

  /** PUT */
  async put<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  /** DELETE */
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }

  /** PATCH (P2-7: 消息编辑) */
  async patch<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }
}

/** 全局单例 */
export const apiClient = new ApiClient()
