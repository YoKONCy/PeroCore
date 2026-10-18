// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import Screen from '../../src/components/workspace/WorkspaceTerminalScreen.vue'

const state = vi.hoisted(() => ({ write: vi.fn(), reset: vi.fn(), dispose: vi.fn() }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = {}
    cols = 120
    rows = 30
    loadAddon() {}
    open() {}
    resize() {}
    onData() {}
    onResize() {}
    attachCustomKeyEventHandler() {}
    write(text: string, done?: () => void) {
      state.write(text)
      done?.()
    }
    reset() {
      state.reset()
    }
    dispose() {
      state.dispose()
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() {
      return undefined
    }
  },
}))

describe('终端渲染资源', () => {
  it('保留窗口向前滑动时只写入新增部分，卸载释放 xterm', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
    const wrapper = mount(Screen, {
      props: {
        output: 'abcdef',
        outputOffset: 0,
        cols: 120,
        rows: 30,
        backend: 'pipe',
        running: true,
      },
    })
    try {
      await flushPromises()
      await wrapper.setProps({ output: 'defghi', outputOffset: 3 })
      expect(state.write.mock.calls.map((call) => call[0])).toEqual(['abcdef', 'ghi'])
      expect(state.reset).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
    expect(state.dispose).toHaveBeenCalledOnce()
  })
})
