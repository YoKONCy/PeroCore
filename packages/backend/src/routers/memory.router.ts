/**
 * 记忆 API 路由
 *
 * CRUD + 语义搜索端点。
 *
 * @module packages/backend/src/routers/memory.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createMemorySchema, listMemorySchema, searchMemorySchema } from '../schemas/memory.schema'
import type { AppContext } from '../container'

export function createMemoryRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/memories — 列表
  router.get('/', zValidator('query', listMemorySchema), async (c) => {
    const query = c.req.valid('query')
    const result = await ctx.memoryService.list({
      agentId: query.agentId ?? 'pero',
      page: query.page,
      pageSize: query.pageSize,
    })
    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  // POST /api/memories — 创建
  router.post('/', zValidator('json', createMemorySchema), async (c) => {
    const body = c.req.valid('json')
    const memory = await ctx.memoryService.create({
      content: body.content,
      agentId: body.agentId,
      importance: body.importance ?? 5,
      sentiment: body.sentiment ?? 'neutral',
      type: body.type ?? 'event',
      source: body.source ?? 'desktop',
    })
    return c.json({ code: 'CREATED', message: '记忆已创建', data: memory }, 201)
  })

  // POST /api/memories/search — 语义搜索
  router.post('/search', zValidator('json', searchMemorySchema), async (c) => {
    const body = c.req.valid('json')
    const results = await ctx.memorySearchService.search({
      query: body.query,
      agentId: body.agentId,
      source: body.source ?? 'desktop',
      topK: body.topK ?? 10,
      minScore: body.minScore,
    })
    return c.json({ code: 'OK', message: '搜索完成', data: results })
  })

  // GET /api/memories/graph — 图谱数据
  router.get('/graph', async (c) => {
    const agentId = c.req.query('agentId') ?? 'pero'
    const limit = Number(c.req.query('limit') ?? 100)
    const graph = await ctx.memoryService.getGraph(agentId, limit)
    return c.json({ code: 'OK', message: '获取成功', data: graph })
  })

  // DELETE /api/memories/:id — 删除
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) {
      return c.json({ code: 'INVALID_PARAMETER', message: '无效的记忆 ID' }, 400)
    }
    const agentId = c.req.query('agentId') ?? 'pero'
    const source = c.req.query('source') ?? 'desktop'
    await ctx.memoryService.delete(id, agentId, source)
    return c.json({ code: 'OK', message: '记忆已删除' })
  })

  return router
}
