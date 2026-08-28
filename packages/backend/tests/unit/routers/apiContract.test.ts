import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { apiContractMiddleware } from '@infos/backend/middleware/apiContract'
import { errorHandler } from '@infos/backend/middleware/errorHandler'
import { validate } from '@infos/backend/lib/validation'

describe('REST API契约基础设施', () => {
  it('Zod失败应返回统一VALIDATION_ERROR信封', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.post('/api/test', validate('json', z.object({ name: z.string().min(1) })), (c) =>
      c.json({ code: 'OK', message: '成功' }),
    )
    const response = await app.request('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '请求参数校验失败',
      data: { fields: { name: expect.any(String) } },
    })
  })

  it('应补齐默认message并阻止未注册业务码', async () => {
    const app = new Hono()
    app.use('*', apiContractMiddleware)
    app.get('/api/missing-message', (c) => c.json({ code: 'OK', data: 1 }))
    app.get('/api/unknown-code', (c) => c.json({ code: 'UNKNOWN_CODE', message: '错误' }))
    await expect((await app.request('/api/missing-message')).json()).resolves.toEqual({
      code: 'OK',
      data: 1,
      message: '操作成功',
    })
    const invalid = await app.request('/api/unknown-code')
    expect(invalid.status).toBe(500)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '服务内部错误，请稍后再试',
    })
  })
})
