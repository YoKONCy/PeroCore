/**
 * @file 全局快捷键
 * @description 注册/注销全局快捷键
 * @platform ELECTRON
 * @module electron/main/services/shortcuts
 */

import { globalShortcut } from 'electron'
import { windowManager } from '../windows/manager'
import { logger } from '../utils/logger'

/** 注册全局快捷键 */
export function registerShortcuts(): void {
  try {
    // Ctrl+Shift+P: 切换桌宠显示
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (windowManager.petWin && !windowManager.petWin.isDestroyed()) {
        if (windowManager.petWin.isVisible()) {
          windowManager.petWin.hide()
        } else {
          windowManager.petWin.show()
        }
      } else {
        windowManager.createPetWindow()
      }
    })

    // Ctrl+Shift+D: 打开控制面板
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      windowManager.createDashboardWindow()
    })

    logger.info('Shortcuts', '全局快捷键已注册')
  } catch (e: unknown) {
    logger.warn('Shortcuts', `注册快捷键失败: ${e}`)
  }
}

/** 注销所有全局快捷键 */
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
