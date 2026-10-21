import { t as __t } from './i18n'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import type { PictoriaApplication } from './application'
import { identifier, object } from './domain'
import { operations } from './manifest'

const owner = 'local'
const allowed = new Set<string>(
  operations.filter(
    (operation) => !['events.list', 'events.ack', 'tool.execute'].includes(operation),
  ),
)
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** 独立浏览器会话与宿主桥接密钥分离，只能访问本地工作室。 */
export class BrowserSurface {
  private readonly session = randomBytes(32).toString('hex')
  constructor(
    private readonly application: PictoriaApplication,
    private readonly uiRoot: string,
    private readonly developmentUi = false,
    private readonly shutdown?: () => Promise<void>,
  ) {}
  entry(origin: string): string {
    const url =
      !this.developmentUi && existsSync(path.join(this.uiRoot, 'index.html'))
        ? new URL('/', origin)
        : new URL('http://127.0.0.1:7363/')
    url.searchParams.set('standalone', '1')
    url.searchParams.set('pictoriaOrigin', origin)
    url.hash = `pictoria-session=${this.session}`
    return url.toString()
  }
  async handle(req: IncomingMessage, res: ServerResponse, origin: string): Promise<boolean> {
    const url = new URL(req.url || '/', origin)
    if (
      ['/status', '/shutdown', '/assets'].includes(url.pathname) ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/operations/')
    )
      return false
    if (
      !['127.0.0.1', 'localhost'].includes(new URL(`http://${req.headers.host || ''}`).hostname)
    ) {
      res.writeHead(403)
      res.end()
      return true
    }
    if (!url.pathname.startsWith('/pictoria-api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false
      let relative: string
      try {
        relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      } catch {
        res.writeHead(400)
        res.end()
        return true
      }
      const target = path.resolve(this.uiRoot, relative || 'index.html')
      if (
        path.relative(this.uiRoot, target).startsWith('..') ||
        path.isAbsolute(path.relative(this.uiRoot, target))
      ) {
        res.writeHead(403)
        res.end()
        return true
      }
      const file =
        existsSync(target) && statSync(target).isFile()
          ? target
          : path.join(this.uiRoot, 'index.html')
      if (!existsSync(file)) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('客户端资源尚未生成。开发时启动 dev:client，并使用后台输出的画布链接。')
        return true
      }
      const root = realpathSync(this.uiRoot),
        actual = realpathSync(file)
      if (
        path.relative(root, actual).startsWith('..') ||
        path.isAbsolute(path.relative(root, actual))
      ) {
        res.writeHead(403)
        res.end()
        return true
      }
      res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream')
      res.setHeader('x-content-type-options', 'nosniff')
      res.setHeader('referrer-policy', 'no-referrer')
      res.setHeader('cache-control', 'no-store')
      if (req.method === 'HEAD') res.end()
      else
        createReadStream(file)
          .on('error', () => res.destroy())
          .pipe(res)
      return true
    }
    const requestOrigin = req.headers.origin
    if (
      requestOrigin &&
      ![
        origin,
        origin.replace('127.0.0.1', 'localhost'),
        'http://127.0.0.1:7363',
        'http://localhost:7363',
      ].includes(requestOrigin)
    ) {
      res.writeHead(403)
      res.end()
      return true
    }
    if (requestOrigin) {
      res.setHeader('access-control-allow-origin', requestOrigin)
      res.setHeader('vary', 'Origin')
    }
    res.setHeader('access-control-allow-headers', 'content-type,x-pictoria-session')
    res.setHeader('access-control-allow-methods', 'POST,OPTIONS')
    res.setHeader('cache-control', 'no-store')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return true
    }
    const token = req.headers['x-pictoria-session']
    if (
      typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(this.session) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(this.session))
    ) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          code: 'UNAUTHORIZED',
          message: __t('apps.pictoria.ui', '请使用 Pictoria 后台输出的画布链接连接'),
        }),
      )
      return true
    }
    res.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      if (req.method !== 'POST' || url.pathname !== '/pictoria-api/request')
        throw new Error('画布接口不存在')
      const parts: Buffer[] = []
      let length = 0
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk)
        if (length > 28_100_000) throw new Error('画布请求过大')
        parts.push(Buffer.from(chunk))
      }
      const value = object(JSON.parse(Buffer.concat(parts).toString('utf8')))
      let data: unknown
      if (value.action === 'bootstrap')
        data = {
          agents: [{ id: owner, name: '本地工作室' }],
          status: {
            ownership: 'standalone',
            managedRuntimeAvailable: false,
            federation: { state: 'connected' },
          },
        }
      else if (value.action === 'start')
        data = {
          ownership: 'standalone',
          managedRuntimeAvailable: false,
          federation: { state: 'connected' },
        }
      else if (value.action === 'stop') {
        if (!this.shutdown) throw new Error('当前后台未开放退出入口')
        // 先发送回执，浏览器收到后显示退出状态，再由进程生命周期完成清理。
        res.once('finish', () =>
          setImmediate(() => {
            void this.shutdown!().catch(() => {
              process.exitCode = 1
            })
          }),
        )
        data = {
          ownership: 'offline',
          managedRuntimeAvailable: false,
          federation: { state: 'offline' },
        }
      } else if (value.action === 'operation') {
        const operation = String(value.operation)
        if (!allowed.has(operation)) throw new Error('此画布操作未开放')
        data = await this.application.invoke(operation, value.input || {}, { owner })
      } else if (value.action === 'run') {
        const input = object(value.input)
        data = await this.application.invoke('task.submit', object(input.input), {
          owner,
          key: identifier.parse(input.key),
        })
      } else if (value.action === 'upload') {
        const input = object(value.input),
          encoded = String(input.base64 || '')
        if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('素材数据无效')
        const bytes = Buffer.from(encoded, 'base64')
        if (bytes.length > 20 * 1024 * 1024) throw new Error('素材超过 20 MB')
        data = await this.application.assets.save(
          owner,
          String(input.name || '素材').slice(0, 200),
          String(input.mimeType || 'application/octet-stream').slice(0, 100),
          bytes,
        )
      } else if (value.action === 'asset') {
        const asset = this.application.store.asset(identifier.parse(value.id), owner)
        if (asset.sizeBytes > 100 * 1024 * 1024) throw new Error('预览资源过大')
        data = {
          info: asset,
          base64: readFileSync(this.application.assets.path(asset)).toString('base64'),
        }
      } else throw new Error('未知画布操作')
      res.end(JSON.stringify({ code: 'OK', data }))
    } catch (error) {
      res.writeHead(400)
      res.end(
        JSON.stringify({
          code: 'ERROR',
          message: error instanceof Error ? error.message : __t('apps.pictoria.ui', '画布请求失败'),
        }),
      )
    }
    return true
  }
}
