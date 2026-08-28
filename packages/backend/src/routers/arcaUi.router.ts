import { Hono } from 'hono'
import type { StaticAssetService } from '../services/system/staticAssetService'

/** 提供随发行包分发的Arca静态UI，不暴露应用目录中的Host和清单。 */
export function createArcaUiRouter(assets: StaticAssetService) {
  const router = new Hono()
  router.get('/*', (c) => {
    const requested = c.req.path.replace(/^\/applications\/arca\/?/, '') || 'index.html'
    let decoded: string
    try {
      decoded = decodeURIComponent(requested)
    } catch {
      return c.text('请求路径无效', 400)
    }
    try {
      const asset = assets.read(decoded)
      if (!asset) return c.text('Arca UI资源不存在', 404)
      c.header('Content-Type', asset.contentType)
      c.header('Cache-Control', asset.cacheControl)
      return c.body(asset.body)
    } catch {
      return c.text('禁止访问', 403)
    }
  })
  return router
}
