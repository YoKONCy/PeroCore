import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware, DEFAULT_PUBLIC_PATHS } from '@perocore/backend/middleware/auth'

/**
 * 第六阶段 #8: Token 鉴权中间件测试
 *
 * 覆盖场景：
 * - 未配置 token 时放行所有请求（开发环境）
 * - 公共路径跳过鉴权
 * - 正确 Bearer token 通过
 * - 错误 token / 缺失 token 返回 401
 * - WebSocket 升级场景的 query token 通过
 */

function createApp(token: string, publicPaths: string[] = DEFAULT_PUBLIC_PATHS) {
  const app = new Hono()
  app.use('*', createAuthMiddleware({ token, publicPaths }))
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/health/logs', (c) => c.json({ ok: true }))
  app.get('/api/agents', (c) => c.json({ agents: [] }))
  app.get('/metrics', (c) => c.json({ metrics: 'ok' }))
  app.get('/api/auth/login', (c) => c.json({ token: 'new-token' }))
  return app
}

describe('createAuthMiddleware', () => {
  it('未配置 token 时应放行所有请求', async () => {
    const app = createApp('')
    const res = await app.request('/api/agents')
    expect(res.status).toBe(200)
  })

  it('公共路径应跳过鉴权', async () => {
    const app = createApp('secret-token')
    const health = await app.request('/api/health')
    const metrics = await app.request('/metrics')
    const login = await app.request('/api/auth/login')
    expect(health.status).toBe(200)
    expect(metrics.status).toBe(200)
    expect(login.status).toBe(200)
  })

  it('公共路径前缀下的子路径也应跳过鉴权', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/health/logs')
    expect(res.status).toBe(200)
  })

  it('正确的 Bearer token 应通过鉴权', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents', {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(res.status).toBe(200)
  })

  it('错误的 Bearer token 应返回 401', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe('UNAUTHORIZED')
    expect(body.message).toContain('未授权')
  })

  it('缺失 Authorization 头应返回 401', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents')
    expect(res.status).toBe(401)
  })

  it('WebSocket 升级场景的 query token 应通过鉴权', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents?token=secret-token')
    expect(res.status).toBe(200)
  })

  it('错误的 query token 应返回 401', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents?token=wrong')
    expect(res.status).toBe(401)
  })

  it('自定义公共路径应生效', async () => {
    const app = createApp('secret-token', ['/api/public'])
    app.get('/api/public/info', (c) => c.json({ ok: true }))

    const publicRes = await app.request('/api/public/info')
    const protectedRes = await app.request('/api/health')

    expect(publicRes.status).toBe(200)
    // 自定义路径覆盖了默认列表，/api/health 不再是公共路径
    expect(protectedRes.status).toBe(401)
  })

  it('Bearer 前缀大小写不敏感', async () => {
    const app = createApp('secret-token')
    const res = await app.request('/api/agents', {
      headers: { Authorization: 'bearer secret-token' },
    })
    expect(res.status).toBe(200)
  })
})
