import { Hono } from 'hono'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

/** 只读计划投影；清单修改由带执行身份的工具完成。 */
export function createTaskPlanRouter(ctx: AppContext) {
  const router = new Hono()
  router.get('/:threadId', async (c) => {
    const thread = await ctx.threadService.getThread(c.req.param('threadId'))
    if (!thread || (c.req.query('agentId') && thread.agentId !== c.req.query('agentId')))
      throw new AppError('NOT_FOUND', { message: '会话不存在或不属于当前角色' })
    return c.json({ code: 'OK', data: ctx.taskPlanService.get(thread.id, thread.agentId) })
  })
  return router
}
