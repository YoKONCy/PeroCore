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

import {
  ipcMain,
  BrowserWindow,
  shell,
  screen,
  Notification,
  nativeTheme,
  app,
  dialog,
} from 'electron'
import AdmZip from 'adm-zip'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { windowManager } from './windows/manager'
import { toggleWindowMaximized } from './windows/windowState'
import { paths, isDev, isPackaged, isPortable } from './utils/env'
import { logger } from './utils/logger'

// ─── 延迟导入的服务 (避免循环引用) ─────────────────────
// 使用函数包装，在调用时才 import
// 第七阶段：backendProcess 已移除（Daemon 独立运行）
const getNapCatService = () => import('./services/napcat')
const getAssetService = () => import('./services/assets')
const getDesktopAwareness = () => import('./services/desktopAwareness')
const getSystemService = () => import('./services/system')
const getUpdaterService = () => import('./services/updater')
const execFileAsync = promisify(execFile)

const CLIENT_AGENT_FILE = path.join(paths.userData, 'client-default-agent.txt')

function readClientDefaultAgent(): string | null {
  try {
    const agentId = fs.readFileSync(CLIENT_AGENT_FILE, 'utf8').trim()
    return agentId || null
  } catch {
    return null
  }
}

function writeClientDefaultAgent(agentId: string): void {
  fs.mkdirSync(path.dirname(CLIENT_AGENT_FILE), { recursive: true })
  fs.writeFileSync(CLIENT_AGENT_FILE, agentId, 'utf8')
}

function broadcastClientAgent(agentId: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('client-agent-changed', { agentId })
  })
}

async function getDevelopmentInfo(): Promise<Record<string, unknown>> {
  if (!isDev) return { available: false }
  try {
    const [branch, commit, status] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: paths.app }),
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: paths.app }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: paths.app }),
    ])
    return {
      available: true,
      branch: branch.stdout.trim(),
      commit: commit.stdout.trim(),
      dirty: Boolean(status.stdout.trim()),
      projectPath: paths.app,
      updateCommand: 'git pull --rebase; pnpm install',
    }
  } catch (error) {
    return { available: false, error: String(error), projectPath: paths.app }
  }
}

/** 注册所有 IPC 通道 */
export function registerIpcHandlers(): void {
  logger.info('IPC', '正在注册 IPC 通道...')

  registerWindowHandlers()
  registerNavigationHandlers()
  registerBackendHandlers()
  registerSystemHandlers()
  registerSkillHandlers()
  registerExportHandlers()
  registerAssetHandlers()
  registerNapCatHandlers()
  registerSteamHandlers()
  registerDragHandlers()
  registerDesktopAwarenessHandlers()
  registerSystemMonitorHandlers()
  registerAudioOutputHandlers()

  logger.info('IPC', 'IPC 通道注册完成')
}

function registerAudioOutputHandlers(): void {
  ipcMain.on('audio-output:receipt', (_event, input: unknown) => {
    const payload = input as { playbackId?: unknown; state?: unknown }
    const playbackId = String(payload.playbackId ?? '')
    const state = payload.state === 'completed' ? 'completed' : 'cancelled'
    if (!playbackId) return
    void import('./services/capabilityProvider').then(({ capabilityProvider }) => {
      capabilityProvider.completePlayback(playbackId, state)
    })
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 窗口控制
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerWindowHandlers(): void {
  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.isMinimized()) return
    win.minimize()
  })

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    return toggleWindowMaximized(win)
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

  // 同步 app 深浅色到系统原生主题（影响原生标题栏/滚动条/右键菜单等）
  ipcMain.handle('set-native-theme', (_event, mode: unknown) => {
    if (mode === 'dark' || mode === 'light' || mode === 'system') {
      nativeTheme.themeSource = mode
    }
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

  ipcMain.handle('open-arca-window', (_event, input: unknown) => {
    const requestedUrl =
      typeof input === 'object' && input !== null
        ? String((input as { url?: unknown }).url ?? '')
        : String(input ?? '')
    const backendOrigin = `http://127.0.0.1:${Number(process.env.PERO_PORT ?? 9120)}`
    const url = new URL(requestedUrl, backendOrigin).toString()
    windowManager.createArcaWindow(url)
    return windowManager.getArcaWindowState()
  })

  ipcMain.handle('close-arca-window', () => {
    windowManager.closeArcaWindow()
    return windowManager.getArcaWindowState()
  })

  ipcMain.handle('get-arca-window-state', () => windowManager.getArcaWindowState())

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
    const { getPortableDaemonStatus } = await import('./services/portableDaemon')
    return getPortableDaemonStatus()
  })
}

