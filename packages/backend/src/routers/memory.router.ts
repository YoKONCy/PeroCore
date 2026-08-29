import { Hono } from 'hono'
import { z } from 'zod'
import { validate as zValidator } from '../lib/validation'
import type { AppContext } from '../container'
import type { EventNoteArchiveFilter, EventNoteStatus, EventNoteOriginMode } from '@infos/shared'

/** 逗号分隔字符串 → 去重数组 */
function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? [...new Set(items)] : undefined
}

const archiveQuerySchema = z.object({
  agentId: z.string().trim().min(1).default('pero'),
  agentIds: z.string().optional(),
  query: z.string().trim().optional(),
  channels: z.string().optional(),
  statuses: z.string().optional(),
  modes: z.string().optional(),
  tones: z.string().optional(),
  participants: z.string().optional(),
  places: z.string().optional(),
  objects: z.string().optional(),
  topics: z.string().optional(),
  importanceMin: z.coerce.number().int().min(0).max(10).optional(),
  importanceMax: z.coerce.number().int().min(0).max(10).optional(),
  eventAtFrom: z.string().trim().optional(),
  eventAtTo: z.string().trim().optional(),
  createdAtFrom: z.string().trim().optional(),
  createdAtTo: z.string().trim().optional(),
  sort: z.enum(['eventAt', 'createdAt', 'importance']).default('eventAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  // 兼容旧前端：仅控制是否包含归档（statuses 优先）
  includeArchived: z.string().optional(),
})

export function createMemoryRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/memories — 档案组合过滤 + 分页 + facets + stats
  router.get('/', zValidator('query', archiveQuerySchema), async (c) => {
    const input = c.req.valid('query')
    const statuses =
      (csv(input.statuses) as EventNoteStatus[] | undefined) ??
      (input.includeArchived === undefined
        ? undefined
        : input.includeArchived === 'true'
          ? (['active', 'archived'] as EventNoteStatus[])
          : (['active'] as EventNoteStatus[]))
    const filter: EventNoteArchiveFilter = {
      agentId: input.agentId,
      agentIds: csv(input.agentIds),
      query: input.query,
      channels: csv(input.channels),
      statuses,
      modes: csv(input.modes) as EventNoteOriginMode[] | undefined,
      tones: csv(input.tones),
      participants: csv(input.participants),
      places: csv(input.places),
      objects: csv(input.objects),
      topics: csv(input.topics),
      importanceMin: input.importanceMin,
      importanceMax: input.importanceMax,
      eventAtFrom: input.eventAtFrom,
      eventAtTo: input.eventAtTo,
      createdAtFrom: input.createdAtFrom,
      createdAtTo: input.createdAtTo,
      sort: input.sort,
      order: input.order,
      page: input.page,
      pageSize: input.pageSize,
    }
    const data = await ctx.eventMemoryService.archiveQuery(filter)
    return c.json({ code: 'OK', message: '获取成功', data })
  })

  // GET /api/memories/graph — TDB 批量图谱快照（无 N+1）
  router.get('/graph', async (c) => {
    const agentId = c.req.query('agentId') ?? 'pero'
    const includeArchived = c.req.query('includeArchived') === 'true'
    const limit = Math.min(1000, Math.max(1, Number(c.req.query('limit') ?? 300)))
    const data = await ctx.eventMemoryService.graphSnapshot(agentId, { includeArchived, limit })
    return c.json({ code: 'OK', message: '获取成功', data })
  })

  router.get('/:id/source', async (c) => {
    const detail = await ctx.eventMemoryService.detail(c.req.param('id'))
    if (!detail) return c.json({ code: 'NOT_FOUND', message: '事件记忆不存在' }, 404)
    const messages = await ctx.threadRepo.findMessagesByPairIds(
      detail.origin.threadId,
      detail.origin.pairIds,
    )
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        available: messages.length > 0,
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          pairId: message.pairId,
        })),
      },
    })
  })

  router.delete('/:id', async (c) => {
    await ctx.eventMemoryService.archive(c.req.param('id'))
    return c.json({ code: 'OK', message: '核心记忆已移入归档' })
  })

  router.get('/:id', async (c) => {
    const detail = await ctx.eventMemoryService.detail(c.req.param('id'))
    if (!detail) return c.json({ code: 'NOT_FOUND', message: '事件记忆不存在' }, 404)
    return c.json({ code: 'OK', message: '获取成功', data: detail })
  })

  return router
}
