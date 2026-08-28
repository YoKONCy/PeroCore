import type { BrowserWindow } from 'electron'

export function toggleWindowMaximized(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  if (!win.isMaximized()) {
    win.maximize()
    return true
  }
  win.unmaximize()
  return false
}
