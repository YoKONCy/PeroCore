import { describe, expect, it } from 'vitest'
import { ApiError, ErrorSeverity, ERROR_UI_MAP, NetworkError } from './errors'

describe('ApiError', () => {
  it('应当保留错误码、消息和附加数据', () => {
    const error = new ApiError('VALIDATION_ERROR', '参数错误', { field: 'name' })

    expect(error.name).toBe('ApiError')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('参数错误')
    expect(error.data).toEqual({ field: 'name' })
  })
})

describe('NetworkError', () => {
  it('应当生成包含状态码和状态文本的中文消息', () => {
    const error = new NetworkError(503, 'Service Unavailable')

    expect(error.name).toBe('NetworkError')
    expect(error.status).toBe(503)
    expect(error.message).toBe('网络错误: 503 Service Unavailable')
  })
})

describe('ERROR_UI_MAP', () => {
  it('应当将鉴权和数据库错误映射为模态提示', () => {
    expect(ERROR_UI_MAP.UNAUTHORIZED).toBe(ErrorSeverity.MODAL)
    expect(ERROR_UI_MAP.DB_ERROR).toBe(ErrorSeverity.MODAL)
  })

  it('应当将常见业务错误映射为非阻断提示', () => {
    expect(ERROR_UI_MAP.VALIDATION_ERROR).toBe(ErrorSeverity.TOAST)
    expect(ERROR_UI_MAP.LLM_ERROR).toBe(ErrorSeverity.TOAST)
    expect(ERROR_UI_MAP.NETWORK_ERROR).toBe(ErrorSeverity.TOAST)
  })
})
