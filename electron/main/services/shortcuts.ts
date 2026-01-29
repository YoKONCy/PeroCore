import { globalShortcut } from 'electron'
import { windowManager } from '../windows/manager.js'

export function registerShortcuts() {
    // Toggle Pet Window Visibility: Alt+Shift+P (or Alt+P)
    // Common shortcut for desktop pets
    // 切换宠物窗口可见性: Alt+Shift+P (或 Alt+P)
    // 桌面宠物的常用快捷键
    globalShortcut.register('Alt+Shift+P', () => {
        const petWin = windowManager.petWin
        if (petWin && !petWin.isDestroyed()) {
            if (petWin.isVisible()) {
                petWin.hide()
            } else {
                petWin.show()
                petWin.focus()
            }
        } else {
            // If not created, create it
            // 如果未创建，则创建它
            windowManager.createPetWindow()
        }
    })

    // Toggle Launcher Visibility: Alt+Shift+L
    // 切换启动器可见性: Alt+Shift+L
    globalShortcut.register('Alt+Shift+L', () => {
        const launcherWin = windowManager.launcherWin
        if (launcherWin && !launcherWin.isDestroyed()) {
            if (launcherWin.isVisible()) {
                launcherWin.hide()
            } else {
                launcherWin.show()
                launcherWin.focus()
            }
        } else {
            windowManager.createLauncherWindow()
        }
    })
    
    // Quick Chat (Future): Alt+Shift+C
    // 快速聊天 (未来): Alt+Shift+C
}

export function unregisterShortcuts() {
    globalShortcut.unregisterAll()
}
