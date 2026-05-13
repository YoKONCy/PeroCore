/**
 * @file Electron 主进程入口
 * @description 遵循 07_DUAL_DEPLOYMENT.md — Electron 壳层仅做窗口/IPC/系统能力
 *              所有业务逻辑在 @perocore/backend 中，通过 HTTP :9120 通信
 *
 *              职责:
 *              1. 应用生命周期管理 (单实例锁, 退出清理)
 *              2. 注册 IPC 通道 (通过 ipcBridge.ts)
 *              3. 创建窗口 (通过 WindowManager)
 *              4. 启动系统服务 (托盘, 快捷键, 自动更新)
 *              5. 启动后端子进程
 *
 * @platform ELECTRON
 * @module electron/main
 */

import { app, BrowserWindow, dialog, protocol } from 'electron'
import { release } from 'node:os'
import { logger } from './utils/logger'
import { isDev } from './utils/env'
import { windowManager } from './windows/manager'
import { registerIpcHandlers } from './ipcBridge'
import { appEvents } from './events'
import { initSteam } from './services/steam'

// ─── 全局错误捕获 ─────────────────────────────────────
process.on('uncaughtException', (error) => {
  const msg = `未捕获的异常: ${error.message}\n${error.stack}`
  logger.error('Main', msg)
  try {
    dialog.showErrorBox('应用启动错误', msg)
  } catch {
    // 忽略
  }
})

process.on('unhandledRejection', (reason) => {
  logger.error('Main', `未处理的 Promise 拒绝: ${reason}`)
})

// ─── 协议注册 (必须在 app.ready 之前) ──────────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ─── 平台适配 ────────────────────────────────────────
// 禁用 Windows 7 的 GPU 加速
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// 透明窗口支持
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-features', 'Autofill,CalculateNativeWinOcclusion')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// @platform WINDOWS — 设置应用名称
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (process.platform === 'win32') {
  app.setName('萌动链接：PeroperoChat！')
  app.setAppUserModelId(app.getName())
}

// ─── 单实例锁 ─────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

// ─── Steam 初始化 (可选) ──────────────────────────────
try {
  const steamStatus = initSteam()
  if (steamStatus === 'restarting') {
    logger.info('Main', '通过 Steam 重启，当前进程退出...')
    app.quit()
  } else {
    logger.info('Main', `Steam 初始化: ${steamStatus}`)
  }
} catch (e: unknown) {
  logger.error('Main', `Steam 初始化异常 (已跳过): ${e}`)
}

// ─── IPC 注册 (在 app.ready 之前即可) ─────────────────
registerIpcHandlers()

// ─── App Ready ────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // 注册 asset:// 协议
    const { registerAssetProtocol } = await import('./services/assets')
    registerAssetProtocol()

    // 创建 Launcher 窗口
    windowManager.createLauncherWindow()

    // Electron 桌面端的启动器需要立即读取配置、角色与系统状态，因此后端必须随主进程启动
    const { startBackend } = await import('./services/backendProcess')
    if (isDev) {
      startBackend().catch((e) => {
        logger.info('Main', `开发模式后端自动启动跳过，可能已由外部脚本托管: ${e}`)
      })
    } else {
      await startBackend()
    }

    // 启动系统服务
    const { createTray } = await import('./services/tray')
    createTray()

    const { registerShortcuts } = await import('./services/shortcuts')
    registerShortcuts()

    const { setupUpdater } = await import('./services/updater')
    setupUpdater()

    logger.info('Main', '应用启动完成')
  } catch (e: unknown) {
    logger.error('Main', `App whenReady 失败: ${e}`)
  }
})

// ─── 服务崩溃联动 ─────────────────────────────────────
appEvents.on('backend-crashed', async () => {
  logger.error('Main', '后端崩溃')

  // 向所有渲染窗口推送系统错误通知
  const { BrowserWindow } = await import('electron')
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('system-error', {
        title: '后端服务异常',
        message: '后端进程意外退出，部分功能可能不可用。请检查日志或重启应用。',
        type: 'error',
      })
    }
  })
})

// ─── 应用生命周期 ─────────────────────────────────────
let isQuitting = false

app.on('window-all-closed', () => {
  // 保持托盘运行，不退出
  if (process.platform === 'darwin') return
})

app.on('before-quit', async (event) => {
  if (isQuitting) return

  event.preventDefault()
  isQuitting = true

  logger.info('Main', '正在执行退出清理...')
  try {
    // 1. 销毁所有窗口
    windowManager.destroyAll()

    // 2. 停止后端服务
    const { stopBackend } = await import('./services/backendProcess')
    await stopBackend()

    // 3. 停止 NapCat
    const { stopNapCat } = await import('./services/napcat')
    stopNapCat()

    // 4. 注销快捷键
    const { unregisterShortcuts } = await import('./services/shortcuts')
    unregisterShortcuts()

    // 5. 销毁托盘
    const { destroyTray } = await import('./services/tray')
    destroyTray()

    // 6. 关闭日志
    logger.close()
  } catch (e: unknown) {
    logger.error('Main', `退出清理失败: ${e}`)
  }

  app.quit()
})

app.on('second-instance', () => {
  logger.info('Main', '第二个实例启动请求，激活现有窗口')
  const win = windowManager.launcherWin ?? windowManager.dashboardWin ?? windowManager.petWin
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    if (!win.isVisible()) win.show()
  } else {
    windowManager.createLauncherWindow()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  const firstWin = allWindows[0]
  if (firstWin) {
    firstWin.focus()
  } else {
    windowManager.createLauncherWindow()
  }
})
