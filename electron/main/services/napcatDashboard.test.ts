import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearStorageData: vi.fn(),
  clearCache: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: {},
  app: {},
  session: {
    fromPartition: () => ({
      clearStorageData: mocks.clearStorageData,
      clearCache: mocks.clearCache,
    }),
  },
}))
vi.mock('../windows/desktopTabs', () => ({ desktopTabs: {} }))
vi.mock('./napcat', () => ({
  getNapCatStatus: vi.fn(),
  getNapCatDashboardEndpoint: vi.fn(),
  startNapCat: vi.fn(),
}))
vi.mock('../utils/logger', () => ({ logger: { warn: mocks.warn } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.clearStorageData.mockResolvedValue(undefined)
  mocks.clearCache.mockResolvedValue(undefined)
})

describe('NapCat 管理分区缓存交接', () => {
  it('同一来源合并清理，仅移除程序缓存，保留所有认证存储', async () => {
    const { prepareDashboardSession } = await import('./napcatDashboard')
    const endpoint = new URL('http://127.0.0.1:6099/webui/?token=测试凭据')
    await Promise.all([prepareDashboardSession(endpoint), prepareDashboardSession(endpoint)])
    expect(mocks.clearStorageData).toHaveBeenCalledExactlyOnceWith({
      origin: endpoint.origin,
      storages: ['serviceworkers', 'cachestorage'],
    })
    expect(mocks.clearCache).toHaveBeenCalledOnce()
  })

  it('缓存清理失败不阻断管理页，后续可再次尝试', async () => {
    mocks.clearStorageData.mockRejectedValueOnce(new Error('缓存暂时被占用'))
    const { prepareDashboardSession } = await import('./napcatDashboard')
    const endpoint = new URL('http://127.0.0.1:6099/webui/')
    await expect(prepareDashboardSession(endpoint)).resolves.toBeUndefined()
    expect(mocks.warn).toHaveBeenCalledOnce()
    expect(mocks.clearCache).toHaveBeenCalledOnce()
    await prepareDashboardSession(endpoint)
    expect(mocks.clearStorageData).toHaveBeenCalledTimes(2)
  })
})
