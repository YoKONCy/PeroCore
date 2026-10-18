// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, type ComputedRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useWindowVisibility } from '../../../src/composables/main/useWindowVisibility'

const ipc = vi.hoisted(() => ({
  electron: true,
  handler: undefined as ((value: unknown) => void) | undefined,
  invoke: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('../../../src/utils/ipcAdapter', () => ({
  isElectron: () => ipc.electron,
  invoke: ipc.invoke,
  listen: async (_channel: string, handler: (value: unknown) => void) => {
    ipc.handler = handler
    return ipc.stop
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  ipc.handler = undefined
  ipc.invoke.mockReset()
  ipc.stop.mockReset()
  ipc.electron = true
})

function setup() {
  let visible!: ComputedRef<boolean>
  const wrapper = mount(
    defineComponent({
      setup() {
        visible = useWindowVisibility()
        return () => null
      },
    }),
  )
  return {
    wrapper,
    get visible() {
      return visible.value
    },
  }
}

describe('窗口可见性', () => {
  it('透明窗口以宿主显隐为准，不被过期的 document.hidden 锁在暂停状态', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    ipc.invoke.mockResolvedValue(true)
    const state = setup()
    try {
      await flushPromises()
      expect(state.visible).toBe(true)
      ipc.handler?.(false)
      expect(state.visible).toBe(false)
      ipc.handler?.(true)
      expect(state.visible).toBe(true)
    } finally {
      state.wrapper.unmount()
    }
    expect(ipc.stop).toHaveBeenCalledOnce()
  })

  it('较早发出的查询结果不能覆盖较新的隐藏事件', async () => {
    let resolve!: (value: boolean) => void
    ipc.invoke.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done
        }),
    )
    const state = setup()
    try {
      await flushPromises()
      ipc.handler?.(false)
      resolve(true)
      await flushPromises()
      expect(state.visible).toBe(false)
    } finally {
      state.wrapper.unmount()
    }
  })

  it('普通浏览器仍跟随标签页可见性', async () => {
    ipc.electron = false
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const state = setup()
    try {
      expect(state.visible).toBe(true)
      hidden.mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(state.visible).toBe(false)
      expect(ipc.invoke).not.toHaveBeenCalled()
    } finally {
      state.wrapper.unmount()
    }
  })
})
