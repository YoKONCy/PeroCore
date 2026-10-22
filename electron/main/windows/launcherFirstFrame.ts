import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'

/** 等待真实 Launcher Vue 首帧，DOM 加载和十秒兜底都不能替代此握手。 */
export function waitForLauncherFirstFrame(
  create: () => BrowserWindow,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    let launcher: BrowserWindow | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.off('startup:launcher-ready', onReady)
      signal.removeEventListener('abort', onAbort)
      launcher?.off('closed', onClosed)
      launcher?.webContents.off('did-fail-load', onLoadFailed)
      launcher?.webContents.off('render-process-gone', onGone)
      if (error) reject(error)
      else resolve(launcher!)
    }
    const onReady = (event: IpcMainEvent) => {
      if (
        !launcher ||
        launcher.isDestroyed() ||
        event.sender !== launcher.webContents ||
        event.senderFrame !== launcher.webContents.mainFrame
      )
        return
      finish()
    }
    const onAbort = () => finish(new Error('startup-aborted'))
    const onClosed = () => finish(new Error('startup-launcher-closed'))
    const onGone = () => finish(new Error('startup-launcher-renderer-gone'))
    const onLoadFailed = (
      _event: Electron.Event,
      code: number,
      description: string,
      _url: string,
      main: boolean,
    ) => {
      if (main && code !== -3) finish(new Error(`startup-launcher-load:${code}:${description}`))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    // 先订阅再创建，避免快速加载时首帧消息先于监听器到达。
    ipcMain.on('startup:launcher-ready', onReady)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      launcher = create()
      launcher.once('closed', onClosed)
      launcher.webContents.on('did-fail-load', onLoadFailed)
      launcher.webContents.once('render-process-gone', onGone)
      timer = setTimeout(() => finish(new Error('startup-launcher-frame-timeout')), timeoutMs)
      timer.unref()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
