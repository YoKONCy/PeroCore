import { describe, expect, it, vi } from 'vitest'
import { toggleWindowMaximized } from './windowState'

function createWindow(maximized = false) {
  let state = maximized
  return {
    window: {
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => state),
      maximize: vi.fn(() => {
        state = true
      }),
      unmaximize: vi.fn(() => {
        state = false
      }),
    },
  }
}

describe('toggleWindowMaximized', () => {
  it('普通窗口应交给原生窗口管理器最大化', () => {
    const { window } = createWindow()
    expect(toggleWindowMaximized(window as never)).toBe(true)
    expect(window.maximize).toHaveBeenCalledOnce()
  })

  it('最大化窗口应交给原生窗口管理器还原', () => {
    const { window } = createWindow(true)
    expect(toggleWindowMaximized(window as never)).toBe(false)
    expect(window.unmaximize).toHaveBeenCalledOnce()
  })
})
