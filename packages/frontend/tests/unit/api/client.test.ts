import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock('@perocore/frontend/api/transport', () => ({
  transport: {
    request: requestMock,
  },
}))

import { apiClient } from '@perocore/frontend/api/client'
import type { ApiError } from '@perocore/frontend/api/errors'

describe('apiClient', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  describe('request', () => {
    it('应当在成功码时原样返回响应信封', async () => {
      // 使用最小成功响应，验证不会额外改写数据。
      requestMock.mockResolvedValue({
        code: 'OK',
        message: '成功',
        data: { id: 1, name: 'Pero' },
      })

      const result = await apiClient.request<{ id: number; name: string }>('/agents')

      expect(requestMock).toHaveBeenCalledWith('/agents', undefined)
      expect(result).toEqual({
        code: 'OK',
        message: '成功',
        data: { id: 1, name: 'Pero' },
      })
    })

    it('应当在业务失败码时抛出 ApiError', async () => {
      // 这里验证 client 会把错误信封转成统一异常对象。
      requestMock.mockResolvedValue({
        code: 'VALIDATION_ERROR',
        message: '参数不合法',
        data: { field: 'agentId' },
      })

      await expect(apiClient.request('/agents')).rejects.toMatchObject({
        name: 'ApiError',
        code: 'VALIDATION_ERROR',
        message: '参数不合法',
        data: { field: 'agentId' },
      } satisfies Partial<ApiError>)
    })

    it('应当将 CREATED 视为成功码', async () => {
      requestMock.mockResolvedValue({
        code: 'CREATED',
        message: '已创建',
        data: { id: 2 },
      })

      const result = await apiClient.request<{ id: number }>('/memories', {
        method: 'POST',
      })

      expect(result.data).toEqual({ id: 2 })
    })
  })

  describe('便捷方法', () => {
    it('get 应当透传 endpoint', async () => {
      requestMock.mockResolvedValue({ code: 'OK', message: '成功' })

      await apiClient.get('/system')

      expect(requestMock).toHaveBeenCalledWith('/system', undefined)
    })

    it('post 应当序列化 body 并设置 POST 方法', async () => {
      requestMock.mockResolvedValue({ code: 'OK', message: '成功' })

      await apiClient.post('/memories', { content: '测试内容' })

      expect(requestMock).toHaveBeenCalledWith('/memories', {
        method: 'POST',
        body: JSON.stringify({ content: '测试内容' }),
      })
    })

    it('put 应当序列化 body 并设置 PUT 方法', async () => {
      requestMock.mockResolvedValue({ code: 'OK', message: '成功' })

      await apiClient.put('/configs/theme', { value: 'dark' })

      expect(requestMock).toHaveBeenCalledWith('/configs/theme', {
        method: 'PUT',
        body: JSON.stringify({ value: 'dark' }),
      })
    })

    it('delete 应当设置 DELETE 方法', async () => {
      requestMock.mockResolvedValue({ code: 'OK', message: '成功' })

      await apiClient.delete('/memories/1')

      expect(requestMock).toHaveBeenCalledWith('/memories/1', {
        method: 'DELETE',
      })
    })
  })
})