function registerSkillHandlers(): void {
  ipcMain.handle('select-skill-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '选择 Skill 文件夹',
      buttonLabel: '选择此文件夹',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const selectedPath = result.filePaths[0]
    if (result.canceled || !selectedPath) return { canceled: true }
    if (!fs.existsSync(path.join(selectedPath, 'SKILL.md'))) {
      throw new Error('所选文件夹内没有 SKILL.md，不是有效的 Skill')
    }
    return {
      canceled: false,
      path: selectedPath,
      name: path.basename(selectedPath),
    }
  })
}

function registerExportHandlers(): void {
  ipcMain.handle('export-agent-package', async (event, input: unknown) => {
    const payload = input as {
      format?: unknown
      version?: unknown
      agentId?: unknown
      fileName?: unknown
      files?: unknown
    }
    if (payload?.format !== 'infos.agent-package' || payload.version !== 1) {
      throw new Error('角色包格式不受支持')
    }
    if (typeof payload.agentId !== 'string' || !/^[a-z0-9_-]+$/.test(payload.agentId)) {
      throw new Error('角色包ID无效')
    }
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      throw new Error('角色包没有可导出的资源')
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      title: '选择角色包导出目录',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    }
    const selected = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    const directory = selected.filePaths[0]
    if (selected.canceled || !directory) return { canceled: true }

    const requestedName = typeof payload.fileName === 'string' ? payload.fileName : ''
    const fileName = /^[a-z0-9_-]+\.infos-agent\.zip$/i.test(requestedName)
      ? requestedName
      : `${payload.agentId}.infos-agent.zip`
    const target = path.join(directory, fileName)
    const zip = new AdmZip()
    for (const value of payload.files) {
      if (!value || typeof value !== 'object') throw new Error('角色包资源无效')
      const file = value as { path?: unknown; contentBase64?: unknown }
      const relative = typeof file.path === 'string' ? file.path.replaceAll('\\', '/') : ''
      if (
        !relative ||
        relative.startsWith('/') ||
        relative.split('/').some((segment) => !segment || segment === '..') ||
        typeof file.contentBase64 !== 'string'
      ) {
        throw new Error(`角色包资源路径无效: ${relative}`)
      }
      zip.addFile(relative, Buffer.from(file.contentBase64, 'base64'))
    }
    zip.addFile(
      'package.json',
      Buffer.from(
        JSON.stringify(
          {
            format: 'infos.agent-package',
            version: 1,
            agentId: payload.agentId,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      ),
    )
    zip.writeZip(target)
    return { canceled: false, path: target, fileName }
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 系统能力
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerSystemHandlers(): void {
  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('get-capability-node-id', async () => {
    const { capabilityProvider } = await import('./services/capabilityProvider')
    return capabilityProvider.getNodeId()
  })

  ipcMain.handle('get-client-info', async () => {
    const stats = await getSystemService().then((service) => service.getSystemStats())
    const edition = isDev
      ? 'development'
      : isPortable
        ? 'portable'
        : process.env.INFOS_EDITION === 'steam'
          ? 'steam'
          : 'release'
    return {
      version: app.getVersion(),
      edition,
      isPackaged,
      platform: process.platform,
      architecture: process.arch,
      osVersion: os.release(),
      osName: os.type(),
      hostname: os.hostname(),
      cpuModel: os.cpus()[0]?.model ?? '未知',
      cpuCores: os.cpus().length,
      memoryUsed: stats.memoryUsed,
      memoryTotal: stats.memoryTotal,
      uptime: stats.uptime,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      dataPath: paths.data,
      logsPath: paths.logs,
      appPath: paths.app,
      windows: {
        launcher: Boolean(windowManager.launcherWin && !windowManager.launcherWin.isDestroyed()),
        dashboard: Boolean(windowManager.dashboardWin && !windowManager.dashboardWin.isDestroyed()),
        pet: Boolean(windowManager.petWin && !windowManager.petWin.isDestroyed()),
      },
      development: await getDevelopmentInfo(),
    }
  })

  ipcMain.handle('get-client-default-agent', () => readClientDefaultAgent())
  ipcMain.handle('set-client-default-agent', (_event, input: unknown) => {
    const agentId =
      typeof input === 'string'
        ? input
        : typeof input === 'object' && input !== null
          ? String((input as { agentId?: unknown }).agentId ?? '')
          : ''
    if (!agentId) throw new Error('缺少 Agent ID')
    writeClientDefaultAgent(agentId)
    broadcastClientAgent(agentId)
    return { agentId }
  })

  ipcMain.handle('get-update-state', async () => (await getUpdaterService()).getUpdateState())
  ipcMain.handle('get-client-update-releases', async () =>
    (await getUpdaterService()).getCachedReleases(),
  )
  ipcMain.handle('check-client-update', async () => (await getUpdaterService()).checkForUpdates())
  ipcMain.handle('download-client-update', async (_event, input: unknown) => {
    const tagName =
      typeof input === 'string'
        ? input
        : typeof input === 'object' && input !== null
          ? String((input as { tagName?: unknown }).tagName ?? '')
          : ''
    return (await getUpdaterService()).downloadUpdate(tagName || undefined)
  })
  ipcMain.handle('install-client-update', async () => (await getUpdaterService()).installUpdate())
  ipcMain.handle('get-latest-release', async () => (await getUpdaterService()).getLatestRelease())

  ipcMain.handle('open-external-url', async (_event, input: unknown) => {
    const url =
      typeof input === 'string'
        ? input
        : typeof input === 'object' && input !== null
          ? String((input as { url?: unknown }).url ?? '')
          : ''
    if (!/^https:\/\//.test(url)) throw new Error('仅允许打开 HTTPS 链接')
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('open-client-path', async (_event, key: unknown) => {
    const target = key === 'logs' ? paths.logs : key === 'app' ? paths.app : paths.data
    const errorMessage = await shell.openPath(target)
    if (errorMessage) throw new Error(errorMessage)
    return true
  })

  ipcMain.handle('open-root-folder', () => {
    return shell.openPath(process.cwd())
  })

  /** 在 Electron 所属桌面会话中打开由 Daemon 安全解析出的绝对目录。 */
  ipcMain.handle('open-local-path', async (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      throw new Error('缺少要打开的目录路径')
    }
    const errorMessage = await shell.openPath(targetPath)
    if (errorMessage) throw new Error(errorMessage)
    return true
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
// 3D模型资源
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function registerAssetHandlers(): void {
  ipcMain.handle('scan-3d-models', async () => {
    const { scan3DModels } = await getAssetService()
    return scan3DModels()
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

  ipcMain.handle('steam-workshop-get-installations', async () => {
    try {
      const { getWorkshopInstallations } = await import('./services/steam')
      return getWorkshopInstallations()
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
      const { cloudSyncService } = await import('./services/cloudSync')
      return cloudSyncService.uploadFullSnapshot()
    } catch {
      return { success: false, errors: ['Steam 不可用'] }
    }
  })

  ipcMain.handle('steam-cloud-download', async () => {
    try {
      const { cloudSyncService } = await import('./services/cloudSync')
      return cloudSyncService.downloadFullSnapshot()
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
