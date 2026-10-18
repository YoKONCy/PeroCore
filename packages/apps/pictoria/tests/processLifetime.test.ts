import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { watchDesktopGuard } from '../src/processLifetime'

const fixtures: Array<{ server: Server; sockets: Set<Socket>; dispose?: () => void }> = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.dispose?.()
    for (const socket of fixture.sockets) socket.destroy()
    if (fixture.server.listening)
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})
async function desktop(accept = true) {
  const suffix = randomBytes(8).toString('hex'),
    token = randomBytes(32).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\infos-pictoria-${process.pid}-${suffix}`
      : path.join(tmpdir(), `infos-pcl-${process.pid}-${suffix}.sock`)
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
    let input = ''
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8')
      if (!input.includes('\n')) return
      if (accept && JSON.parse(input.split('\n')[0]!).token === token)
        socket.write('{"ready":true}\n')
      else socket.destroy()
    })
  })
  const value = { server, sockets, dispose: undefined as (() => void) | undefined }
  fixtures.push(value)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipe, resolve)
  })
  return { value, guard: { pipe, token } }
}

describe('桌面生命周期连接', () => {
  it('桌面连接断开时只触发一次回收通知', async () => {
    const { value, guard } = await desktop(),
      callback = vi.fn()
    let notify!: () => void
    const disconnected = new Promise<void>((resolve) => {
      notify = resolve
    })
    const watch = watchDesktopGuard(guard, () => {
      callback()
      notify()
    })
    value.dispose = watch.dispose
    await watch.ready
    for (const socket of value.sockets) socket.destroy()
    await disconnected
    expect(callback).toHaveBeenCalledTimes(1)
    watch.dispose()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('主动释放观察者时不停止用户的桌面或其他实例', async () => {
    const { value, guard } = await desktop(),
      callback = vi.fn(),
      watch = watchDesktopGuard(guard, callback)
    value.dispose = watch.dispose
    await watch.ready
    watch.dispose()
    expect(callback).not.toHaveBeenCalled()
  })
  it('认证未通过时不把后台标记为已绑定', async () => {
    const { value, guard } = await desktop(false),
      callback = vi.fn(),
      watch = watchDesktopGuard(guard, callback)
    value.dispose = watch.dispose
    await expect(watch.ready).rejects.toThrow('桌面存活连接不可用')
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
