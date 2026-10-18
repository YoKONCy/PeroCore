import { Hono } from 'hono'
import type { StaticAssetService } from '../services/system/staticAssetService'

/** 提供官方应用静态界面，不暴露应用目录中的 Host 和清单。 */
export function createArcaUiRouter(assets: StaticAssetService, application = 'arca') {
  const router = new Hono()
  router.get('/*', (c) => {
    const requested =
      c.req.path.slice(`/applications/${application}`.length).replace(/^\//, '') || 'index.html'
    let decoded: string
    try {
      decoded = decodeURIComponent(requested)
    } catch {
      return c.text('请求路径无效', 400)
    }
    try {
      const asset = assets.read(decoded)
      if (!asset) return c.text('应用界面资源不存在', 404)
      c.header('Content-Type', asset.contentType)
      c.header('Cache-Control', asset.cacheControl)
      return c.body(asset.body)
    } catch {
      return c.text('禁止访问', 403)
    }
  })
  return router
}
