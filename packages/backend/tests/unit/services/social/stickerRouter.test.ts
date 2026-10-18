import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createSocialRouter } from '@infos/social/runtime/social.router'
import { StickerService } from '@infos/social/runtime/stickerService'
import { apiContractMiddleware } from '../../../../src/middleware/apiContract'

function application() {
  const provider = {
    list: vi.fn(async () => {
      throw new Error('NapCat 收藏接口暂不可用')
    }),
    collect: vi.fn(async () => ({ md5: '' })),
    describe: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
  const deps = {
    stickers: new StickerService(provider),
    getStickerAccounts: () => ['1001'],
  } as NonNullable<Parameters<typeof createSocialRouter>[1]>
  const bridge = {} as Parameters<typeof createSocialRouter>[0]
  const app = new Hono()
  app.use('/api/*', apiContractMiddleware)
  app.route('/api/social', createSocialRouter(bridge, deps))
  return { app, provider }
}

describe('收藏表情响应契约', () => {
  it('外部接口异常不会被契约守卫改写为未知业务码错误', async () => {
    const { app } = application()
    const response = await app.request('/api/social/stickers/1001')
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      code: 'EXTERNAL_ERROR',
      message: 'NapCat 收藏接口暂不可用',
    })
  })

  it('无效分页直接返回参数错误，不调用 NapCat', async () => {
    const { app, provider } = application()
    const response = await app.request('/api/social/stickers/1001?limit=-1')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_PARAMETER' })
    expect(provider.list).not.toHaveBeenCalled()
  })

  it('无效操作正文返回参数错误', async () => {
    const { app } = application()
    const response = await app.request('/api/social/stickers/1001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_PARAMETER' })
  })
})
