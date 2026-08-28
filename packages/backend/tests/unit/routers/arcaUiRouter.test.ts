import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createArcaUiRouter } from '@infos/backend/routers/arcaUi.router'
import { StaticAssetService } from '@infos/backend/services/system/staticAssetService'

describe('createArcaUiRouter', () => {
  let root: string
  let app: Hono

  beforeEach(() => {
    root = join(tmpdir(), `infos-arca-ui-${Date.now()}-${Math.random()}`)
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Arca</title>')
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("Arca")')
    app = new Hono()
    app.route('/applications/arca', createArcaUiRouter(new StaticAssetService(root)))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('应提供入口与带长期缓存的哈希资源', async () => {
    const index = await app.request('/applications/arca/')
    const asset = await app.request('/applications/arca/assets/app.js')

    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(index.headers.get('cache-control')).toBe('no-cache')
    expect(await index.text()).toContain('Arca')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')
  })

  it('不得暴露UI目录以外的文件', async () => {
    const response = await app.request('/applications/arca/%2e%2e/host.mjs')
    expect([403, 404]).toContain(response.status)
  })

  it('资源不存在时应返回404', async () => {
    const response = await app.request('/applications/arca/assets/missing.js')
    expect(response.status).toBe(404)
  })
})
