/**
 * 模型配置 API 路由
 *
 * AI 模型配置的 CRUD：
 * - GET    /api/models           列出所有模型配置
 * - GET    /api/models/:id       获取单个模型配置
 * - POST   /api/models           创建模型配置
 * - PUT    /api/models/:id       更新模型配置
 * - DELETE /api/models/:id       删除模型配置
 * - POST   /api/models/:id/test  测试模型连通性
 *
 * @module packages/backend/src/routers/model.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { AppError } from '../lib/appError'
import { aiModelConfigs } from '../database/schema'
import type { AppContext } from '../container'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

const createModelSchema = z.object({
  /** 配置名称 (用户可读，如 "GPT-4o 日常") */
  name: z.string().min(1).max(100),
  /** Provider 类型 (openai/gemini/anthropic 等) */
  provider: z.string().min(1),
  /** 模型 ID (如 gpt-4o, claude-sonnet-4-20250514) */
  modelId: z.string().min(1),
  /** API Key */
  apiKey: z.string().min(1),
  /** API 基址 (可选，留空使用默认) */
  apiBase: z.string().optional(),
  /** 温度 0-2 */
  temperature: z.number().min(0).max(2).optional(),
  /** Top P 0-1 */
  topP: z.number().min(0).max(1).optional(),
  /** 最大 Token 数 */
  maxTokens: z.number().int().min(1).optional(),
  /** Provider 类型 / 用途 (global/chat/scorer/reflection/task) */
  providerType: z.string().default('global'),
})

const updateModelSchema = createModelSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
})

/** 遮蔽 API Key (保留前4后4) */
function maskKey(key: string | null): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createModelRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/models — 列出所有模型配置 (API Key 遮蔽)
  router.get('/', async (c) => {
    const models = await ctx.db.select().from(aiModelConfigs).all()
    const masked = models.map((m) => ({ ...m, apiKey: maskKey(m.apiKey) }))
    return c.json({ code: 'OK', message: '获取成功', data: masked })
  })

  // GET /api/models/:id — 获取单个模型配置
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const model = await ctx.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get()

    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { ...model, apiKey: maskKey(model.apiKey) },
    })
  })

  // POST /api/models — 创建模型配置
  router.post('/', zValidator('json', createModelSchema), async (c) => {
    const body = c.req.valid('json')
    const now = new Date().toISOString()

    const [model] = await ctx.db
      .insert(aiModelConfigs)
      .values({
        name: body.name,
        provider: body.provider,
        modelId: body.modelId,
        apiKey: body.apiKey,
        apiBase: body.apiBase,
        temperature: body.temperature ?? 0.7,
        topP: body.topP,
        maxTokens: body.maxTokens,
        providerType: body.providerType,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    // 清理 ModelRegistry 缓存
    ctx.modelRegistry.invalidateCache()

    return c.json(
      {
        code: 'CREATED',
        message: '模型配置已创建',
        data: { ...model, apiKey: maskKey(model!.apiKey) },
      },
      201,
    )
  })

  // PUT /api/models/:id — 更新模型配置
  router.put('/:id', zValidator('json', updateModelSchema), async (c) => {
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')

    // 检查是否存在
    const existing = await ctx.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get()

    if (!existing) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    // 构建更新字段
    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    }
    if (body.name !== undefined) updateData.name = body.name
    if (body.provider !== undefined) updateData.provider = body.provider
    if (body.modelId !== undefined) updateData.modelId = body.modelId
    if (body.apiKey !== undefined) updateData.apiKey = body.apiKey
    if (body.apiBase !== undefined) updateData.apiBase = body.apiBase
    if (body.temperature !== undefined) updateData.temperature = body.temperature
    if (body.topP !== undefined) updateData.topP = body.topP
    if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens
    if (body.providerType !== undefined) updateData.providerType = body.providerType

    await ctx.db.update(aiModelConfigs).set(updateData).where(eq(aiModelConfigs.id, id))

    // 重新查出更新后的记录
    const updated = await ctx.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get()

    // 清理缓存
    ctx.modelRegistry.invalidateCache()

    return c.json({
      code: 'OK',
      message: '模型配置已更新',
      data: { ...updated, apiKey: maskKey(updated!.apiKey) },
    })
  })

  // DELETE /api/models/:id — 删除模型配置
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))

    const existing = await ctx.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get()

    if (!existing) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    await ctx.db.delete(aiModelConfigs).where(eq(aiModelConfigs.id, id))

    // 清理缓存
    ctx.modelRegistry.invalidateCache()

    return c.json({ code: 'OK', message: '模型配置已删除' })
  })

  // POST /api/models/:id/test — 测试模型连通性
  router.post('/:id/test', async (c) => {
    const id = Number(c.req.param('id'))
    const model = await ctx.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get()

    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    try {
      const startTime = Date.now()
      const response = await ctx.llmService.chat(
        {
          provider: model.provider ?? 'openai',
          modelId: model.modelId,
          apiKey: model.apiKey ?? '',
          apiBase: model.apiBase ?? undefined,
          temperature: 0,
          maxTokens: 10,
        },
        [{ role: 'user', content: 'Hello, respond with OK.' }],
      )
      const durationMs = Date.now() - startTime

      return c.json({
        code: 'OK',
        message: '模型连通性测试成功',
        data: {
          success: true,
          durationMs,
          response: response.choices[0]?.message?.content?.slice(0, 50),
        },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return c.json(
        {
          code: 'LLM_ERROR',
          message: `模型测试失败: ${errMsg}`,
          data: { success: false, error: errMsg },
        },
        502,
      )
    }
  })

  return router
}
