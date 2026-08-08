/**
 * @file IPC 通道集中注册
 * @description 遵循 07_DUAL_DEPLOYMENT.md — IPC 仅用于 Electron 专属的系统能力
 *              所有业务 API 走 HTTP (localhost:9120)，这里只注册系统级 IPC
 *
 *              按职责分组注册，清晰可维护
 *
 *              通道命名规范: kebab-case (如 window-minimize, start-backend)
 *
 * @platform ELECTRON
 * @module electron/main/ipcBridge
 */

import { ipcMain, BrowserWindow, shell, screen, Notification } from 'electron'
import { windowManager } from './windows/manager'
import { logger } from './utils/logger'

// ─── 延迟导入的服务 (避免循环引用) ─────────────────────
// 使用函数包装，在调用时才 import
// 第七阶段：backendProcess 已移除（Daemon 独立运行）
const getNapCatService = () => import('./services/napcat')
const getNativeLoader = () => import('./services/nativeLoader')
const getAssetService = () => import('./services/assets')
const getDesktopAwareness = () => import('./services/desktopAwareness')
const getSystemService = () => import('./services/system')

/** 注册所有 IPC 通道 */
export function registerIpcHandlers(): void {
  logger.info('IPC', '正在注册 IPC 通道...')

  registerWindowHandlers()
  registerNavigationHandlers()
  registerBackendHandlers()
  registerSystemHandlers()
  registerNativeHandlers()
  registerNapCatHandlers()
  registerSteamHandlers()
  registerDragHandlers()
  registerDesktopAwarenessHandlers()
  registerSystemMonitorHandlers()

  logger.info('IPC', 'IPC 通道注册完成')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 窗口控制
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerWindowHandlers(): void {
  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // Windows + transparent + frameless 窗口的已知 bug:
    // 最大化状态下 minimize() 无效。
    // 解决: 先 unmaximize()，等 DWM 更新后再 minimize()。
    if (process.platform === 'win32' && win.isMaximized()) {
      win.unmaximize()
      setTimeout(() => {
        if (!win.isDestroyed()) win.minimize()
      }, 100)
    } else {
      win.minimize()
    }
  })

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
  })

  ipcMain.handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window-is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('window-show', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.show()
      win.focus()
    }
  })

  ipcMain.handle('window-focus', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus()
  })

  ipcMain.handle('resize-pet-window', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    try {
      win.setResizable(true)
      win.setMinimumSize(200, 200)
      const bounds = win.getBounds()
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: Math.round(width),
        height: Math.round(height),
      })
      win.setResizable(false)
      return true
    } catch (e: unknown) {
      logger.error('IPC', `resize-pet-window 失败: ${e}`)
      return false
    }
  })

  ipcMain.handle('set-ignore-mouse', (event, ignore: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.handle('set-fix-window-topmost', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(true, 'screen-saver')
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 窗口导航 (打开/关闭/隐藏)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerNavigationHandlers(): void {
  ipcMain.handle('open-pet-window', () => {
    windowManager.createPetWindow()
    return true
  })

  ipcMain.handle('hide-pet-window', () => {
    windowManager.petWin?.hide()
  })

  ipcMain.handle('open-dashboard-window', () => {
    windowManager.createDashboardWindow()
  })

  ipcMain.handle('close-dashboard', () => {
    windowManager.dashboardWin?.close()
  })

  ipcMain.handle('open-stronghold-window', () => {
    windowManager.createStrongholdWindow()
  })

  ipcMain.handle('open-chat-window', () => {
    windowManager.createChatWindow()
  })

  ipcMain.handle('open-ide-window', () => {
    windowManager.createIDEWindow()
  })

  ipcMain.handle('hide-launcher', () => {
    windowManager.hideLauncherWindow()
  })

  ipcMain.handle('close-launcher', () => {
    windowManager.closeLauncherWindow()
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 后端进程管理（第七阶段：已废弃，Daemon 独立运行）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Electron 不再 spawn 后端进程，这些 IPC 通道保留仅为兼容旧前端调用。
// 调用时返回提示信息，前端应迁移为通过 HTTP API 与 Daemon 交互。
function registerBackendHandlers(): void {
  ipcMain.handle('start-backend', async () => {
    logger.info('IPC', 'start-backend 已废弃：Daemon 独立运行，无需 Electron 启动')
    return null
  })

  ipcMain.handle('stop-backend', async () => {
    logger.info('IPC', 'stop-backend 已废弃：Daemon 生命周期由自身管理')
    return null
  })

  ipcMain.handle('get-backend-logs', async () => {
    logger.info('IPC', 'get-backend-logs 已废弃：请通过 Daemon HTTP API /api/maintenance 获取日志')
    return []
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 系统能力
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerSystemHandlers(): void {
  ipcMain.handle('get-app-version', () => {
    const { app } = require('electron')
    return app.getVersion()
  })

  ipcMain.handle('open-root-folder', () => {
    shell.openPath(process.cwd())
  })

  ipcMain.handle('quit-app', () => {
    const { app } = require('electron')
    app.quit()
  })

  // 跨窗口事件广播
  ipcMain.handle('emit-event', (_event, { event, payload }) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(event, payload)
      }
    })
  })

  // 系统通知
  ipcMain.on('show-notification', (_event, { title, body }) => {
    new Notification({ title, body }).show()
  })

  // 渲染进程日志转发
  ipcMain.on('log-from-renderer', (_event, message) => {
    logger.info('Renderer', String(message))
  })

  // 渲染进程错误日志
  ipcMain.handle('system-error-log', (_event, errMsg) => {
    logger.error('Renderer', String(errMsg))
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Native 渲染核心 (render-core)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerNativeHandlers(): void {
  ipcMain.handle(
    'native-load-pero-model',
    async (_event, buffer: Buffer, filterPatterns?: string[]) => {
      const { loadNativeModule } = await getNativeLoader()
      const native = loadNativeModule()
      if (!native) throw new Error('Native 渲染核心不可用')
      return native.loadPeroModel(buffer, filterPatterns)
    },
  )

  ipcMain.handle(
    'native-load-standard-model',
    async (_event, buffer: Buffer, filterPatterns?: string[]) => {
      const { loadNativeModule } = await getNativeLoader()
      const native = loadNativeModule()
      if (!native) throw new Error('Native 渲染核心不可用')
      return native.loadStandardModel(buffer, filterPatterns)
    },
  )

  ipcMain.handle('native-load-pero-container', async (_event, buffer: Buffer) => {
    const { loadNativeModule } = await getNativeLoader()
    const native = loadNativeModule()
    if (!native) throw new Error('Native 渲染核心不可用')
    return native.loadPeroContainer(buffer)
  })

  ipcMain.handle('scan-3d-models', async () => {
    const { scan3DModels } = await getAssetService()
    return scan3DModels()
  })

  ipcMain.handle('get-model-load-path', async (_event, model) => {
    const { getModelLoadPath } = await getAssetService()
    return getModelLoadPath(model)
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NapCat QQ 机器人
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerNapCatHandlers(): void {
  ipcMain.handle('start-napcat', async () => {
    const { startNapCat } = await getNapCatService()
    await startNapCat()
  })

  ipcMain.handle('stop-napcat', async () => {
    const { stopNapCat } = await getNapCatService()
    stopNapCat()
  })

  ipcMain.handle('get-napcat-logs', async () => {
    const { getNapCatLogs } = await getNapCatService()
    return getNapCatLogs()
  })

  ipcMain.handle('send-napcat-command', async (_event, args) => {
    const { sendNapCatCommand } = await getNapCatService()
    const cmd = typeof args === 'string' ? args : args?.command
    if (cmd) sendNapCatCommand(cmd)
  })

  ipcMain.handle('install-napcat', async () => {
    const { installNapCat } = await getNapCatService()
    return installNapCat()
  })

  ipcMain.handle('check-napcat', async () => {
    const { checkNapCat } = await getNapCatService()
    return checkNapCat()
  })

  ipcMain.handle('napcat-status', async () => {
    const { getNapCatStatus } = await getNapCatService()
    return getNapCatStatus()
  })

  ipcMain.handle('ensure-napcat-config', async () => {
    const { ensureNapCatConfig } = await getNapCatService()
    return ensureNapCatConfig()
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Steam 集成 (IS_STEAM 门控)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerSteamHandlers(): void {
  // Steam 通道在运行时检查 IS_STEAM 标记
  // 非 Steam 版调用这些通道会安全返回 null

  ipcMain.handle('steam-get-user', async () => {
    try {
      const { getSteamUser } = await import('./services/steam')
      return getSteamUser()
    } catch {
      return null
    }
  })

  ipcMain.handle('steam-workshop-get-subscribed', async () => {
    try {
      const { getSubscribedItems } = await import('./services/steam')
      return getSubscribedItems()
    } catch {
      return []
    }
  })

  // 云存档系列
  ipcMain.handle('steam-cloud-get-status', async () => {
    try {
      const { getCloudStatus } = await import('./services/steam')
      return getCloudStatus()
    } catch {
      return { enabled: false }
    }
  })

  ipcMain.handle('steam-cloud-upload', async () => {
    try {
      const { uploadToCloud } = await import('./services/steam')
      return uploadToCloud()
    } catch {
      return { success: false, errors: ['Steam 不可用'] }
    }
  })

  ipcMain.handle('steam-cloud-download', async () => {
    try {
      const { downloadFromCloud } = await import('./services/steam')
      return downloadFromCloud()
    } catch {
      return { success: false, errors: ['Steam 不可用'] }
    }
  })

  ipcMain.handle('steam-cloud-sync', async () => {
    try {
      const { cloudSyncService } = await import('./services/cloudSync')
      return cloudSyncService.sync()
    } catch {
      return { success: false, uploaded: [], downloaded: [], failed: [], errors: ['Steam 不可用'] }
    }
  })

  ipcMain.handle('steam-cloud-clear', async () => {
    try {
      const { cloudSyncService } = await import('./services/cloudSync')
      return cloudSyncService.clearCloudData()
    } catch {
      return false
    }
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 窗口拖拽 (Pet 窗口高刷拖拽)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerDragHandlers(): void {
  let dragInterval: ReturnType<typeof setInterval> | null = null

  ipcMain.on('window-drag-start', (event, { offsetX, offsetY }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    if (dragInterval) clearInterval(dragInterval)

    const { width, height } = win.getBounds()

    // 1ms 轮询鼠标位置直接移动窗口 → 最大平滑度
    dragInterval = setInterval(() => {
      try {
        if (win.isDestroyed()) {
          if (dragInterval) clearInterval(dragInterval)
          return
        }
        const cursor = screen.getCursorScreenPoint()
        win.setBounds({
          x: cursor.x - Math.round(offsetX),
          y: cursor.y - Math.round(offsetY),
          width,
          height,
        })
      } catch {
        if (dragInterval) clearInterval(dragInterval)
      }
    }, 1)
  })

  ipcMain.on('window-drag-end', () => {
    if (dragInterval) {
      clearInterval(dragInterval)
      dragInterval = null
    }
  })

  // 兼容: 单次移动
  ipcMain.handle('window-move', (event, { x, y }) => {
    BrowserWindow.fromWebContents(event.sender)?.setPosition(Math.round(x), Math.round(y))
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 桌面感知 (截屏/剪贴板/前台窗口)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerDesktopAwarenessHandlers(): void {
  ipcMain.handle('capture-screen', async (_event, maxWidth?: number) => {
    const { captureScreen } = await getDesktopAwareness()
    return captureScreen(maxWidth)
  })

  ipcMain.handle('read-clipboard', async () => {
    const { readClipboard } = await getDesktopAwareness()
    return readClipboard()
  })

  ipcMain.handle('write-clipboard', async (_event, text: string) => {
    const { writeClipboard } = await getDesktopAwareness()
    writeClipboard(text)
  })

  ipcMain.handle('read-clipboard-image', async () => {
    const { readClipboardImage } = await getDesktopAwareness()
    return readClipboardImage()
  })

  ipcMain.handle('write-clipboard-image', async (_event, dataUrl: string) => {
    const { writeClipboardImage } = await getDesktopAwareness()
    writeClipboardImage(dataUrl)
  })

  ipcMain.handle('get-active-window', async () => {
    const { getActiveWindow } = await getDesktopAwareness()
    return getActiveWindow()
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 系统监控
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerSystemMonitorHandlers(): void {
  ipcMain.handle('get-system-stats', async () => {
    const { getSystemStats } = await getSystemService()
    return getSystemStats()
  })

  ipcMain.handle('start-system-monitor', async () => {
    const { startSystemMonitor } = await getSystemService()
    startSystemMonitor()
  })
}
