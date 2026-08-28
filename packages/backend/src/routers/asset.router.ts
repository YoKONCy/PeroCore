/**
 * Asset Router — 资源管理 API
 *
 * 提供资产查询端点 + 资源覆盖管理：
 * - GET    /api/assets              获取所有已注册资产列表
 * - GET    /api/assets/by-type/:type  按类型获取资产
 * - GET    /api/assets/by-source/:source  按来源获取资产
 * - POST   /api/assets/rescan       强制重新扫描
 * - POST   /api/assets/export-to-custom  复制官方模板到用户层
 * - POST   /api/assets/restore      恢复为官方版本
 * - GET    /api/assets/prompt-source/:path  查询模板来源
 *
 * @module packages/backend/src/routers/asset.router
 */

import { Hono } from 'hono'
import type { KernelFileHandleId } from '@infos/shared'
import type { AppContext } from '../container'
import type { AssetType, AssetSource } from '../core/assetRegistry'
import { AppError } from '../lib/appError'

export function createAssetRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/audio/:handleId', async (c) => {
    const subjectId = c.req.query('subject') ?? ''
    const { asset, bytes } = ctx.assetFileAuthority.consumeBytes(
      c.req.param('handleId') as KernelFileHandleId,
      subjectId,
      'read',
    )
    return new Response(bytes, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(asset.sizeBytes),
        'X-Asset-SHA256': asset.sha256,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

  // GET /api/assets — 获取所有已注册资产
  router.get('/', (c) => {
    const assets = ctx.assetRegistry.getAllAssets()
    return c.json({ code: 'OK', message: '获取成功', data: assets })
  })

  // GET /api/assets/by-type/:type — 按类型获取
  router.get('/by-type/:type', (c) => {
    const type = c.req.param('type') as AssetType
    const assets = ctx.assetRegistry.getAssetsByType(type)
    return c.json({ code: 'OK', message: '获取成功', data: assets })
  })

  // GET /api/assets/by-source/:source — 按来源获取
  router.get('/by-source/:source', (c) => {
    const source = c.req.param('source') as AssetSource
    const assets = ctx.assetRegistry.getAssetsBySource(source)
    return c.json({ code: 'OK', message: '获取成功', data: assets })
  })

  // POST /api/assets/rescan — 强制重新扫描 (B6-4)
  router.post('/rescan', async (c) => {
    await ctx.assetRegistry.rescan()
    const count = ctx.assetRegistry.getAllAssets().length
    return c.json({
      code: 'OK',
      message: `资产重新扫描完成`,
      data: { totalAssets: count },
    })
  })

  // POST /api/assets/export-to-custom — 复制官方模板到用户自定义层
  router.post('/export-to-custom', async (c) => {
    const body = await c.req.json()
    const templatePath = body.templatePath as string

    if (!templatePath) {
      throw new AppError('VALIDATION_ERROR', { message: 'templatePath 为必填字段' })
    }

    try {
      const exportedPath = await ctx.promptTemplateLoader.exportToCustom(templatePath)
      return c.json({
        code: 'OK',
        message: `模板已导出到自定义层`,
        data: { templatePath, exportedPath },
      })
    } catch (err) {
      throw new AppError('NOT_FOUND', {
        message: err instanceof Error ? err.message : '导出失败',
      })
    }
  })

  // POST /api/assets/restore — 恢复提示词为官方版本
  router.post('/restore', async (c) => {
    const body = await c.req.json()
    const templatePath = body.templatePath as string

    if (!templatePath) {
      throw new AppError('VALIDATION_ERROR', { message: 'templatePath 为必填字段' })
    }

    const restored = await ctx.promptTemplateLoader.restoreToOfficial(templatePath)
    if (!restored) {
      return c.json({
        code: 'OK',
        message: '该模板本就是官方版本，无需恢复',
        data: { templatePath, restored: false },
      })
    }

    return c.json({
      code: 'OK',
      message: '模板已恢复为官方版本',
      data: { templatePath, restored: true },
    })
  })

  // GET /api/assets/prompt-source/* — 查询模板来源
  router.get('/prompt-source/*', (c) => {
    const templatePath = c.req.path.replace(/^\/prompt-source\//, '')
    const source = ctx.promptTemplateLoader.getSource(templatePath)
    const isCustomized = ctx.promptTemplateLoader.isCustomized(templatePath)

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { templatePath, source, isCustomized },
    })
  })

  return router
}
