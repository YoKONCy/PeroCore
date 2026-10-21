import { t as __t } from '../lib/i18n'
import { Hono } from 'hono'
import { z } from 'zod'
import { bodyLimit } from 'hono/body-limit'
import { validate } from '../lib/validation'
import type { ClientAccessService } from '../services/system/clientAccessService'

/** 配对入口先于业务鉴权，管理操作仍严格要求安装实例管理员身份。 */
export function createClientAccessRouter(access: ClientAccessService) {
  const router = new Hono()
  router.use(
    '*',
    bodyLimit({
      maxSize: 4096,
      onError: (c) =>
        c.json({ code: 'BAD_REQUEST', message: __t('server.routers', '配对请求过大') }, 400),
    }),
  )
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    // 配对与登录同样约束浏览器来源，防止跨站替换浏览器的设备身份。
    const origin = c.req.header('origin')
    if (origin && !c.req.header('authorization')) {
      try {
        if (new URL(origin).host !== new URL(c.req.url).host)
          return c.json(
            { code: 'FORBIDDEN', message: __t('server.routers', '请通过同一服务器入口进行配对') },
            403,
          )
      } catch {
        return c.json({ code: 'FORBIDDEN', message: __t('server.routers', '请求来源无效') }, 403)
      }
    }
    await next()
  })
  router.get('/status', (c) => {
    const identity = access.authenticate(c.req.raw)
    return c.json({
      code: 'OK',
      data: { authenticated: !!identity, admin: identity?.admin ?? false, deviceId: identity?.id },
    })
  })
  const input = z.object({
    code: z.string().max(512),
    name: z.string().max(80).default('浏览器'),
    remember: z.boolean().default(true),
    credentialMode: z.enum(['cookie', 'bearer']).default('cookie'),
  })
  for (const mode of ['pair', 'login'] as const)
    router.post(`/${mode}`, validate('json', input), (c) => {
      try {
        const value = c.req.valid('json')
        // 请求频率按服务器看到的连接来源约束，不信任客户端伪造的转发头。
        const peer =
          (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
            ?.socket?.remoteAddress || 'web'
        const result =
          mode === 'pair'
            ? access.pair(value.code, value.name, value.remember, peer)
            : access.login(value.code, value.name, value.remember, peer)
        const secure =
          c.req.url.startsWith('https:') ||
          c.req.header('x-forwarded-proto') === 'https' ||
          c.req.header('origin')?.startsWith('https://') === true
        c.header(
          'Set-Cookie',
          access.cookie(result.token, result.expiresAt, secure, value.remember),
        )
        return c.json({
          code: 'OK',
          data: {
            deviceId: result.deviceId,
            expiresAt: result.expiresAt,
            ...(value.credentialMode === 'bearer' ? { token: result.token } : {}),
          },
        })
      } catch (error) {
        return c.json({ code: 'UNAUTHORIZED', message: (error as Error).message }, 401)
      }
    })
  router.post('/logout', (c) => {
    const identity = access.authenticate(c.req.raw)
    if (identity && identity.id !== 'local') access.revoke(identity.id)
    c.header('Set-Cookie', access.cookie('', 0, false))
    return c.json({ code: 'OK' })
  })
  router.use('*', async (c, next) => {
    if (!access.authenticate(c.req.raw)?.admin)
      return c.json(
        {
          code: 'FORBIDDEN',
          message: __t('server.routers', '请在电脑端或使用管理凭据管理局域网访问'),
        },
        403,
      )
    await next()
  })
  router.get('/', (c) => c.json({ code: 'OK', data: access.status() }))
  router.post('/pairings', (c) => c.json({ code: 'OK', data: access.createPairing() }))
  router.put(
    '/settings',
    validate('json', z.object({ enabled: z.boolean(), port: z.number().int() })),
    async (c) => {
      try {
        const input = c.req.valid('json')
        await access.configure(input.enabled, input.port)
        return c.json({ code: 'OK', data: access.status() })
      } catch (error) {
        return c.json({ code: 'BAD_REQUEST', message: (error as Error).message }, 400)
      }
    },
  )
  router.delete('/devices/:id', (c) => {
    access.revoke(c.req.param('id'))
    return c.json({ code: 'OK' })
  })
  return router
}
