import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebFrontendService } from '@infos/backend/services/system/webFrontendService'

let directory: string | undefined
afterEach(() => {
  vi.restoreAllMocks()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('主应用网页资源', () => {
  it('生产资源支持模块 Worker，业务路由不回退为 HTML', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'infos-web-'))
    writeFileSync(path.join(directory, 'index.html'), '<main>infOS</main>')
    writeFileSync(path.join(directory, 'pdf.worker.mjs'), 'export {}')
    const service = new WebFrontendService(directory)
    expect(await service.response(new Request('http://host/api/missing'))).toBeUndefined()
    const worker = await service.response(new Request('http://host/pdf.worker.mjs'))
    expect(worker?.headers.get('content-type')).toContain('javascript')
    expect(await (await service.response(new Request('http://host/')))?.text()).toContain('infOS')
  })

  it('开发时优先当前 Vite，禁止未配对设备读取后台绝对路径', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'infos-web-'))
    const root = path.join(directory, 'packages', 'frontend', 'dist')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'index.html'), '旧构建')
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('当前开发页面'))
    const service = new WebFrontendService(root, 'http://127.0.0.1:7359', () => false)
    const forbidden = path
      .join(directory, 'packages', 'backend', 'src', 'container.ts')
      .replaceAll('\\', '/')
    expect((await service.response(new Request(`http://host/@fs/${forbidden}`)))?.status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await (await service.response(new Request('http://host/')))?.text()).toBe('当前开发页面')
  })
})
