import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import type { AgentStateService } from './agentStateService'

export function createObserverRouter(service: AgentStateService) {
  const router = new Hono()
  router.get('/:agentId', async (c) =>
    c.json({ code: 'OK', data: await service.exportAgent(c.req.param('agentId')) }),
  )
  router.get('/:agentId/projection', async (c) =>
    c.json({
      code: 'OK',
      data: await service.project(c.req.param('agentId')),
    }),
  )
  router.put(
    '/:agentId/policy',
    zValidator(
      'json',
      z.object({ enabled: z.boolean(), injectContext: z.boolean().default(false) }),
    ),
    async (c) => {
      const agentId = c.req.param('agentId')
      return c.json({
        code: 'OK',
        data: await service.updatePolicy(agentId, c.req.valid('json')),
      })
    },
  )
  router.delete('/:agentId', async (c) =>
    c.json({
      code: 'OK',
      data: await service.deleteAgent(c.req.param('agentId')),
    }),
  )
  return router
}
