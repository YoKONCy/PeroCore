/**
 * Asset Router — 资源管理 API
 *
 * 提供资产查询端点：
 * - GET /api/assets         获取所有已注册资产列表
 * - GET /api/assets/:type   按类型获取资产
 *
 * @module packages/backend/src/routers/asset.router
 */

import { Hono } from 'hono'
import type { AppContext } from '../container'
import type { AssetType } from '../core/assetRegistry'

export function createAssetRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/assets — 获取所有已注册资产
  router.get('/', (c) => {
    const assets = ctx.assetRegistry.getAllAssets()
    return c.json({ code: 'OK', message: '获取成功', data: assets })
  })

  // GET /api/assets/:type — 按类型获取资产 (persona/plugin/model_3d 等)
  router.get('/:type', (c) => {
    const type = c.req.param('type') as AssetType
    const assets = ctx.assetRegistry.getAssetsByType(type)
    return c.json({ code: 'OK', message: '获取成功', data: assets })
  })

  return router
}
