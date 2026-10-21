import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { ClientAccessRepository } from '@infos/backend/repositories/clientAccess.repo'
import { ClientAccessService } from '@infos/backend/services/system/clientAccessService'
import { createClientAccessRouter } from '@infos/backend/routers/clientAccess.router'

describe('客户端配对与授权边界', () => {
  let directory: string
  let repository: ClientAccessRepository
  let access: ClientAccessService
  beforeEach(() => {
    vi.stubEnv('INFOS_DOCKER', '')
    vi.stubEnv('INFOS_API_TOKEN', '')
    directory = mkdtempSync(path.join(tmpdir(), 'infos-client-access-'))
    repository = new ClientAccessRepository(directory)
    access = new ClientAccessService(repository, 9120)
  })
  afterEach(async () => {
    await access.dispose()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })

  it('配对码仅兑换一次，原始设备凭据不落盘，重启后仍可撤销设备', () => {
    const pairing = access.createPairing()
    const device = access.pair(pairing.code, '手机', true, 'peer')
    expect(access.identify(device.token)?.admin).toBe(false)
    expect(() => access.pair(pairing.code, '另一个手机', true, 'peer')).toThrow('配对码无效')
    expect(readFileSync(path.join(directory, 'client-access.json'), 'utf8')).not.toContain(
      device.token,
    )
    const restored = new ClientAccessService(repository, 9120)
    expect(restored.identify(device.token)?.id).toBe(device.deviceId)
    restored.revoke(device.deviceId)
    expect(restored.identify(device.token)).toBeUndefined()
  })

  it('过期配对码不能使用，已签发设备同样有有效期', () => {
    vi.useFakeTimers()
    const pairing = access.createPairing()
    vi.advanceTimersByTime(300_001)
    expect(() => access.pair(pairing.code, '手机', false, 'peer')).toThrow('配对码无效')
    const device = access.pair(access.createPairing().code, '手机', false, 'peer')
    vi.advanceTimersByTime(86400_001)
    expect(access.identify(device.token)).toBeUndefined()
  })

  it('Cookie 写入要求同源，显式管理凭据可用于受信任客户端', () => {
    const device = access.pair(access.createPairing().code, '手机', true, 'peer')
    const request = (origin?: string) =>
      new Request('http://host:9122/api/configs', {
        method: 'PUT',
        headers: { cookie: `infos_device=${device.token}`, ...(origin ? { origin } : {}) },
      })
    expect(access.authenticate(request())).toBeUndefined()
    expect(access.authenticate(request('http://other'))).toBeUndefined()
    expect(access.authenticate(request('http://host:9122'))?.id).toBe(device.deviceId)
    const local = repository.load(false).localToken
    expect(
      access.authenticate(
        new Request('http://host:9120/api/configs', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${local}` },
        }),
      )?.admin,
    ).toBe(true)
  })

  it('浏览器配对默认不回传令牌，普通设备不能管理授权', async () => {
    const app = new Hono().route('/api/client-access', createClientAccessRouter(access))
    const code = access.createPairing().code
    const response = await app.request('http://host/api/client-access/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://host' },
      body: JSON.stringify({ code, name: '测试手机', remember: true }),
    })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') || ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect((await response.json()).data.token).toBeUndefined()
    const denied = await app.request('http://host/api/client-access', { headers: { cookie } })
    expect(denied.status).toBe(403)
  })

  it('原生配对显式兑换设备 Bearer，界面与后台复用同一身份', async () => {
    const app = new Hono().route('/api/client-access', createClientAccessRouter(access))
    const response = await app.request('http://host/api/client-access/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: access.createPairing().code,
        name: 'PeroperoChat',
        credentialMode: 'bearer',
      }),
    })
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(access.identify(data.token)?.id).toBe(data.deviceId)
    expect(access.identify(data.token)?.admin).toBe(false)
    expect(response.headers.get('cache-control')).toBe('no-store')
    access.revoke(data.deviceId)
    expect(access.identify(data.token)).toBeUndefined()
  })

  it('配对接口拒绝跨站登录，连续失败会限流', async () => {
    const app = new Hono().route('/api/client-access', createClientAccessRouter(access))
    const code = access.createPairing().code
    const response = await app.request('http://host/api/client-access/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://other' },
      body: JSON.stringify({ code }),
    })
    expect(response.status).toBe(403)
    for (let count = 0; count < 8; count++)
      expect(() => access.pair('错误配对码', '手机', true, 'peer')).toThrow('配对码无效')
    expect(() => access.pair(code, '手机', true, 'peer')).toThrow('尝试过于频繁')
  })

  it('监听开关串行应用，端口冲突不会留下已开放的假状态', async () => {
    const stop = vi.fn(async () => {})
    await access.attachListener(async (port) => {
      if (port === 9999) throw new Error('端口已占用')
      return stop
    })
    await access.configure(true, 9122)
    expect(access.status().listening).toBe(true)
    await expect(access.configure(true, 9999)).rejects.toThrow('端口已占用')
    expect(stop).toHaveBeenCalledOnce()
    expect(access.status()).toMatchObject({ enabled: false, listening: false })
    await access.configure(true, 9122)
    await access.configure(false, 9122)
    expect(access.status().listening).toBe(false)
  })
})
