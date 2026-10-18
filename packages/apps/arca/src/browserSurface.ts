import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

/** 独立页面只连接自身文稿权威，不向浏览器暴露宿主控制凭据。 */
export class ArcaBrowserSurface {
  constructor(
    private readonly uiRoot: string,
    private readonly developmentUi = false,
  ) {}
  entry(origin: string, endpoint: string): string {
    const url = this.developmentUi ? new URL('http://127.0.0.1:7362/') : new URL('/', origin)
    url.searchParams.set('standalone', '1')
    url.searchParams.set('endpoint', endpoint)
    return url.href
  }
  handle(req: IncomingMessage, res: ServerResponse, origin: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let relative: string
    try {
      relative = decodeURIComponent(new URL(req.url || '/', origin).pathname).replace(/^\/+/, '')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const target = path.resolve(this.uiRoot, relative || 'index.html')
    const outside = (root: string, file: string) => {
      const value = path.relative(root, file)
      return value.startsWith('..') || path.isAbsolute(value)
    }
    if (outside(path.resolve(this.uiRoot), target)) {
      res.writeHead(403)
      res.end()
      return
    }
    const file =
      existsSync(target) && statSync(target).isFile()
        ? target
        : path.join(this.uiRoot, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('客户端资源尚未生成。开发时使用 --dev-ui，并打开后台输出的文稿链接。')
      return
    }
    if (outside(realpathSync(this.uiRoot), realpathSync(file))) {
      res.writeHead(403)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    if (req.method === 'HEAD') res.end()
    else
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res)
  }
}
