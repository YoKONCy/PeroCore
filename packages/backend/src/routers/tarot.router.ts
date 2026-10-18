import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../container'
import { validate } from '../lib/validation'
import { TarotService } from '../services/agent/tarotService'

const agentId = z.string().trim().min(1).max(128)
const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, '时区无效')

export function createTarotRouter(ctx: AppContext) {
  const router = new Hono()
  const service = new TarotService(ctx)
  router.get('/today', validate('query', z.object({ agentId, timeZone })), (c) => {
    const input = c.req.valid('query')
    return c.json({ code: 'OK', data: service.today(input.agentId, input.timeZone) })
  })
  router.get('/history', validate('query', z.object({ agentId })), (c) =>
    c.json({ code: 'OK', data: service.history(c.req.valid('query').agentId) }),
  )
  router.post(
    '/draw',
    validate(
      'json',
      z.object({
        agentId,
        timeZone,
        question: z.string().trim().max(500).default(''),
        threadId: z.string().trim().min(1).max(512).optional(),
      }),
    ),
    async (c) => {
      const input = c.req.valid('json')
      return c.json({
        code: 'OK',
        data: await service.draw(input.agentId, input.timeZone, input.question, input.threadId),
      })
    },
  )
  router.post('/:id/interpret', validate('param', z.object({ id: z.string().uuid() })), async (c) =>
    c.json({ code: 'OK', data: await service.interpret(c.req.valid('param').id) }),
  )
  return router
}
