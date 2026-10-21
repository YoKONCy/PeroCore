import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProactiveService } from '../../../src/services/companion/proactiveService'

const services: ProactiveService[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
})
afterEach(async () => {
  for (const service of services.splice(0)) await service.shutdown()
  vi.useRealTimers()
  vi.clearAllMocks()
})
type Target = {
  id: string
  agentId: string
  channel: string
  purpose: string
  status: string
  interactionMode: string
}
function fixture(store = new Map<string, string>()) {
  const enabled = ['nana', 'pero']
  const threads = new Map<string, Target>(
    enabled.map((agentId) => [
      agentId,
      {
        id: `${agentId}-first`,
        agentId,
        channel: 'desktop',
        purpose: 'conversation',
        status: 'active',
        interactionMode: 'minimal',
      },
    ]),
  )
  const config = {
    getJson: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : undefined),
    set: async (key: string, value: string) => {
      store.set(key, value)
    },
  }
  const deps = {
    listAgents: vi.fn(() => enabled),
    resolveThread: vi.fn(async (agentId: string) => {
      const thread = threads.get(agentId)
      if (!thread) throw new Error('本轮会话暂时无法取得')
      return thread
    }),
    isBusy: vi.fn((_agentId: string) => false),
    run: vi.fn(
      async (_input: {
        signal: AbortSignal
        content: string
        thread: {
          id: string
          agentId: string
          channel: string
          purpose?: string
          status?: string
          interactionMode?: string
        }
      }) => '主动回复',
    ),
    changed: vi.fn(async () => {}),
  }
  const service = new ProactiveService(config as never)
  services.push(service)
  return { service, deps, store, enabled, threads }
}

