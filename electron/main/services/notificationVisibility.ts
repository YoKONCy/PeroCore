import { BrowserWindow } from 'electron'

/** 用户正在前台使用主应用（含原生子应用标签）时，不再投递系统弹窗。 */
export function isApplicationFocused(): boolean {
  const window = BrowserWindow.getFocusedWindow()
  if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return false
  try {
    return /^#\/app(?:[/?]|$)/.test(new URL(window.webContents.getURL()).hash)
  } catch {
    return false
  }
}
