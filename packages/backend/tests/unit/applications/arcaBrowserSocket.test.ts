import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createArcaBrowserSocket } from '@infos/backend/applications/arcaBrowserSocket'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  return (server.address() as AddressInfo).port
}
async function proxy(endpoint: string, state = 'connected') {
  const server = createServer()
  const port = await listen(server)
  const bridge = createArcaBrowserSocket(() => ({
    uiUrl: '/applications/arca/',
    federation: { state, discovery: { endpoint } },
  }))
  server.on('upgrade', (request, socket, head) => bridge.upgrade(request, socket, head))
  cleanup.push(() => bridge.close())
  return `ws://127.0.0.1:${port}/api/applications/arca/transport`
}

describe('Arca 浏览器传输代理', () => {
  it('通过公开端口收发文本和二进制，子应用停止后关闭客户端', async () => {
    vi.stubEnv('INFOS_API_TOKEN', 'test-token')
    const host = createServer(),
      port = await listen(host)
    const upstream = new WebSocketServer({ server: host })
    cleanup.push(() => {
      for (const client of upstream.clients) client.terminate()
      upstream.close()
    })
    upstream.on('connection', (client) => {
      client.send('hello')
      client.on('message', (data, binary) => client.send(data, { binary }))
    })
    const address = await proxy(`ws://127.0.0.1:${port}`)
    const client = new WebSocket(`${address}?token=test-token`, {
      origin: new URL(address).origin.replace(/^ws/, 'http'),
    })
    cleanup.push(() => client.terminate())
    const hello = once(client, 'message')
    await once(client, 'open')
    expect(String((await hello)[0])).toBe('hello')
    const text = once(client, 'message')
    client.send('文稿内容')
    expect(String((await text)[0])).toBe('文稿内容')
    const binary = once(client, 'message')
    client.send(Buffer.from([1, 2, 3]))
    expect(await binary).toEqual([Buffer.from([1, 2, 3]), true])
    const closed = once(client, 'close')
    for (const connection of upstream.clients) connection.close()
    await closed
  })

  it.each([
    {
      name: '未授权请求',
      token: '',
      endpoint: 'ws://127.0.0.1:1',
      state: 'connected',
      origin: undefined,
      code: 401,
    },
    {
      name: '离线应用',
      token: 'test-token',
      endpoint: 'ws://127.0.0.1:1',
      state: 'offline',
      origin: undefined,
      code: 503,
    },
    {
      name: '外部目标',
      token: 'test-token',
      endpoint: 'ws://example.com/',
      state: 'connected',
      origin: undefined,
      code: 503,
    },
    {
      name: '跨站请求',
      token: 'test-token',
      endpoint: 'ws://127.0.0.1:1',
      state: 'connected',
      origin: 'https://example.com',
      code: 403,
    },
  ])('拒绝$name', async ({ token, endpoint, state, origin, code }) => {
    vi.stubEnv('INFOS_API_TOKEN', 'test-token')
    const address = await proxy(endpoint, state)
    const client = new WebSocket(`${address}?token=${token}`, { origin })
    cleanup.push(() => client.terminate())
    client.on('error', () => {})
    const [, response] = await once(client, 'unexpected-response')
    response.resume()
    expect(response.statusCode).toBe(code)
    client.terminate()
  })
})
