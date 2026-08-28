/**
 * arcaCollaboration.router — HTTP 路由适配层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

const createSchema = z.object({
  documentId: z.string().min(1),
  instruction: z.string().trim().min(1).max(4000),
  scope: z.enum(['selection', 'section', 'document']),
  nodeId: z.string().min(1).optional(),
  agentId: z.string().min(1).max(64),
  requirements: z.string().max(2000).optional(),
})

/** Arca协作任务控制面，只负责Kernel编排，不进入Document Authority。 */
export function createArcaCollaborationRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/status', (c) =>
    c.json({
      code: 'OK',
      data: {
        available: ctx.arcaCollaboration.available(),
        agents: ctx.agentManager
          .listAgents()
          .filter((agent) => agent.isEnabled)
          .map(({ id, name }) => ({ id, name })),
      },
    }),
  )

  router.post('/', zValidator('json', createSchema), async (c) => {
    const body = c.req.valid('json')
    if (!ctx.agentManager.getAgent(body.agentId)) {
      throw new AppError('AGENT_NOT_FOUND', { message: `Agent不存在: ${body.agentId}` })
    }
    try {
      const task = await ctx.arcaCollaboration.create(body)
      return c.json({ code: 'CREATED', message: '协作任务已创建', data: task }, 201)
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  router.get('/', async (c) => {
    const documentId = c.req.query('documentId')
    if (!documentId) throw new AppError('INVALID_PARAMETER', { message: '缺少documentId' })
    return c.json({ code: 'OK', data: await ctx.arcaCollaboration.list(documentId) })
  })

  router.get('/:taskId', async (c) => {
    const task = await ctx.arcaCollaboration.get(c.req.param('taskId'))
    if (!task) throw new AppError('NOT_FOUND', { message: 'Arca协作任务不存在' })
    return c.json({ code: 'OK', data: task })
  })

  router.post('/:taskId/cancel', async (c) => {
    try {
      return c.json({ code: 'OK', data: await ctx.arcaCollaboration.cancel(c.req.param('taskId')) })
    } catch (error) {
      throw new AppError('CONFLICT', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return router
}
