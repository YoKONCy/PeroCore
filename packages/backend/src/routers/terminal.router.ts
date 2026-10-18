/**
 * terminal.router — HTTP 路由适配层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import path from 'node:path'
import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import type { ProductivityRuntime } from '../tools/productivityRuntimeHolder'
import type { ThreadService } from '../services/thread/threadService'

const sessionQuery = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
})

const createSchema = sessionQuery.extend({
  /** 留空时创建当前平台的交互式系统 Shell。 */
  command: z.string().optional(),
  argv: z.array(z.string().refine((value) => !value.includes('\0'))).optional(),
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
export function createTerminalRouter(ctx: AppContext) {
  const router = new Hono()
  const runtime = ctx.productivityRuntime

  router.get('/', zValidator('query', sessionQuery), async (c) => {
    const session = await prepare(
      runtime,
      ctx.threadService,
      c.req.valid('query').agentId,
      c.req.valid('query').threadId,
    )
    return c.json({
      code: 'OK',
      data: {
        terminals: runtime.terminals.list(session.id),
        history: runtime.terminals.list(session.id, true).filter((terminal) => terminal.archivedAt),
      },
    })
  })

  router.post(
    '/cleanup',
    zValidator(
      'json',
      sessionQuery.extend({
        action: z.enum(['archive_completed', 'stop_agent', 'close_all']),
      }),
    ),
    async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(runtime, ctx.threadService, input.agentId, input.threadId)
      if (input.action === 'archive_completed') runtime.terminals.archiveCompleted(session.id)
      else if (input.action === 'stop_agent') await runtime.terminals.stopOwned(session.id)
      else
        await Promise.all(
          runtime.terminals
            .list(session.id)
            .map((terminal) => runtime.terminals.close(terminal.id, session.id)),
        )
      return c.json({ code: 'OK', data: { cleaned: true } })
    },
  )

  router.post(
    '/:id/pin',
    zValidator('json', sessionQuery.extend({ pinned: z.boolean() })),
    async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(runtime, ctx.threadService, input.agentId, input.threadId)
      try {
        return c.json({
          code: 'OK',
          data: runtime.terminals.pin(c.req.param('id'), session.id, input.pinned),
        })
      } catch (error) {
        throw validation(error)
      }
    },
  )

  router.post('/', zValidator('json', createSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await prepare(
      runtime,
      ctx.threadService,
      input.agentId,
      input.threadId,
      input.taskId,
    )
    try {
      const terminal = await runtime.terminals.create({
        executionSessionId: session.id,
        command: input.command,
        argv: input.argv,
        cwd: input.cwd,
        title: input.title,
        cols: input.cols,
        rows: input.rows,
        owner: 'user',
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
      const session = await prepare(runtime, ctx.threadService, query.agentId, query.threadId)
      try {
        const result = runtime.terminals.read(
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
      const session = await prepare(runtime, ctx.threadService, input.agentId, input.threadId)
      try {
        runtime.terminals.write(c.req.param('id'), session.id, input.data)
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
      const session = await prepare(runtime, ctx.threadService, input.agentId, input.threadId)
      try {
        runtime.terminals.resize(c.req.param('id'), session.id, input.cols, input.rows)
        return c.json({ code: 'OK', data: { resized: true } })
      } catch (error) {
        throw validation(error)
      }
    },
  )

  for (const action of ['interrupt', 'kill', 'close', 'archive'] as const) {
    router.post(`/:id/${action}`, zValidator('json', sessionQuery), async (c) => {
      const input = c.req.valid('json')
      const session = await prepare(runtime, ctx.threadService, input.agentId, input.threadId)
      try {
        await runtime.terminals[action](c.req.param('id'), session.id)
        return c.json({ code: 'OK', data: { [action]: true } })
      } catch (error) {
        throw validation(error)
      }
    })
  }

  return router
}

async function prepare(
  runtime: ProductivityRuntime,
  threads: ThreadService,
  agentId: string,
  threadId: string,
  taskId?: string,
) {
  const thread = await threads.getThread(threadId)
  if (!thread) throw new AppError('NOT_FOUND', { message: '终端关联的会话已不存在或已回滚' })
  if (thread.agentId !== agentId)
    throw new AppError('FORBIDDEN', { message: '终端关联的会话不属于当前角色' })
  if (thread.channel !== 'desktop')
    throw new AppError('FORBIDDEN', { message: '工作区终端需要 desktop 会话，请切换回普通对话' })
  if (taskId || thread.purpose === 'background_task') {
    const owned = runtime.sessions.findByOwner({ agentId, threadId, taskId, channel: 'desktop' })
    if (!owned || !owned.taskId)
      throw new AppError('NOT_FOUND', { message: '任务执行会话尚未建立或已清理' })
    return owned
  }
  const principalRoot = runtime.workspace.getWorkspaceRoot(agentId)
  const workspaceRoot = taskId
    ? path.join(path.dirname(principalRoot), 'tasks', taskId, 'workspace')
    : principalRoot
  return runtime.sessions.getOrCreate({
    ownerAgentId: agentId,
    threadId,
    taskId,
    channel: 'desktop',
    workspaceRoot,
  })
}

function validation(error: unknown): AppError {
  return new AppError('VALIDATION_ERROR', {
    message: String(error instanceof Error ? error.message : error),
  })
}
