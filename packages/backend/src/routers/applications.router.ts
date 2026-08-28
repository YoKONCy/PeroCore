/**
 * applications.router — HTTP 路由适配层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { validate as zValidator } from '../lib/validation'

const resourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('persona'),
    agentId: z.string().min(1),
    allowAppPatch: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('memory'),
    agentId: z.string().min(1),
    memoryTypes: z.array(z.string()).optional(),
    memoryIds: z.array(z.string()).optional(),
    maxResults: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('workspace'),
    path: z.string().min(1),
    access: z.enum(['read', 'readwrite']),
    recursive: z.boolean(),
  }),
  z.object({ kind: z.literal('model'), modelConfigId: z.number().int().positive().optional() }),
  z.object({
    kind: z.literal('messages'),
    threadId: z.string().min(1),
    fromMessageId: z.number().int().optional(),
    toMessageId: z.number().int().optional(),
    lastN: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('task'),
    taskDescription: z.string().min(1),
    taskInputs: z.array(z.string()),
    successCriteria: z.string().min(1),
    deadline: z.string().optional(),
  }),
])

const grantSchema = z.object({
  instanceId: z.string().optional(),
  ownerAgentId: z.string().min(1),
  capabilityType: z.string().min(1),
  resource: resourceSchema,
  permissions: z.array(z.enum(['read', 'activate', 'derive', 'write'])).min(1),
  expiresAt: z.string().optional(),
})

const invokeSchema = z.object({
  instanceId: z.string().optional(),
  capabilityType: z.string().min(1),
  operation: z.string().min(1),
  value: z.unknown(),
  correlationId: z.string().min(1).optional(),
})

function translate(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.includes('NOT_FOUND')
    ? 'NOT_FOUND'
    : message.includes('OFFLINE')
      ? 'SERVICE_UNAVAILABLE'
      : message.includes('GRANT_REQUIRED')
        ? 'FORBIDDEN'
        : 'VALIDATION_ERROR'
  return new AppError(code, { message })
}

export function createApplicationsRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/', (c) => c.json({ code: 'OK', data: ctx.applicationIntegration.list() }))

  router.get('/:appId/manifest', (c) => {
    const manifest = ctx.applicationIntegration.get(c.req.param('appId'))
    if (!manifest) throw new AppError('NOT_FOUND', { message: 'Application Adapter不存在' })
    return c.json({ code: 'OK', data: manifest })
  })

  router.get('/:appId/grants', async (c) => {
    try {
      const data = await ctx.applicationIntegration.listGrants(
        c.req.param('appId'),
        c.req.query('instanceId'),
      )
      return c.json({ code: 'OK', data })
    } catch (error) {
      throw translate(error)
    }
  })

  router.post('/:appId/grants', zValidator('json', grantSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      const grantId = await ctx.applicationIntegration.grant({
        appId: c.req.param('appId'),
        ...body,
      })
      return c.json({ code: 'CREATED', data: { grantId } }, 201)
    } catch (error) {
      throw translate(error)
    }
  })

  router.delete('/:appId/grants/:grantId', async (c) => {
    try {
      const revoked = await ctx.applicationIntegration.revoke(
        c.req.param('appId'),
        c.req.param('grantId'),
        c.req.query('instanceId'),
      )
      return c.json({ code: 'OK', data: { revoked } })
    } catch (error) {
      throw translate(error)
    }
  })

  router.post('/:appId/capabilities/invoke', zValidator('json', invokeSchema), async (c) => {
    try {
      const body = c.req.valid('json')
      const output = await ctx.applicationIntegration.invoke({
        appId: c.req.param('appId'),
        instanceId: body.instanceId,
        capabilityType: body.capabilityType,
        operation: body.operation,
        value: body.value as unknown,
        context: { correlationId: body.correlationId ?? randomUUID() },
      })
      return c.json({ code: 'OK', data: output })
    } catch (error) {
      throw translate(error)
    }
  })

  return router
}
