import { Hono } from 'hono'
import type { AppContext } from '../container'

/** Agent求助请求查询接口；回答统一通过Internal Surface入口提交。 */
export function createAgentInputRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/', (c) => {
    const status = c.req.query('status') as
      | 'pending'
      | 'answered'
      | 'skipped'
      | 'cancelled'
      | 'interrupted'
      | undefined
    const requests = ctx.agentInputService.list({
      status,
      agentId: c.req.query('agentId'),
      sessionId: c.req.query('sessionId'),
      threadId: c.req.query('threadId'),
    })
    return c.json({ code: 'OK', data: { requests, total: requests.length } })
  })

  return router
}
