import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const { buildWithResourceRetry } = createRequire(import.meta.url)(
  '../../../../../../scripts/build-electron-release.cjs',
)

describe('Windows 发行构建资源锁重试', () => {
  it('资源编辑短暂失败后等待并重新打包', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        output: 'rcedit-x64.exe: Fatal error: Unable to commit changes',
      })
      .mockResolvedValueOnce({ code: 0, output: '完成' })
    const wait = vi.fn().mockResolvedValue(undefined)
    const report = vi.fn()
    expect(await buildWithResourceRetry(run, wait, report)).toBe(0)
    expect(run).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(10_000)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('普通构建错误保留退出码且不重试', async () => {
    const run = vi.fn().mockResolvedValue({ code: 7, output: '构建失败：缺少资源文件' })
    const wait = vi.fn()
    expect(await buildWithResourceRetry(run, wait, vi.fn())).toBe(7)
    expect(run).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('资源持续不可写时最多尝试三次并返回失败', async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, output: 'rcedit: Unable to load file' })
    const wait = vi.fn().mockResolvedValue(undefined)
    expect(await buildWithResourceRetry(run, wait, vi.fn())).toBe(1)
    expect(run).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })
})
