// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeOnboarding,
  loadOnboardingFlow,
  queueDesktopOnboarding,
  ONBOARDING_KEY,
} from '@infos/frontend/composables/launcher/onboardingFlow'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), base: vi.fn() }))
vi.mock('@infos/frontend/api/modules/configApi', () => ({
  configApi: { get: mocks.get, set: mocks.set },
}))
vi.mock('@infos/frontend/api/transport', () => ({ getApiBaseUrl: mocks.base }))
vi.mock('@infos/frontend/lib/logger', () => ({ logger: { warn: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocks.base.mockReturnValue('http://127.0.0.1:9120/api')
  mocks.get.mockResolvedValue({ data: { value: null } })
  mocks.set.mockResolvedValue({ data: undefined })
})

describe('两段式教程进度', () => {
  it('新用户从启动器开始，旧版已完成用户不被强制重播', async () => {
    expect((await loadOnboardingFlow()).stage).toBe('launcher')
    mocks.get.mockResolvedValueOnce({ data: { value: 'launcher_done' } })
    expect((await loadOnboardingFlow()).stage).toBe('completed')
  })

  it('启动前保存桌面接续请求，完成后才标记整个教程结束', async () => {
    const request = await queueDesktopOnboarding()
    expect(request.stage).toBe('desktop')
    expect(mocks.set).toHaveBeenCalledWith(ONBOARDING_KEY, JSON.stringify(request))
    expect(await loadOnboardingFlow()).toEqual(request)
    await completeOnboarding(request.runId)
    expect(await loadOnboardingFlow()).toMatchObject({ stage: 'completed', runId: request.runId })
  })

  it('重播有独立编号，旧窗口不能把新一轮教程提前结束', async () => {
    const first = await queueDesktopOnboarding()
    const replay = await queueDesktopOnboarding()
    expect(replay.runId).not.toBe(first.runId)
    await completeOnboarding(first.runId)
    expect(await loadOnboardingFlow()).toEqual(replay)
  })

  it('服务端保存失败仍保留本地进度，刷新后可以接续', async () => {
    mocks.set.mockRejectedValueOnce(new Error('连接中断'))
    const request = await queueDesktopOnboarding()
    mocks.get.mockRejectedValue(new Error('服务暂不可用'))
    expect(await loadOnboardingFlow()).toEqual(request)
  })

  it('不同服务的数据源不共用本地完成状态', async () => {
    await queueDesktopOnboarding()
    mocks.base.mockReturnValue('https://another.example/api')
    expect((await loadOnboardingFlow()).stage).toBe('launcher')
  })

  it('启动期间的旧读取响应不能覆盖新发起的桌面导览', async () => {
    let resolve!: (response: { data: { value: string } }) => void
    mocks.get.mockReturnValueOnce(
      new Promise((response) => {
        resolve = response
      }),
    )
    const loading = loadOnboardingFlow()
    const request = await queueDesktopOnboarding()
    resolve({ data: { value: 'launcher_done' } })
    expect(await loading).toEqual(request)
  })
})
