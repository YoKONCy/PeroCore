import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { isApplicationFocused } from './notificationVisibility'

vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: vi.fn() } }))
beforeEach(() => vi.resetAllMocks())
function focus(hash: string, minimized = false) {
  vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => minimized,
    webContents: { getURL: () => `http://127.0.0.1:7359/${hash}` },
  } as never)
}
describe('系统通知的前台应用判断', () => {
  it('主应用及其子应用标签共用宿主窗口时抑制通知', () => {
    focus('#/app')
    expect(isApplicationFocused()).toBe(true)
    focus('#/app?view=workspace')
    expect(isApplicationFocused()).toBe(true)
  })
  it('启动器、桌宠、最小化或其他软件在前台时允许通知', () => {
    for (const hash of ['#/launcher', '#/pet-3d']) {
      focus(hash)
      expect(isApplicationFocused()).toBe(false)
    }
    focus('#/app', true)
    expect(isApplicationFocused()).toBe(false)
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
    expect(isApplicationFocused()).toBe(false)
  })
})
