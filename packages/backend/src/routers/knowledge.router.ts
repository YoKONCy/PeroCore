import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../container'
import { validate as zValidator } from '../lib/validation'

const archiveQuerySchema = z.object({
  query: z.string().trim().max(200).default(''),
})

export function createKnowledgeRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/facts', zValidator('query', archiveQuerySchema), async (c) => {
    const { query } = c.req.valid('query')
    const data = await ctx.factsRepo.archive(query)
    return c.json({ code: 'OK', message: '获取成功', data })
  })

  return router
}
