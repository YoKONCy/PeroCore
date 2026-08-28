/**
 * @file 窗口管理器
 * @description 管理 infOS 的 5 种窗口类型，提供创建/销毁/切换等操作
 *              遵循 07_DUAL_DEPLOYMENT.md 的 Electron 壳层规范
 *
 *              窗口类型:
 *              - Launcher    启动器 (900×600, 透明, 无边框, 亚克力)
 *              - Pet3D       桌宠   (600×600, 透明, 置顶, 鼠标追踪)
 *              - Dashboard   控制面板 (1280×800, 透明, 无边框)
 *              - Stronghold  据点   (1200×800, 透明, 无边框)
 *              - IDE         工作台 (1400×900, 透明, 无边框)
 *
 * @platform ELECTRON
 * @module electron/main/windows/manager
 */

import { BrowserWindow, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from '../utils/logger'
import { resolveWindowBackground } from './windowConfig'

// ─── 窗口配置表 ─────────────────────────────────────────
interface WindowConfig {
  route: string
  width: number
  height: number
  transparent: boolean
  alwaysOnTop: boolean
  skipTaskbar: boolean
  resizable: boolean
  hasShadow: boolean
}

const WINDOW_CONFIGS: Record<string, WindowConfig> = {
  launcher: {
    route: '/launcher',
    width: 1080,
    height: 720,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  pet: {
    route: '/pet-3d',
    width: 600,
    height: 600,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
  },
  dashboard: {
    // 综合面板已统一承载 Dashboard/Chat/Stronghold/Workspace 功能
    route: '/app',
    width: 1280,
    height: 800,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  stronghold: {
    // 保留独立窗口 IPC 兼容性，实际统一打开 MainView
    route: '/app',
    width: 1200,
    height: 800,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  chat: {
    // 保留独立窗口 IPC 兼容性，实际统一打开 MainView
    route: '/app',
    width: 1100,
    height: 760,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  ide: {
    // WorkView 已废弃，保留 IPC 兼容性并统一打开 MainView
    route: '/app',
    width: 1400,
    height: 900,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
}

export class WindowManager {
  private static instance: WindowManager

  // ─── 窗口引用 ──────────────────────────────────────
  public launcherWin: BrowserWindow | null = null
  public petWin: BrowserWindow | null = null
  public dashboardWin: BrowserWindow | null = null
  public strongholdWin: BrowserWindow | null = null
  public chatWin: BrowserWindow | null = null
  public ideWin: BrowserWindow | null = null
  public arcaWin: BrowserWindow | null = null

  /** 记录窗口当前是否应当可见，避免异步ready事件覆盖主动隐藏。 */
  private readonly visibilityIntent = new WeakMap<BrowserWindow, boolean>()

  /** Pet 窗口鼠标追踪定时器 */
  private mouseTrackInterval: ReturnType<typeof setInterval> | null = null

  private constructor() {}

  public static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager()
    }
    return WindowManager.instance
  }

  // ─── 工具方法 ──────────────────────────────────────

  private getPreloadPath(): string {
    // electron-vite 编译后: dist-electron/preload/index.js
    return path.join(__dirname, '../preload/index.js')
  }

  private getIconPath(): string {
    const iconName = 'Logo.png'
    const candidates = [
      path.join(process.cwd(), 'public', iconName),
      path.join(process.cwd(), 'resources', iconName),
      path.join(process.resourcesPath, iconName),
      path.join(__dirname, '../../public', iconName),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
    return ''
  }

  /**
   * 加载窗口内容
   * - 开发: Vite Dev Server URL
   * - 生产: loadFile()
   */
  private loadWindowContent(win: BrowserWindow, route: string): void {
    // electron-vite 注入 ELECTRON_RENDERER_URL；旧版兼容 VITE_DEV_SERVER_URL
    const devUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL
    if (devUrl) {
      const url = `${devUrl}#${route}`
      logger.info('WindowManager', `加载 Dev URL: ${url}`)
      win.loadURL(url)
    } else {
      const { app } = require('electron')
      const indexPath = path.join(app.getAppPath(), 'renderer', 'index.html')
      logger.info('WindowManager', `加载文件: ${indexPath}, hash: ${route}`)
      win.loadFile(indexPath, { hash: route })
    }
  }

  /** 监听窗口最大化状态变化，同步到渲染进程 */
  private setupWindowStateListeners(win: BrowserWindow): void {
    const sendState = () => {
      if (!win.isDestroyed()) {
        win.webContents.send('window-maximized-state-changed', win.isMaximized())
      }
    }
    win.on('maximize', sendState)
    win.on('unmaximize', sendState)
    win.on('restore', sendState)
    win.on('resize', sendState)
  }

  /** 尝试为 Windows 窗口启用亚克力效果 */
  private trySetAcrylic(win: BrowserWindow): void {
    if (process.platform === 'win32') {
      try {
        win.setBackgroundMaterial('acrylic')
      } catch {
        // 不支持亚克力的 Windows 版本，静默忽略
      }
    }
  }

  /** 处理外部链接: 在系统浏览器中打开 */
  private setupExternalLinks(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:')) {
        shell.openExternal(url)
      }
      return { action: 'deny' }
    })
  }

  // ─── 通用窗口创建 ──────────────────────────────────

  private createOrFocus(
    existing: BrowserWindow | null,
    configKey: string,
    extraOpts?: Partial<Electron.BrowserWindowConstructorOptions>,
  ): BrowserWindow {
    // 如果已存在且未销毁，聚焦并返回
    if (existing && !existing.isDestroyed()) {
      this.visibilityIntent.set(existing, true)
      // 始终显示并聚焦（调用者明确想要这个窗口）
      if (!existing.isVisible()) existing.show()
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return existing
    }

    const cfg = WINDOW_CONFIGS[configKey]
    if (!cfg) throw new Error(`未知窗口配置: ${configKey}`)

    // 分离 webPreferences 避免被 extraOpts 展开覆盖
    const { webPreferences: extraWebPrefs, ...restExtraOpts } = extraOpts ?? {}

    const win = new BrowserWindow({
      title: '萌动链接：PeroperoChat！',
      icon: this.getIconPath(),
      width: cfg.width,
      height: cfg.height,
      show: false,
      frame: false,
      center: true,
      transparent: cfg.transparent,
      hasShadow: cfg.hasShadow,
      alwaysOnTop: cfg.alwaysOnTop,
      skipTaskbar: cfg.skipTaskbar,
      resizable: cfg.resizable,
      backgroundColor: resolveWindowBackground(cfg),
      webPreferences: {
        preload: this.getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        ...extraWebPrefs,
      },
      ...restExtraOpts,
    })

    // 亚克力效果 (非 Pet 窗口)
    if (cfg.hasShadow) {
      this.trySetAcrylic(win)
    }

    this.setupWindowStateListeners(win)
    this.setupExternalLinks(win)

    this.visibilityIntent.set(win, true)

    let shownAfterLoad = false
    const showWhenReady = (source: string) => {
      if (shownAfterLoad || win.isDestroyed() || this.visibilityIntent.get(win) === false) return
      shownAfterLoad = true
      logger.info('WindowManager', `${configKey} 已就绪 (${source})`)
      win.show()
    }

    // 透明窗口不保证稳定触发 ready-to-show，DOM 完成也可作为可靠显示信号。
    win.once('ready-to-show', () => showWhenReady('ready-to-show'))
    win.webContents.once('did-finish-load', () => showWhenReady('did-finish-load'))

    // 只为真正未完成页面加载的窗口保留兜底，避免正常透明窗口产生误告警。
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible() && this.visibilityIntent.get(win) !== false) {
        if (win.webContents.isLoadingMainFrame()) {
          logger.warn('WindowManager', `${configKey} 页面加载超时，先显示窗口`)
        } else {
          logger.info('WindowManager', `${configKey} 首帧事件缺失，显示已加载窗口`)
        }
        showWhenReady('timeout-fallback')
      }
    }, 10_000)

    // 加载失败也显示窗口，避免静默失败
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      logger.error('WindowManager', `${configKey} 加载失败: ${desc} (${code}), URL: ${url}`)
      if (!win.isDestroyed() && !win.isVisible() && this.visibilityIntent.get(win) !== false) {
        win.show()
      }
    })

    this.loadWindowContent(win, cfg.route)
    return win
  }

  // ─── 具体窗口 ──────────────────────────────────────

  public createLauncherWindow(): BrowserWindow {
    this.launcherWin = this.createOrFocus(this.launcherWin, 'launcher')
    this.launcherWin.on('closed', () => {
      this.launcherWin = null
    })
    return this.launcherWin
  }

  public closeLauncherWindow(): void {
    if (this.launcherWin && !this.launcherWin.isDestroyed()) {
      this.launcherWin.close()
    }
  }

  public showLauncherWindow(): void {
    if (!this.launcherWin || this.launcherWin.isDestroyed()) {
      this.createLauncherWindow()
      return
    }
    this.visibilityIntent.set(this.launcherWin, true)
    this.launcherWin.show()
    this.launcherWin.focus()
  }

  public hideLauncherWindow(): void {
    if (this.launcherWin && !this.launcherWin.isDestroyed()) {
      this.visibilityIntent.set(this.launcherWin, false)
      this.launcherWin.hide()
      logger.info('WindowManager', '已隐藏 Launcher 窗口')
    }
  }

  public createPetWindow(): BrowserWindow {
    this.petWin = this.createOrFocus(this.petWin, 'pet', {
      webPreferences: { webSecurity: false },
    })

    // Pet 窗口特殊设置
    this.petWin.setAlwaysOnTop(true, 'screen-saver')
    this.petWin.setIgnoreMouseEvents(false)

    // 初始定位: 屏幕右下角
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    this.petWin.setPosition(width - 650, height - 650)

    // 启动鼠标追踪 (30fps)
    this.startMouseTracking()

    // 渲染进程崩溃时恢复 Launcher
    this.petWin.webContents.on('render-process-gone', (_e, details) => {
      logger.error('WindowManager', `Pet 渲染进程崩溃: ${details.reason} (${details.exitCode})`)
      if (this.launcherWin && !this.launcherWin.isDestroyed()) {
        this.showLauncherWindow()
      }
    })

    this.petWin.on('closed', () => {
      this.stopMouseTracking()
      this.petWin = null
      // 无可见窗口时恢复 Launcher
      const hasVisible = BrowserWindow.getAllWindows().some(
        (w) => !w.isDestroyed() && w.isVisible(),
      )
      if (!hasVisible && this.launcherWin && !this.launcherWin.isDestroyed()) {
        logger.info('WindowManager', 'Pet 关闭且无其他可见窗口，恢复 Launcher')
        this.showLauncherWindow()
      }
    })

    return this.petWin
  }

  /** 打开唯一的综合面板窗口；所有 App 功能入口都复用它。 */
  public createDashboardWindow(): BrowserWindow {
    // 兼容热更新前已打开的旧独立窗口：统一关闭，避免与综合面板并存。
    for (const legacyWindow of [this.strongholdWin, this.chatWin, this.ideWin]) {
      if (legacyWindow && !legacyWindow.isDestroyed()) legacyWindow.close()
    }
    this.strongholdWin = null
    this.chatWin = null
    this.ideWin = null
    this.dashboardWin = this.createOrFocus(this.dashboardWin, 'dashboard')
    this.dashboardWin.on('closed', () => {
      this.dashboardWin = null
    })
    return this.dashboardWin
  }

  /** 据点已迁入综合面板，禁止再创建第二个 App 窗口。 */
  public createStrongholdWindow(): BrowserWindow {
    return this.createDashboardWindow()
  }

  /** 聊天已迁入综合面板，禁止再创建第二个 App 窗口。 */
  public createChatWindow(): BrowserWindow {
    return this.createDashboardWindow()
  }

  public closeArcaWindow(): void {
    if (this.arcaWin && !this.arcaWin.isDestroyed()) this.arcaWin.close()
  }

  public getArcaWindowState(): { open: boolean; visible: boolean } {
    const open = Boolean(this.arcaWin && !this.arcaWin.isDestroyed())
    return { open, visible: Boolean(open && this.arcaWin?.isVisible()) }
  }

  public createArcaWindow(url: string): BrowserWindow {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/i.test(url)) {
      throw new Error('ARCA_UI_URL_FORBIDDEN: 仅允许加载本机Arca UI')
    }
    if (this.arcaWin && !this.arcaWin.isDestroyed()) {
      if (this.arcaWin.webContents.getURL() !== url) void this.arcaWin.loadURL(url)
      if (this.arcaWin.isMinimized()) this.arcaWin.restore()
      this.arcaWin.show()
      this.arcaWin.focus()
      return this.arcaWin
    }
    const win = new BrowserWindow({
      title: 'Arca · infOS',
      icon: this.getIconPath(),
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      show: false,
      frame: false,
      center: true,
      backgroundColor: '#f6f2ff',
      webPreferences: {
        preload: this.getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: true,
      },
    })
    this.arcaWin = win
    this.setupWindowStateListeners(win)
    win.loadURL(url)
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https:\/\//i.test(target)) void shell.openExternal(target)
      return { action: 'deny' }
    })
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      if (this.arcaWin === win) this.arcaWin = null
    })
    return win
  }

  /** 工作台已迁入综合面板，禁止再创建第二个 App 窗口。 */
  public createIDEWindow(): BrowserWindow {
    return this.createDashboardWindow()
  }

  // ─── Pet 鼠标追踪 ─────────────────────────────────

  private startMouseTracking(): void {
    if (this.mouseTrackInterval) return

    // 30fps 鼠标追踪，用于 Pet 视线跟随
    this.mouseTrackInterval = setInterval(() => {
      if (!this.petWin || this.petWin.isDestroyed()) {
        this.stopMouseTracking()
        return
      }
      try {
        const cursor = screen.getCursorScreenPoint()
        const bounds = this.petWin.getBounds()
        this.petWin.webContents.send('global-mouse-move', {
          x: cursor.x - bounds.x,
          y: cursor.y - bounds.y,
        })
      } catch {
        // 静默忽略追踪错误
      }
    }, 33)
  }

  private stopMouseTracking(): void {
    if (this.mouseTrackInterval) {
      clearInterval(this.mouseTrackInterval)
      this.mouseTrackInterval = null
    }
  }

  /** 销毁所有窗口 */
  public destroyAll(): void {
    this.stopMouseTracking()
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.destroy()
    })
    this.launcherWin = null
    this.petWin = null
    this.dashboardWin = null
    this.strongholdWin = null
    this.chatWin = null
    this.ideWin = null
    this.arcaWin = null
  }
}

/** 全局单例 */
export const windowManager = WindowManager.getInstance()
