/**
 * 配置 API 路由
 *
 * KV 配置的完整 CRUD 端点 (B6-3)：
 * - GET    /api/configs          列出所有配置 (分页)
 * - GET    /api/configs/:key     获取单个配置
 * - PUT    /api/configs          设置配置
 * - DELETE /api/configs/:key     删除配置
 * - POST   /api/configs/batch    批量获取
 * - PUT    /api/configs/batch    批量设置
 * - POST   /api/configs/export   导出全部配置
 * - POST   /api/configs/import   导入配置
 *
 * @module packages/backend/src/routers/config.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { setConfigSchema, batchGetConfigSchema } from '../schemas/config.schema'
import { z } from 'zod'
import type { AppContext } from '../container'
import { createLogger } from '../lib/logger'

const logger = createLogger('ConfigRouter')

/** 配置 key 前缀到热更新方法的映射 */
const HOT_RELOAD_MAP: Array<{
  prefix: string
  method: keyof Pick<AppContext, 'reloadEmbeddingConfig' | 'reloadTtsConfig' | 'reloadAsrConfig'>
}> = [
  { prefix: 'embedding.', method: 'reloadEmbeddingConfig' },
  { prefix: 'reranker.', method: 'reloadEmbeddingConfig' },
  { prefix: 'tts.', method: 'reloadTtsConfig' },
  { prefix: 'asr.', method: 'reloadAsrConfig' },
]

// ── 额外 Schema (B6-3) ──

const batchSetConfigSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string(),
      }),
    )
    .min(1)
    .max(100),
})

const importConfigSchema = z.object({
  data: z.record(z.string()),
  /** 是否覆盖已有 key (默认 true) */
  overwrite: z.boolean().default(true),
})

/**
 * 架构说明: ConfigRepo 是一个纯 KV CRUD，业务逻辑极简 (get/set/delete/listAll)，
 * 中间插入 Service 层只会增加无意义的透传。因此这里 Router 直接调用 Repo 是
 * 三层架构的**允许例外**。
 *
 * ⚠️ 请勿将此模式复制到复杂资源 (如 Model/Memory/Agent) 的 Router 中。
 */
export function createConfigRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/configs — 列出所有配置 (B6-3)
  router.get('/', async (c) => {
    const prefix = c.req.query('prefix') ?? ''
    const entries = await ctx.configRepo.listAll(prefix)
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { items: entries, total: entries.length },
    })
  })

  // GET /api/configs/:key — 获取单个配置
  router.get('/:key', async (c) => {
    const key = c.req.param('key')
    const value = await ctx.configRepo.get(key)
    if (value == null) {
      // 找不到配置时返回 200 OK + null，避免触发后端 Hono logger 的 404 WARN
      return c.json({
        code: 'NOT_CONFIGURED',
        message: `配置 "${key}" 未设置`,
        data: { key, value: null },
      })
    }
    return c.json({ code: 'OK', message: '获取成功', data: { key, value } })
  })

  // PUT /api/configs — 设置配置
  router.put('/', zValidator('json', setConfigSchema), async (c) => {
    const { key, value } = c.req.valid('json')
    await ctx.configRepo.set(key, value)

    // 检测是否需要触发服务热更新
    for (const { prefix, method } of HOT_RELOAD_MAP) {
      if (key.startsWith(prefix)) {
        logger.info(`检测到配置变更: ${key}，触发 ${method}`)
        await ctx[method]()
        break
      }
    }

    return c.json({ code: 'OK', message: '配置已更新', data: { key, value } })
  })

  // DELETE /api/configs/:key — 删除配置 (B6-3)
  router.delete('/:key', async (c) => {
    const key = c.req.param('key')
    const existing = await ctx.configRepo.get(key)
    if (existing == null) {
      return c.json({ code: 'NOT_FOUND', message: `配置 "${key}" 不存在` }, 404)
    }
    await ctx.configRepo.delete(key)
    return c.json({ code: 'OK', message: `配置 "${key}" 已删除` })
  })

  // POST /api/configs/batch — 批量获取
  router.post('/batch', zValidator('json', batchGetConfigSchema), async (c) => {
    const { keys } = c.req.valid('json')
    const results: Record<string, string | null> = {}
    for (const key of keys) {
      results[key] = (await ctx.configRepo.get(key)) ?? null
    }
    return c.json({ code: 'OK', message: '批量获取成功', data: results })
  })

  // PUT /api/configs/batch — 批量设置 (B6-3)
  router.put('/batch', zValidator('json', batchSetConfigSchema), async (c) => {
    const { items } = c.req.valid('json')
    const pendingReloads = new Set<string>()
    for (const item of items) {
      await ctx.configRepo.set(item.key, item.value)
      for (const { prefix, method } of HOT_RELOAD_MAP) {
        if (item.key.startsWith(prefix)) {
          pendingReloads.add(method)
        }
      }
    }

    // 批量完成后统一触发热更新 (每个 service 最多一次)
    for (const method of pendingReloads) {
      logger.info(`批量配置变更，触发 ${method}`)
      await ctx[
        method as keyof Pick<
          AppContext,
          'reloadEmbeddingConfig' | 'reloadTtsConfig' | 'reloadAsrConfig'
        >
      ]()
    }

    return c.json({
      code: 'OK',
      message: `已更新 ${items.length} 项配置`,
      data: { count: items.length },
    })
  })

  // POST /api/configs/export — 导出全部配置 (B6-3)
  router.post('/export', async (c) => {
    const entries = await ctx.configRepo.listAll('')
    const data: Record<string, string> = {}
    for (const entry of entries) {
      data[entry.key] = entry.value
    }
    return c.json({
      code: 'OK',
      message: `已导出 ${entries.length} 项配置`,
      data,
    })
  })

  // POST /api/configs/import — 导入配置 (B6-3)
  router.post('/import', zValidator('json', importConfigSchema), async (c) => {
    const { data, overwrite } = c.req.valid('json')
    let imported = 0
    let skipped = 0

    for (const [key, value] of Object.entries(data)) {
      if (!overwrite) {
        const existing = await ctx.configRepo.get(key)
        if (existing != null) {
          skipped++
          continue
        }
      }
      await ctx.configRepo.set(key, value)
      imported++
    }

    return c.json({
      code: 'OK',
      message: `导入完成: ${imported} 项写入, ${skipped} 项跳过`,
      data: { imported, skipped },
    })
  })

  return router
}
