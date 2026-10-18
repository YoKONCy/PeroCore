import { Hono } from 'hono'
import type { HtmlPreviewService } from '../services/attachment/htmlPreviewService'
import { resourceContent } from '../services/attachment/resourceContent'

/** 公开入口只接受已签发的随机票据；不接受设备路径或主应用 token。 */
export function createHtmlPreviewRouter(previews: HtmlPreviewService) {
  const router = new Hono()
  router.on(['GET', 'HEAD'], '/:ticket/*', async (c) => {
    const ticket = c.req.param('ticket')
    const prefix = `/html-previews/${ticket}/`
    const resource = await previews.resolve(ticket, c.req.path.slice(prefix.length))
    const root = new URL(prefix, c.req.url).href
    const policy = [
      'sandbox allow-scripts',
      "default-src 'none'",
      `script-src 'unsafe-inline' 'unsafe-eval' ${root} https:`,
      `style-src 'unsafe-inline' ${root} https:`,
      `img-src ${root} data: blob: https: http:`,
      `font-src ${root} data: https:`,
      `media-src ${root} data: blob: https:`,
      `connect-src ${root}`,
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ')
    const response = await resourceContent(c, resource.filePath, resource.mimeType, resource.name, {
      inline: true,
      policy,
    })
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  })
  return router
}
