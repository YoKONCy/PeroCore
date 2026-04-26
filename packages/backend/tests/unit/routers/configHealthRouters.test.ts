import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigRouter } from '@perocore/backend/routers/config.router'
import type { AppContext } from '@perocore/backend/container'

const logTransportState: { transport: unknown } = { transport: null }

vi.mock('@perocore/backend/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getLogFileTransport: () => logTransportState.transport,
}))

import { createHealthRouter } from '@perocore/backend/routers/health.router'

function createConfigContext(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const ctx = {
    configRepo: {
      listAll: vi.fn((prefix = '') =>
        Promise.resolve(
          [...store.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value })),
        ),
      ),
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        store.delete(key)
        return Promise.resolve()
      }),
    },
    reloadEmbeddingConfig: vi.fn().mockResolvedValue(undefined),
    reloadTtsConfig: vi.fn().mockResolvedValue(undefined),
    reloadAsrConfig: vi.fn().mockResolvedValue(undefined),
  }
  return ctx as unknown as AppContext & typeof ctx
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('createConfigRouter', () => {
  it('应当列出配置并按前缀过滤', async () => {
    const ctx = createConfigContext({ 'embedding.model': 'a', 'tts.voice': 'b' })
    const router = createConfigRouter(ctx)

    const response = await router.request('/?prefix=embedding.')
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', message: '获取成功' })
    expect(body.data).toEqual({ items: [{ key: 'embedding.model', value: 'a' }], total: 1 })
  })

  it('应当获取单个配置并在缺失时返回 NOT_CONFIGURED', async () => {
    const ctx = createConfigContext({ theme: 'dark' })
    const router = createConfigRouter(ctx)

    const found = await router.request('/theme')
    const missing = await router.request('/missing')

    expect(await readJson(found)).toEqual({
      code: 'OK',
      message: '获取成功',
      data: { key: 'theme', value: 'dark' },
    })
    expect(missing.status).toBe(200)
    expect(await readJson(missing)).toEqual({
      code: 'NOT_CONFIGURED',
      message: '配置 "missing" 未设置',
      data: { key: 'missing', value: null },
    })
  })

  it('应当设置配置并触发对应服务热更新', async () => {
    const ctx = createConfigContext()
    const router = createConfigRouter(ctx)

    const response = await router.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'embedding.provider', value: 'openai' }),
    })

    expect(response.status).toBe(200)
    expect(ctx.configRepo.set).toHaveBeenCalledWith('embedding.provider', 'openai')
    expect(ctx.reloadEmbeddingConfig).toHaveBeenCalledTimes(1)
    expect(ctx.reloadTtsConfig).not.toHaveBeenCalled()
    expect(await readJson(response)).toEqual({
      code: 'OK',
      message: '配置已更新',
      data: { key: 'embedding.provider', value: 'openai' },
    })
  })

  it('应当删除存在的配置并拒绝删除不存在的配置', async () => {
    const ctx = createConfigContext({ theme: 'dark' })
    const router = createConfigRouter(ctx)

    const deleted = await router.request('/theme', { method: 'DELETE' })
    const missing = await router.request('/theme', { method: 'DELETE' })

    expect(deleted.status).toBe(200)
    expect(await readJson(deleted)).toEqual({ code: 'OK', message: '配置 "theme" 已删除' })
    expect(missing.status).toBe(404)
    expect(await readJson(missing)).toEqual({ code: 'NOT_FOUND', message: '配置 "theme" 不存在' })
  })

  it('应当批量获取和批量设置配置，并合并热更新调用', async () => {
    const ctx = createConfigContext({ a: '1' })
    const router = createConfigRouter(ctx)

    const batchGet = await router.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['a', 'missing'] }),
    })
    const batchSet = await router.request('/batch', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { key: 'tts.voice', value: 'v1' },
          { key: 'tts.speed', value: '1.0' },
          { key: 'asr.model', value: 'm1' },
        ],
      }),
    })

    expect(await readJson(batchGet)).toEqual({
      code: 'OK',
      message: '批量获取成功',
      data: { a: '1', missing: null },
    })
    expect(await readJson(batchSet)).toEqual({
      code: 'OK',
      message: '已更新 3 项配置',
      data: { count: 3 },
    })
    expect(ctx.reloadTtsConfig).toHaveBeenCalledTimes(1)
    expect(ctx.reloadAsrConfig).toHaveBeenCalledTimes(1)
  })

  it('应当导出配置并按覆盖策略导入配置', async () => {
    const ctx = createConfigContext({ a: '1' })
    const router = createConfigRouter(ctx)

    const exported = await router.request('/export', { method: 'POST' })
    const imported = await router.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { a: '2', b: '3' }, overwrite: false }),
    })

    expect(await readJson(exported)).toEqual({
      code: 'OK',
      message: '已导出 1 项配置',
      data: { a: '1' },
    })
    expect(await readJson(imported)).toEqual({
      code: 'OK',
      message: '导入完成: 1 项写入, 1 项跳过',
      data: { imported: 1, skipped: 1 },
    })
    expect(ctx.configRepo.set).toHaveBeenCalledWith('b', '3')
    expect(ctx.configRepo.set).not.toHaveBeenCalledWith('a', '2')
  })
})

