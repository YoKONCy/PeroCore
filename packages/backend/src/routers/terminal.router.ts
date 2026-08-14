import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { getProductivityRuntime, resolveExecutionSession } from '../tools/productivityRuntimeHolder'

const sessionQuery = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
})

const createSchema = sessionQuery.extend({
  /** 留空时创建当前平台的交互式系统 Shell。 */
  command: z.string().optional(),
  cwd: z.string().optional(),
  title: z.string().optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
  taskId: z.string().optional(),
})

const writeSchema = z.object({ data: z.string() })
const resizeSchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
})

/** 多终端 HTTP API：前端轮询读取（cursor 增量），输入/控制走 POST。 */
export function createTerminalRouter(_ctx: AppContext) {
  const router = new Hono()

  router.get('/', zValidator('query', sessionQuery), async (c) => {
    const session = await prepare(c.req.valid('query').agentId, c.req.valid('query').threadId)
    return c.json({ code: 'OK', data: { terminals: terminals().list(session.id) } })
  })

  router.post('/', zValidator('json', createSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await prepare(input.agentId, input.threadId, input.taskId)
    try {
      const terminal = await terminals().create({
        executionSessionId: session.id,
        command: input.command,
        cwd: input.cwd,
        title: input.title,
        cols: input.cols,
        rows: input.rows,
      })
      return c.json({ code: 'OK', data: terminal })
    } catch (error) {
      throw validation(error)
    }
  })

  /** 增量读取：GET /:id/read?agentId=&threadId=&cursor=&limit= */
  router.get(
    '/:id/read',
    zValidator(
      'query',
      sessionQuery.extend({
        cursor: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(32_000).optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid('query')
      const session = await prepare(query.agentId, query.threadId)
      try {
        const result = terminals().read(
          c.req.param('id'),
          session.id,
          query.cursor ?? 0,
          query.limit ?? 16_000,
        )
        return c.json({ code: 'OK', data: result })
      } catch (error) {
        throw validation(error)
      }
    },
  )

  router.post(
    '/:id/write',
    zValidator('json', writeSchema.extend(sessionQuery.shape)),
    async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(input.agentId, input.threadId)
      try {
        terminals().write(c.req.param('id'), session.id, input.data)
        return c.json({ code: 'OK', data: { written: true } })
      } catch (error) {
        throw validation(error)
      }
    },
  )

  router.post(
    '/:id/resize',
    zValidator('json', resizeSchema.extend(sessionQuery.shape)),
    async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(input.agentId, input.threadId)
      try {
        terminals().resize(c.req.param('id'), session.id, input.cols, input.rows)
        return c.json({ code: 'OK', data: { resized: true } })
      } catch (error) {
        throw validation(error)
      }
    },
  )

  for (const action of ['interrupt', 'kill', 'close'] as const) {
    router.post(`/:id/${action}`, zValidator('json', sessionQuery), async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(input.agentId, input.threadId)
      try {
        await terminals()[action](c.req.param('id'), session.id)
        return c.json({ code: 'OK', data: { [action]: true } })
      } catch (error) {
        throw validation(error)
      }
    })
  }

  return router
}

function terminals() {
  return getProductivityRuntime().terminals
}

async function prepare(agentId: string, threadId: string, taskId?: string) {
  return resolveExecutionSession({ agentId, threadId, channel: 'desktop', taskId })
}

function validation(error: unknown): AppError {
  return new AppError('VALIDATION_ERROR', {
    message: String(error instanceof Error ? error.message : error),
  })
}
