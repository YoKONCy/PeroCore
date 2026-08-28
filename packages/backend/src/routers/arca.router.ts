import { Hono } from 'hono'
import { projectArcaStatusSurface } from '../projections/arcaStatusProjection'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Arca官方应用Adapter控制面。 */
export function createArcaRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/status', (c) => c.json({ code: 'OK', data: ctx.arcaApplication.status() }))
  router.get('/projection', (c) =>
    c.json({ code: 'OK', data: projectArcaStatusSurface(ctx.arcaApplication.status()) }),
  )

  router.post('/start', async (c) => {
    try {
      return c.json({ code: 'OK', data: await ctx.arcaApplication.start() })
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: errorCode(error) })
    }
  })

  router.post('/stop', async (c) => {
    try {
      return c.json({ code: 'OK', data: await ctx.arcaApplication.stop() })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', { message: errorCode(error) })
    }
  })

  router.post('/shutdown-managed', async (c) => {
    try {
      return c.json({ code: 'OK', data: await ctx.arcaApplication.shutdownManaged() })
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: errorCode(error) })
    }
  })

  router.post('/reconnect', async (c) => {
    try {
      return c.json({ code: 'OK', data: await ctx.arcaApplication.reconnect() })
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: errorCode(error) })
    }
  })

  return router
}
