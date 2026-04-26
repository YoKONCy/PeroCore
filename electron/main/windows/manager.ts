/**
 * @file 窗口管理器
 * @description 管理 PeroCore 的 5 种窗口类型，提供创建/销毁/切换等操作
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
    width: 900,
    height: 600,
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
    route: '/dashboard',
    width: 1280,
    height: 800,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  stronghold: {
    route: '/stronghold',
    width: 1200,
    height: 800,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
  },
  ide: {
    route: '/ide',
    width: 1400,
    height: 900,
    transparent: true,
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
  public ideWin: BrowserWindow | null = null

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
      const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
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
      backgroundColor: '#00000000',
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

    this.loadWindowContent(win, cfg.route)
    this.setupWindowStateListeners(win)
    this.setupExternalLinks(win)

    // ready-to-show 显示
    win.on('ready-to-show', () => {
      logger.info('WindowManager', `${configKey} ready-to-show`)
      win.show()
    })

    // 兜底: 超时强制显示
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        logger.warn('WindowManager', `${configKey} ready-to-show 超时，强制显示`)
        win.show()
      }
    }, 5000)

    // 加载失败也显示窗口，避免静默失败
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      logger.error('WindowManager', `${configKey} 加载失败: ${desc} (${code}), URL: ${url}`)
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    })

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

  public hideLauncherWindow(): void {
    if (this.launcherWin && !this.launcherWin.isDestroyed()) {
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
        this.launcherWin.show()
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
        this.launcherWin.show()
      }
    })

    return this.petWin
  }

  public createDashboardWindow(): BrowserWindow {
    this.dashboardWin = this.createOrFocus(this.dashboardWin, 'dashboard')
    this.dashboardWin.on('closed', () => {
      this.dashboardWin = null
    })
    return this.dashboardWin
  }

  public createStrongholdWindow(): BrowserWindow {
    this.strongholdWin = this.createOrFocus(this.strongholdWin, 'stronghold')
    this.strongholdWin.on('closed', () => {
      this.strongholdWin = null
    })
    return this.strongholdWin
  }

  public createIDEWindow(): BrowserWindow {
    this.ideWin = this.createOrFocus(this.ideWin, 'ide')
    this.ideWin.on('closed', () => {
      this.ideWin = null
    })
    return this.ideWin
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
    this.ideWin = null
  }
}

/** 全局单例 */
export const windowManager = WindowManager.getInstance()
