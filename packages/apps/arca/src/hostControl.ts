import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { arcaHostAuthorized } from './hostCredentials'
import { ArcaBrowserSurface } from './browserSurface'

/** 子应用控制面：认证、桌面绑定和页面托管不进入办公内核。 */
export class ArcaHostControl {
  private server?: Server
  private closing?: Promise<void>
  constructor(
    private readonly options: {
      key: string
      browser?: ArcaBrowserSurface
      shutdown: () => Promise<void>
      bindDesktop?: (value: unknown) => Promise<void>
    },
  ) {}
  async start(port: number): Promise<number> {
    const server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    this.server = server
    server.headersTimeout = 10000
    server.requestTimeout = 15000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Arca 控制端口不可用')
    return address.port
  }
  stop(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      if (!this.server?.listening) return
      const server = this.server
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      this.server = undefined
    })
    return this.closing
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host
    if (!host || !/^((127\.0\.0\.1|localhost):\d+)$/.test(host)) {
      res.writeHead(403)
      res.end()
      return
    }
    const origin = `http://${host}`,
      url = new URL(req.url || '/', origin)
    if (url.pathname === '/shutdown' || url.pathname === '/lifecycle/desktop') {
      if (
        req.method !== 'POST' ||
        !arcaHostAuthorized(req.headers.authorization?.replace(/^Bearer /, ''), this.options.key)
      ) {
        res.writeHead(403)
        res.end()
        return
      }
      if (url.pathname === '/lifecycle/desktop') {
        if (!this.options.bindDesktop) {
          res.writeHead(409)
          res.end()
          return
        }
        let body = ''
        for await (const chunk of req) {
          body += String(chunk)
          if (body.length > 2048) throw new Error('桌面凭据过大')
        }
        await this.options.bindDesktop(JSON.parse(body))
      } else {
        res.once('finish', () =>
          setImmediate(() => {
            void this.options
              .shutdown()
              .catch((error) => process.stderr.write(`Arca 停止失败：${String(error)}\n`))
          }),
        )
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ accepted: true }))
      return
    }
    if (this.options.browser) {
      this.options.browser.handle(req, res, origin)
      return
    }
    res.writeHead(404)
    res.end()
  }
}
