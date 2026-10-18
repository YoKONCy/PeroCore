import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLauncher } from '@infos/frontend/composables/launcher/useLauncher'

const mocks = vi.hoisted(() => ({ health: vi.fn(), invoke: vi.fn() }))
vi.mock('@infos/frontend/api/modules/systemApi', () => ({ systemApi: { health: mocks.health } }))
vi.mock('@infos/frontend/utils/ipcAdapter', () => ({
  isElectron: () => true,
  invoke: mocks.invoke,
}))
vi.mock('@infos/frontend/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.health.mockResolvedValue({ data: { status: 'ok' } })
  mocks.invoke.mockResolvedValue(undefined)
})

describe('启动器统一启动方式', () => {
  it.each([
    ['pet', 'open-pet-window'],
    ['app', 'open-dashboard-window'],
  ] as const)('%s 模式在打开目标窗口前隐藏启动器', async (mode, channel) => {
    const launcher = useLauncher()
    expect(await launcher.enterApp(mode)).toBe(true)
    expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual(['hide-launcher', channel])
    expect(launcher.phase.value).toBe('done')
  })

  it('目标窗口创建失败后重新显示启动器，并允许重试', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'open-dashboard-window') throw new Error('窗口不可用')
    })
    const launcher = useLauncher()
    expect(await launcher.enterApp('app')).toBe(false)
    expect(launcher.phase.value).toBe('ready')
    expect(mocks.invoke).toHaveBeenLastCalledWith('window-show')
  })
})
