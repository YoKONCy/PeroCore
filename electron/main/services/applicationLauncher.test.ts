import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { openPath: vi.fn().mockResolvedValue('') },
}))
vi.mock('./desktopAutomation', () => ({
  listWindows: vi.fn().mockResolvedValue([]),
  activateWindow: vi.fn().mockResolvedValue(''),
}))

import {
  launchApplication,
  rankApplications,
  type InstalledApplication,
} from './applicationLauncher'

const applications: InstalledApplication[] = [
  { name: 'Microsoft Edge', appId: 'Microsoft.MicrosoftEdge_8wekyb3d8bbwe!App' },
  { name: 'Microsoft Store', appId: 'Microsoft.WindowsStore_8wekyb3d8bbwe!App' },
  { name: 'Visual Studio Code', appId: 'Visual Studio Code' },
]

function createDeps(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'win32' as const,
    discoverApplications: vi.fn().mockResolvedValue(applications),
    listWindows: vi.fn().mockResolvedValue([]),
    activateWindow: vi.fn().mockResolvedValue(''),
    openPath: vi.fn().mockResolvedValue(''),
    launchAumid: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('applicationLauncher', () => {
  it('应优先返回精确名称匹配并稳定排序', () => {
    expect(rankApplications('Microsoft Edge', applications)[0]?.name).toBe('Microsoft Edge')
    expect(rankApplications('Microsoft', applications).map((item) => item.name)).toEqual([
      'Microsoft Edge',
      'Microsoft Store',
    ])
  })

  it('应用已有窗口时应优先激活而非重复启动', async () => {
    const deps = createDeps({
      listWindows: vi
        .fn()
        .mockResolvedValue([{ processName: 'Code', title: '项目 - Visual Studio Code' }]),
      activateWindow: vi.fn().mockResolvedValue('项目 - Visual Studio Code'),
    })

    const result = await launchApplication('Visual Studio Code', deps)

    expect(result).toEqual({
      success: true,
      application: '项目 - Visual Studio Code',
      mode: 'activated',
      targetType: 'window',
    })
    expect(deps.activateWindow).toHaveBeenCalledWith('项目 - Visual Studio Code')
    expect(deps.launchAumid).not.toHaveBeenCalled()
  })

  it('唯一精确匹配时应按AUMID启动', async () => {
    const deps = createDeps()

    const result = await launchApplication('Microsoft Edge', deps)

    expect(result.mode).toBe('launched')
    expect(result.targetType).toBe('aumid')
    expect(deps.launchAumid).toHaveBeenCalledWith('Microsoft.MicrosoftEdge_8wekyb3d8bbwe!App')
  })

  it('模糊名称存在多个候选时应拒绝盲目启动', async () => {
    const deps = createDeps()

    await expect(launchApplication('Microsoft', deps)).rejects.toThrow('APPLICATION_AMBIGUOUS')
    expect(deps.launchAumid).not.toHaveBeenCalled()
  })

  it('没有匹配应用时应返回未找到错误', async () => {
    const deps = createDeps()

    await expect(launchApplication('完全不存在', deps)).rejects.toThrow('APPLICATION_NOT_FOUND')
  })

  it('非Windows平台不应猜测执行任意名称', async () => {
    const deps = createDeps({ platform: 'linux' })

    await expect(launchApplication('demo', deps)).rejects.toThrow(
      'APPLICATION_DISCOVERY_UNSUPPORTED',
    )
  })
})
