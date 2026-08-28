import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageCacheManager } from '@infos/social/runtime/imageCacheManager'

describe('ImageCacheManager', () => {
  let root: string
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    root = join(tmpdir(), `infos-image-cache-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('应当下载远程图片、命中缓存并读取 data URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('图片').buffer),
    })
    globalThis.fetch = fetchMock as never
    const manager = new ImageCacheManager({ cacheDir: root })

    const first = await manager.download('https://example.com/a.png')
    const second = await manager.download('https://example.com/a.png')
    const dataUrl = manager.readAsDataUrl(first!)

    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toMatch(/\.png$/)
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('应当在 HTTP 失败、fetch 异常或文件不存在时返回 null', async () => {
    const manager = new ImageCacheManager({ cacheDir: root })

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as never
    await expect(manager.download('https://example.com/missing.jpg')).resolves.toBeNull()

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('网络失败')) as never
    await expect(manager.download('https://example.com/error.gif')).resolves.toBeNull()

    expect(manager.readAsDataUrl(join(root, 'missing.jpg'))).toBeNull()
  })

  it('应当推断常见图片扩展名并为未知格式使用 jpg', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('x').buffer),
    })
    globalThis.fetch = fetchMock as never
    const manager = new ImageCacheManager({ cacheDir: root, maxFiles: 10 })

    const gif = await manager.download('https://example.com/a.gif')
    const webp = await manager.download('https://example.com/a.webp')
    const jpg = await manager.download('https://example.com/a.unknown')

    expect(gif).toMatch(/\.gif$/)
    expect(webp).toMatch(/\.webp$/)
    expect(jpg).toMatch(/\.jpg$/)
    expect(manager.readAsDataUrl(gif!)).toMatch(/^data:image\/gif;base64,/)
    expect(manager.readAsDataUrl(webp!)).toMatch(/^data:image\/webp;base64,/)
  })

  it('应当在超过最大缓存文件数时清理旧文件', async () => {
    mkdirSync(root, { recursive: true })
    const oldFile = join(root, 'old.jpg')
    writeFileSync(oldFile, 'old')
    const oldTime = new Date(Date.now() - 60_000)
    await new Promise((resolve) => setTimeout(resolve, 5))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('new').buffer),
    } as never)

    const manager = new ImageCacheManager({ cacheDir: root, maxFiles: 1 })
    expect(statSync(oldFile).mtimeMs).toBeGreaterThan(0)
    await manager.download('https://example.com/new.png')

    const files = readdirSync(root)
    expect(files).toHaveLength(1)
    expect(files[0]).not.toBe('old.jpg')
    expect(oldTime).toBeInstanceOf(Date)
  })
})
