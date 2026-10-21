import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

interface ArcaBrowserStatus {
  uiUrl: string
  federation: { state: string; discovery?: { endpoint: string } }
}

/** 浏览器只连接宿主公开端口，子应用的回环地址始终留在服务器内。 */
export function createArcaBrowserSocket(status: () => ArcaBrowserStatus | undefined) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
  return {
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, authenticated = false): void {
      const reject = (code: number, reason: string) => {
        socket.end(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      }
      let endpoint: URL
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const token = process.env.INFOS_API_TOKEN
        if (!authenticated && token && url.searchParams.get('token') !== token) {
          reject(401, 'Unauthorized')
          return
        }
        const application = status()
        if (application?.federation.state !== 'connected' || !application.federation.discovery) {
          reject(503, 'Service Unavailable')
          return
        }
        const origin = request.headers.origin
        const host = request.headers.host
        if (!host) {
          reject(400, 'Bad Request')
          return
        }
        const publicOrigin = `${origin?.startsWith('https:') ? 'https:' : 'http:'}//${host}`
        if (
          origin &&
          origin !== publicOrigin &&
          origin !== new URL(application.uiUrl, publicOrigin).origin
        ) {
          reject(403, 'Forbidden')
          return
        }
        endpoint = new URL(application.federation.discovery.endpoint)
        if (
          endpoint.protocol !== 'ws:' ||
          !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) ||
          endpoint.username ||
          endpoint.password
        ) {
          reject(503, 'Service Unavailable')
          return
        }
      } catch {
        reject(400, 'Bad Request')
        return
      }
      server.handleUpgrade(request, socket, head, (client) => {
        const upstream = new WebSocket(endpoint, {
          handshakeTimeout: 8000,
          maxPayload: 32 * 1024 * 1024,
        })
        client.pause()
        const abort = () => {
          client.terminate()
          upstream.terminate()
        }
        client.on('error', abort)
        upstream.on('error', abort)
        client.on('close', () => {
          if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate()
          else upstream.close()
        })
        upstream.on('close', () => {
          client.resume()
          client.close(1001, '应用连接已结束')
        })
        upstream.on('open', () => {
          if (client.readyState !== WebSocket.OPEN) {
            upstream.close()
            return
          }
          client.resume()
        })
        client.on('message', (data, binary) => {
          if (upstream.readyState !== WebSocket.OPEN) {
            abort()
            return
          }
          upstream.send(data, { binary }, (error) => {
            if (error) abort()
          })
        })
        upstream.on('message', (data, binary) => {
          if (client.readyState !== WebSocket.OPEN) return
          client.send(data, { binary }, (error) => {
            if (error) abort()
          })
        })
      })
    },
    close(): void {
      for (const client of server.clients) client.terminate()
      server.close()
    },
  }
}