describe('全局互斥主动行为', () => {
  it('默认关闭；无需选择角色或会话，开启后轮转所有已启用角色', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(f.deps.run).not.toHaveBeenCalled()
    await f.service.configure({ mode: 'autonomous', autonomousIntervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 100)
    expect(f.deps.run.mock.calls.map(([input]) => input.thread.agentId)).toEqual(['nana', 'pero'])
    expect(f.deps.run.mock.calls[0]![0].content).toContain('联网搜索')
    expect(f.service.getState().settings.mode).toBe('autonomous')
    expect(f.service.getState().agentId).toBeNull()
  })

  it('旧版会话与信息源设置在恢复时清除，不依赖旧会话是否存在', async () => {
    const store = new Map([
      [
        'proactive.settings',
        JSON.stringify({
          mode: 'autonomous',
          autonomousIntervalMinutes: 1,
          threadId: 'deleted',
          watchUrls: ['https://unused.test/'],
        }),
      ],
      [
        'proactive.state',
        JSON.stringify({
          watches: [{ url: 'https://unused.test/', hash: 'old' }],
          agentId: 'deleted-role',
        }),
      ],
    ])
    const f = fixture(store)
    await f.service.initialize(f.deps)
    expect(f.service.getState().settings.mode).toBe('autonomous')
    expect(store.get('proactive.settings')).not.toContain('threadId')
    expect(store.get('proactive.settings')).not.toContain('watchUrls')
    expect(store.get('proactive.state')).not.toContain('watches')
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.deps.run).toHaveBeenCalledOnce()
    await f.service.shutdown()
    const restarted = fixture(store)
    await restarted.service.initialize(restarted.deps)
    await vi.advanceTimersByTimeAsync(60_100)
    expect(restarted.deps.run).toHaveBeenCalledOnce()
    expect(restarted.deps.run.mock.calls[0]![0].thread.agentId).toBe('pero')
  })

  it('每次自动取得执行会话，不固定到旧 Thread，也不改变会话工具模式', async () => {
    const f = fixture()
    f.enabled.splice(1)
    await f.service.initialize(f.deps)
    await f.service.configure({ mode: 'autonomous', autonomousIntervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(60_100)
    f.threads.set('nana', { ...f.threads.get('nana')!, id: 'nana-new', interactionMode: 'work' })
    await vi.advanceTimersByTimeAsync(60_100)
    expect(
      f.deps.run.mock.calls.map(([input]) => [input.thread.id, input.thread.interactionMode]),
    ).toEqual([
      ['nana-first', 'minimal'],
      ['nana-new', 'work'],
    ])
    f.threads.delete('nana')
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.service.getState().settings.mode).toBe('autonomous')
    f.threads.set('nana', {
      id: 'nana-recreated',
      agentId: 'nana',
      channel: 'desktop',
      purpose: 'conversation',
      status: 'active',
      interactionMode: 'chat',
    })
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.deps.run.mock.lastCall?.[0].thread.id).toBe('nana-recreated')
  })

  it('全局切换取消旧回合，旧角色 API 不能创建独立开关', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    f.deps.run.mockImplementationOnce(
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    await f.service.configure({ companionIntervalMinutes: 1, autonomousIntervalMinutes: 1 })
    await f.service.start('nana')
    expect(f.service.listStates(['nana', 'pero'])).toEqual([
      { agentId: 'nana', enabled: true },
      { agentId: 'pero', enabled: true },
    ])
    await vi.advanceTimersByTimeAsync(60_100)
    await f.service.configure({ mode: 'autonomous' })
    expect(f.deps.run.mock.calls[0]![0].signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.deps.run).toHaveBeenCalledTimes(2)
    await f.service.stop('pero')
    expect(f.service.getState().settings.mode).toBe('off')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(f.deps.run).toHaveBeenCalledTimes(2)
  })

  it('忙碌角色不抢占，启用角色集合变化无需重新保存全局模式', async () => {
    const f = fixture()
    f.deps.isBusy.mockImplementation((id) => id === 'nana')
    await f.service.initialize(f.deps)
    await f.service.configure({ mode: 'autonomous', autonomousIntervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.deps.run.mock.lastCall?.[0].thread.agentId).toBe('pero')
    f.enabled.splice(0)
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.service.getState().settings.mode).toBe('autonomous')
    expect(f.deps.run).toHaveBeenCalledOnce()
    f.enabled.push('nana')
    f.deps.isBusy.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(60_100)
    expect(f.deps.run.mock.lastCall?.[0].thread.agentId).toBe('nana')
  })

  it('用户在同一角色的另一会话发言，也会等主动回合退出再继续', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    f.deps.run.mockImplementationOnce(
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    await f.service.configure({ mode: 'autonomous', autonomousIntervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(60_100)
    await f.service.notifyActivity('nana', 'another-thread')
    expect(f.deps.run.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(f.service.getState().phase).toBe('waiting')
  })

  it('解析执行会话期间也可取消，不会留下随后启动的幽灵回合', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    await f.service.configure({ mode: 'companion', companionIntervalMinutes: 1 })
    let resolve!: (thread: Target) => void
    f.deps.resolveThread.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await vi.advanceTimersByTimeAsync(60_100)
    let finished = false
    const activity = f.service.notifyActivity('nana', 'another').then(() => {
      finished = true
    })
    expect(finished).toBe(false)
    resolve(f.threads.get('nana')!)
    await activity
    expect(f.deps.run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('全局预算跨角色合计，立即唤醒不能绕过，第二天自动恢复', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    await f.service.configure({
      mode: 'autonomous',
      autonomousIntervalMinutes: 1,
      maxDailyRuns: 2,
      timeZone: 'UTC',
    })
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 100)
    await f.service.checkNow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.deps.run).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    await f.service.checkNow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.deps.run).toHaveBeenCalledTimes(3)
    expect(f.service.getState().dailyRuns).toBe(1)
  })

  it('单个角色失败不关闭全局模式，其他角色仍轮转；陪伴超过五次仍渐进冷却', async () => {
    const f = fixture()
    await f.service.initialize(f.deps)
    f.deps.run.mockRejectedValueOnce(new Error('上游连接失败'))
    await f.service.configure({ mode: 'autonomous', autonomousIntervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 100)
    expect(f.deps.run.mock.lastCall?.[0].thread.agentId).toBe('pero')
    expect(f.service.getState().recent[0]?.error).toBe('上游连接失败')
    const companion = fixture()
    companion.enabled.splice(1)
    await companion.service.initialize(companion.deps)
    await companion.service.configure({
      mode: 'companion',
      companionIntervalMinutes: 1,
      timeZone: 'UTC',
    })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(companion.deps.run.mock.calls.length).toBeGreaterThan(5)
  })
})
