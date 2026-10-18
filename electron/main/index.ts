/**
 * @file Electron 主进程入口
 * @description 遵循 07_DUAL_DEPLOYMENT.md — Electron 壳层仅做窗口/IPC/系统能力
 *              所有业务逻辑在 @infos/backend 中，通过 HTTP :9120 通信
 *
 *              职责:
 *              1. 应用生命周期管理 (单实例锁, 退出清理)
 *              2. 注册 IPC 通道 (通过 ipcBridge.ts)
 *              3. 创建窗口 (通过 WindowManager)
 *              4. 启动系统服务 (托盘, 快捷键, 自动更新)
 *              5. 连接 Daemon CapabilityBridge 注册平台能力（第七阶段修复 E4：不再启动后端子进程）
 *
 * @platform ELECTRON
 * @module electron/main
 */

import { app, BrowserWindow, dialog, protocol } from 'electron'
import { release } from 'node:os'
import { logger } from './utils/logger'
import { windowManager } from './windows/manager'
import { desktopTabs } from './windows/desktopTabs'
import { registerIpcHandlers } from './ipcBridge'
import { initSteam } from './services/steam'
import { closePictoriaDesktopGuard } from './services/pictoriaLifetime'
import { closeArcaDesktopGuard } from './services/arcaLifetime'
import { APPLICATION_NAME, WINDOWS_APP_ID } from './utils/appIdentity'

/** 向所有存活渲染窗口广播可见的系统错误，日志仍保留作诊断。 */
function notifyRendererError(title: string, message: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('system-error', { title, message })
  })
}

// ─── 全局错误捕获 ─────────────────────────────────────
process.on('uncaughtException', (error) => {
  const msg = `未捕获的异常: ${error.message}\n${error.stack}`
  logger.error('Main', msg)
  notifyRendererError('桌面应用异常', error.message)
  try {
    dialog.showErrorBox('应用启动错误', msg)
  } catch {
    // 忽略
  }
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  logger.error('Main', `未处理的 Promise 拒绝: ${message}`)
  notifyRendererError('桌面服务异常', message)
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
  app.setName(APPLICATION_NAME)
  // 正式版与安装包使用同一标识，开发版独立归组，进程与窗口共用对应身份。
  app.setAppUserModelId(WINDOWS_APP_ID)
  logger.info(
    'AppIdentity',
    `Windows 任务栏身份：${WINDOWS_APP_ID}；程序路径：${app.getPath('exe')}`,
  )
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
    // 注册 asset:// 协议并预扫描资产。外部模型 URL 会持久化到 localStorage，
    // 因此必须在创建渲染窗口前恢复虚拟 URL → 物理目录映射。
    const { registerAssetProtocol, scan3DModels } = await import('./services/assets')
    registerAssetProtocol()
    await scan3DModels()

    // 创建 Launcher 窗口
    windowManager.createLauncherWindow()

    // 便携模式：用 exe 自带 Node 运行时拉起内置 Daemon（注入 PERO_DATA_DIR），
    // 确保数据目录 = exe 同级 data/；非便携模式不拉起进程，直接等待外部 Daemon。
    const { ensurePortableDaemon } = await import('./services/portableDaemon')
    await ensurePortableDaemon()

    // 第七阶段：Electron 不再 spawn 后端，改为连接 Daemon 并注册平台能力
    // Daemon 必须独立运行（pnpm dev:daemon 或系统服务），Electron 只作为能力节点
    const { capabilityProvider } = await import('./services/capabilityProvider')
    capabilityProvider.start().catch((e) => {
      const message = `CapabilityProvider 启动失败（Daemon 是否已运行？）: ${String(e)}`
      logger.error('Main', message)
      notifyRendererError('桌面能力连接失败', '无法连接 Daemon，截图、剪贴板等桌面工具暂不可用。')
    })

    // 启动系统服务
    const { createTray } = await import('./services/tray')
    createTray()

    const { registerShortcuts } = await import('./services/shortcuts')
    await registerShortcuts()

    const { setupUpdater } = await import('./services/updater')
    setupUpdater()

    logger.info('Main', '应用启动完成（Daemon 连接模式）')
  } catch (e: unknown) {
    logger.error('Main', `App whenReady 失败: ${e}`)
  }
})

// ─── 应用生命周期 ─────────────────────────────────────
let isQuitting = false
let isPreparingQuit = false

app.on('window-all-closed', () => {
  // 保持托盘运行，不退出
  if (process.platform === 'darwin') return
})

app.on('before-quit', async (event) => {
  if (isQuitting) return

  event.preventDefault()
  if (isPreparingQuit) return
  isPreparingQuit = true
  try {
    if (!(await desktopTabs.closeAll())) {
      isPreparingQuit = false
      return
    }
  } catch (error) {
    isPreparingQuit = false
    logger.warn('Main', `关闭应用标签失败，已取消退出：${String(error)}`)
    return
  }
  isQuitting = true

  logger.info('Main', '正在执行退出清理...')
  try {
    // 1. 销毁所有窗口
    windowManager.destroyAll()

    // 2.分别停止当前宿主托管的子应用；一个失败不阻塞另一个，外部实例保持独立。
    await Promise.all(
      ['arca', 'pictoria'].map(async (name) => {
        try {
          const token = process.env.INFOS_API_TOKEN ?? ''
          const response = await fetch(
            `http://127.0.0.1:${Number(process.env.PERO_PORT ?? 9120)}/api/applications/${name}/shutdown-managed`,
            {
              method: 'POST',
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              signal: AbortSignal.timeout(12000),
              redirect: 'error',
            },
          )
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
        } catch (error) {
          logger.warn('Main', `停止托管 ${name} 失败，继续退出清理：${String(error)}`)
        }
      }),
    )

    await closePictoriaDesktopGuard()
    await closeArcaDesktopGuard()

    // 3.停止能力提供者（断开与 Daemon 的连接，注销能力）
    const { capabilityProvider } = await import('./services/capabilityProvider')
    await capabilityProvider.stop()

    // 4.回收便携模式拉起的内置Daemon（标准版/Steam无此进程，幂等）
    const { stopPortableDaemon } = await import('./services/portableDaemon')
    stopPortableDaemon()

    // 5. 注销快捷键
    const { unregisterShortcuts } = await import('./services/shortcuts')
    unregisterShortcuts()

    // 6. 销毁托盘
    const { destroyTray } = await import('./services/tray')
    destroyTray()
  } catch (e: unknown) {
    logger.error('Main', `退出清理失败: ${e}`)
  } finally {
    // 其他退出步骤失败也必须等待 NapCat 进程树回收完成。
    await import('./services/napcat')
      .then(({ stopNapCat }) => stopNapCat())
      .catch((error) => logger.warn('Main', `停止 NapCat 失败：${String(error)}`))
    // 即使 Daemon 不可达，断开桌面存活连接也能触发 Pictoria 自行停止。
    await closePictoriaDesktopGuard().catch((error) =>
      logger.warn('Main', `关闭 Pictoria 存活连接失败：${String(error)}`),
    )
    await closeArcaDesktopGuard().catch((error) =>
      logger.warn('Main', `关闭 Arca 存活连接失败：${String(error)}`),
    )
    logger.close()
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
  // 提示音播放器不参与主界面唤起，避免聚焦不可见的辅助窗口。
  const firstWin =
    windowManager.dashboardWin ??
    windowManager.launcherWin ??
    allWindows.find((win) => win.isVisible())
  if (firstWin) {
    if (firstWin.isMinimized()) firstWin.restore()
    firstWin.show()
    firstWin.focus()
  } else {
    windowManager.createLauncherWindow()
  }
})
