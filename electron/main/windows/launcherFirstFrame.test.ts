import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})
import { ipcMain } from 'electron'
import { waitForLauncherFirstFrame } from './launcherFirstFrame'

function fakeWindow() {
  const contents = Object.assign(new EventEmitter(), { mainFrame: {} })
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
  return { contents, win, window: win as unknown as BrowserWindow }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  ipcMain.removeAllListeners()
  vi.useRealTimers()
})

describe('Launcher 首帧握手', () => {
  it('其他窗口与子框架不能代替目标启动器上报首帧', async () => {
    const target = fakeWindow(),
      other = fakeWindow()
    const pending = waitForLauncherFirstFrame(() => target.window, new AbortController().signal)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    ipcMain.emit('startup:launcher-ready', {
      sender: other.contents,
      senderFrame: other.contents.mainFrame,
    })
    ipcMain.emit('startup:launcher-ready', { sender: target.contents, senderFrame: {} })
    target.contents.emit('did-finish-load')
    target.win.emit('ready-to-show')
    await Promise.resolve()
    expect(settled).toBe(false)
    ipcMain.emit('startup:launcher-ready', {
      sender: target.contents,
      senderFrame: target.contents.mainFrame,
    })
    expect(await pending).toBe(target.window)
    expect(ipcMain.listenerCount('startup:launcher-ready')).toBe(0)
    expect(target.contents.listenerCount('did-fail-load')).toBe(0)
  })

  it('主框架加载失败会立即结束等待并移除监听', async () => {
    const target = fakeWindow()
    const pending = waitForLauncherFirstFrame(() => target.window, new AbortController().signal)
    const failed = expect(pending).rejects.toThrow('startup-launcher-load')
    target.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true)
    await failed
    expect(ipcMain.listenerCount('startup:launcher-ready')).toBe(0)
  })

  it('超时不会把尚未准备好的页面算作成功', async () => {
    const target = fakeWindow()
    const pending = waitForLauncherFirstFrame(
      () => target.window,
      new AbortController().signal,
      1000,
    )
    const failed = expect(pending).rejects.toThrow('startup-launcher-frame-timeout')
    await vi.advanceTimersByTimeAsync(1000)
    await failed
    expect(ipcMain.listenerCount('startup:launcher-ready')).toBe(0)
  })

  it('退出时清理首帧等待，迟到消息无效', async () => {
    const target = fakeWindow(),
      controller = new AbortController()
    const pending = waitForLauncherFirstFrame(() => target.window, controller.signal)
    const aborted = expect(pending).rejects.toThrow('startup-aborted')
    controller.abort()
    await aborted
    expect(ipcMain.listenerCount('startup:launcher-ready')).toBe(0)
    expect(target.win.listenerCount('closed')).toBe(0)
  })
})
