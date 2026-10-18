// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMainNav } from '../../../src/composables/main/useMainNav'
import type { TabModule } from '../../../src/composables/main/tabRegistry'

const api = vi.hoisted(() => ({ preload: vi.fn(), toast: vi.fn() }))
vi.mock('../../../src/composables/main/tabRegistry', () => ({ preloadTab: api.preload }))
vi.mock('../../../src/utils/ipcAdapter', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('../../../src/stores/useNotificationStore', () => ({
  useNotificationStore: () => ({ toast: api.toast }),
}))

function deferred() {
  let resolve!: (value: TabModule) => void
  const promise = new Promise<TabModule>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(async () => {
  const nav = useMainNav()
  nav.currentTab.value = 'chat'
  await nav.setTab('chat')
  api.preload.mockReset().mockResolvedValue({ default: {} })
  api.toast.mockClear()
})

describe('导航加载与切换意图', () => {
  it('加载中点回当前页会取消意图，旧模块完成后不能再次跳走', async () => {
    const loader = deferred()
    api.preload.mockReturnValueOnce(loader.promise)
    const nav = useMainNav()
    const switching = nav.setTab('workspace')
    expect(nav.pendingTab.value).toBe('workspace')
    await nav.setTab('chat')
    expect(nav.pendingTab.value).toBe('')
    loader.resolve({ default: {} })
    await switching
    expect(nav.currentTab.value).toBe('chat')
  })

  it('连续点击只提交最后一个目标，失败则保留原页并结束过渡', async () => {
    const older = deferred(),
      newer = deferred()
    api.preload.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const nav = useMainNav()
    const first = nav.setTab('workspace')
    const last = nav.setTab('overview')
    newer.resolve({ default: {} })
    await last
    older.resolve({ default: {} })
    await first
    expect(nav.currentTab.value).toBe('overview')
    api.preload.mockRejectedValueOnce(new Error('模块加载失败'))
    await nav.setTab('logs')
    expect(nav.currentTab.value).toBe('overview')
    expect(nav.pendingTab.value).toBe('')
    expect(api.toast).toHaveBeenCalledWith('模块加载失败', { type: 'error' })
  })
})