describe('createHealthRouter', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-health-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    logTransportState.transport = null
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    logTransportState.transport = null
  })

  it('应当返回健康状态与运行时信息', async () => {
    const router = createHealthRouter()

    const response = await router.request('/')
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', message: '成功' })
    expect(body.data).toMatchObject({
      status: 'ok',
      version: '0.9-rc2',
      platform: process.platform,
      nodeVersion: process.version,
    })
  })

  it('应当在未启用日志文件持久化时返回前置条件失败', async () => {
    const router = createHealthRouter()

    const list = await router.request('/logs')
    const content = await router.request('/logs/app.log')

    expect(list.status).toBe(422)
    expect(await readJson(list)).toEqual({
      code: 'PRECONDITION_FAILED',
      message: '日志文件持久化未启用',
      data: { reason: '未配置日志文件输出' },
    })
    expect(content.status).toBe(422)
    expect(await readJson(content)).toEqual({
      code: 'PRECONDITION_FAILED',
      message: '日志文件持久化未启用',
    })
  })

  it('应当列出日志文件并返回指定日志尾部内容', async () => {
    writeFileSync(join(root, 'app.log'), '一\n二\n三\n')
    writeFileSync(join(root, 'ignore.txt'), '忽略')
    logTransportState.transport = {
      getLogDir: () => root,
      getLogPath: () => join(root, 'app.log'),
    }
    const router = createHealthRouter()

    const list = await router.request('/logs')
    const content = await router.request('/logs/app.log?lines=2')

    expect(await readJson(list)).toMatchObject({
      code: 'OK',
      message: '获取成功',
      data: { logDir: root, currentFile: 'app.log' },
    })
    expect(await readJson(content)).toMatchObject({
      code: 'OK',
      message: '获取成功',
      data: { filename: 'app.log', totalLines: 3, returnedLines: 2, lines: ['二', '三'] },
    })
  })

  it('应当拒绝非法日志文件名并处理缺失文件', async () => {
    logTransportState.transport = {
      getLogDir: () => root,
      getLogPath: () => join(root, 'app.log'),
    }
    const router = createHealthRouter()

    const illegal = await router.request('/logs/..%2Fsecret.log')
    const missing = await router.request('/logs/missing.log')

    expect(illegal.status).toBe(400)
    expect(await readJson(illegal)).toEqual({ code: 'BAD_REQUEST', message: '非法文件名' })
    expect(missing.status).toBe(404)
    expect(await readJson(missing)).toEqual({
      code: 'NOT_FOUND',
      message: '日志文件不存在: missing.log',
    })
  })
})
