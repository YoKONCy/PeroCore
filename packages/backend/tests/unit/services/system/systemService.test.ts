import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppError } from '@perocore/backend/lib/appError'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import { SystemService } from '@perocore/backend/services/system/systemService'

type PathResolverMock = {
  resolve: ReturnType<typeof vi.fn>
  getRoot: ReturnType<typeof vi.fn>
}

describe('SystemService', () => {
  const originalPlatform = process.platform
  const child = { unref: vi.fn() }
  let pathResolver: PathResolverMock
  let service: SystemService

  beforeEach(() => {
    vi.clearAllMocks()
    spawnMock.mockReturnValue(child)
    pathResolver = {
      resolve: vi.fn((value: string) => value),
      getRoot: vi.fn((prefix: string) => {
        const roots: Record<string, string> = {
          '@app': 'C:/pero/app',
          '@data': 'C:/pero/data',
          '@temp': 'C:/pero/temp',
          '@workshop': 'C:/pero/workshop',
        }
        return roots[prefix]
      }),
    }
    service = new SystemService(pathResolver as never)
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  describe('openPath', () => {
    it('应当解析允许范围内的路径并通过参数数组打开', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      pathResolver.resolve.mockReturnValue('C:/pero/data/logs')

      await service.openPath('@data/logs')

      expect(pathResolver.resolve).toHaveBeenCalledWith('@data/logs')
      expect(spawnMock).toHaveBeenCalledWith('explorer.exe', ['C:\\pero\\data\\logs'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      expect(child.unref).toHaveBeenCalledOnce()
    })

    it('应当在 macOS 平台使用 open 命令', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      pathResolver.resolve.mockReturnValue('C:/pero/app')

      await service.openPath('@app')

      expect(spawnMock).toHaveBeenCalledWith('open', ['C:\\pero\\app'], expect.any(Object))
    })

    it('应当在 Linux 平台使用 xdg-open 命令', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      pathResolver.resolve.mockReturnValue('C:/pero/temp/cache')

      await service.openPath('@temp/cache')

      expect(spawnMock).toHaveBeenCalledWith(
        'xdg-open',
        ['C:\\pero\\temp\\cache'],
        expect.any(Object),
      )
    })

    it('路径为空时应当抛出缺少字段错误', async () => {
      await expect(service.openPath('   ')).rejects.toMatchObject({
        code: 'MISSING_FIELD',
        message: '缺少 path 参数',
        data: { field: 'path' },
      } satisfies Partial<AppError>)
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('路径越出允许根目录时应当抛出禁止访问错误', async () => {
      pathResolver.resolve.mockReturnValue('C:/secret/file.txt')

      await expect(service.openPath('C:/secret/file.txt')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: '目标路径不在允许访问范围内',
        data: { field: 'path' },
      } satisfies Partial<AppError>)
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })
})
