import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)
const { validateSocialTransport } = require('../../../../../scripts/electron-after-pack.cjs') as {
  validateSocialTransport(port: number, bundle: string, token: string): Promise<void>
}
const bundle = fileURLToPath(new URL('../../../package.json', import.meta.url))
let server: Server | undefined
let sockets: WebSocketServer | undefined

afterEach(async () => {
  for (const socket of sockets?.clients ?? []) socket.terminate()
  if (sockets) await new Promise<void>((resolve) => sockets!.close(() => resolve()))
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  sockets = undefined
  server = undefined
})

async function endpoint() {
  const headers: Array<string | undefined> = []
  server = createServer((request, response) => {
    headers.push(request.headers.authorization)
    if (request.headers.authorization !== 'Bearer smoke-only') {
      response.writeHead(401).end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({ data: { adapters: [{ platform: 'qq', connected: true, latencyMs: 0 }] } }),
    )
  })
  sockets = new WebSocketServer({ server })
  sockets.on('connection', (_socket, request) => {
    headers.push(request.headers.authorization)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('烟测测试服务未取得端口')
  return { port: address.port, headers }
}

describe('发行社交烟测鉴权', () => {
  it('同一临时凭据用于 WebSocket 与状态请求，接口无需匿名放行', async () => {
    const { port, headers } = await endpoint()
    await expect(validateSocialTransport(port, bundle, 'smoke-only')).resolves.toBeUndefined()
    expect(headers).toEqual(['Bearer smoke-only', 'Bearer smoke-only'])
  })

  it('无效凭据仍然拒绝，不能把未授权的状态响应算作验收成功', async () => {
    const { port } = await endpoint()
    await expect(validateSocialTransport(port, bundle, 'invalid')).rejects.toThrow('401')
  })
})
