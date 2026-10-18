import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '@infos/frontend/api/errors'

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
    expect(error.message).toContain('503')
    expect(error.message).toContain('Service Unavailable')
  })
})
