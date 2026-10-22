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
  it('失败后重试会再次请求启动后端，诊断日志不进入检测卡片', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'start-backend') return { ready: false, attempted: true }
      if (channel === 'get-backend-logs') {
        return {
          error: '后端已退出',
          logTail: 'SQLITE_CANTOPEN\n迁移诊断详情',
          logPath: '诊断日志路径',
        }
      }
    })
    const launcher = useLauncher()
    await launcher.startLaunch()
    expect(launcher.diagnostic.value?.logTail).toContain('SQLITE_CANTOPEN')
    expect(launcher.errorMessage.value).not.toContain('SQLITE_CANTOPEN')
    expect(launcher.checks.value[0]?.message).not.toContain('SQLITE_CANTOPEN')
    await launcher.startLaunch()
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'start-backend')).toHaveLength(2)
  })

  it('超长原始异常只保留在限长诊断中，主界面保持固定提示', async () => {
    mocks.invoke.mockRejectedValue(new Error('\u001b[31mEACCES\u001b[0m\n' + '堆栈'.repeat(20_000)))
    const launcher = useLauncher()
    await launcher.startLaunch()
    expect(launcher.errorMessage.value).toBe('暂时无法启动')
    expect(launcher.errorHint.value).not.toContain('EACCES')
    expect(launcher.diagnostic.value?.error.length).toBeLessThanOrEqual(2000)
    expect(launcher.phase.value).toBe('checking')
  })

  it('并发重试只提交一次启动请求', async () => {
    let resolveStart!: (value: unknown) => void
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'start-backend'
        ? new Promise((resolve) => {
            resolveStart = resolve
          })
        : Promise.resolve({ error: '后端已退出' }),
    )
    const launcher = useLauncher()
    const first = launcher.startLaunch()
    const second = launcher.startLaunch()
    resolveStart({ ready: false, attempted: true })
    await Promise.all([first, second])
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'start-backend')).toHaveLength(1)
  })

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
