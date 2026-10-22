import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { onLocaleChange } from '../../../packages/shared/src/i18n'
import { getLocale, t } from '../utils/i18n'
import { paths } from '../utils/env'
import { APPLICATION_NAME, applyWindowIdentity } from '../utils/appIdentity'
import { loadSystemIcon } from '../utils/appIcon'
import { logger } from '../utils/logger'
import { isPackagedRuntime } from '../utils/runtimeMode'
import type {
  StartupFailureKind,
  StartupPhase,
  StartupSplashState,
} from '../../shared/startupSplash'

interface SplashActions {
  retry: () => void
  quit: () => void
}

/** 独立本地开屏，后端、Vue 路由和通用预加载脚本均不参与其显示。 */
export class StartupSplash {
  private win: BrowserWindow | null = null
  private phase: StartupPhase = 'opening'
  private failure: StartupFailureKind = 'shell'
  private revision = 0
  private painted = false
  private disposed = false
  private openPromise: Promise<void> | null = null
  private resolveOpen: (() => void) | undefined
  private rejectOpen: ((error: Error) => void) | undefined
  private openTimer: ReturnType<typeof setTimeout> | undefined
  private nativeFailureVisible = false
  private nativeDialogController: AbortController | undefined
  private readonly stopLocale: () => void

  constructor(private readonly actions: SplashActions) {
    ipcMain.handle('startup-splash:state', (event) => {
      if (!this.trusted(event)) throw new Error('untrusted-startup-splash')
      return this.snapshot()
    })
    ipcMain.on('startup-splash:painted', this.onPainted)
    ipcMain.on('startup-splash:render-failed', this.onRenderFailed)
    ipcMain.on('startup-splash:action', this.onAction)
    this.stopLocale = onLocaleChange(() => this.publish())
  }

  private trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return (
      !!this.win &&
      !this.win.isDestroyed() &&
      event.sender === this.win.webContents &&
      event.senderFrame === this.win.webContents.mainFrame
    )
  }

  private snapshot(): StartupSplashState {
    const scope = 'electron.ui.startupSplash'
    const messages = {
      backend: '后端尚未就绪。可以重试，或查看启动日志。',
      launcher: '启动器页面未能就绪。请重试或查看日志。',
      shell: '桌面启动未能完成。请重试或查看日志。',
    } as const
    return {
      revision: this.revision,
      phase: this.phase,
      language: getLocale(),
      labels: {
        loading: t(scope, '正在启动 infOS'),
        title: t(scope, '启动遇到问题'),
        message: t(scope, messages[this.failure]),
        retry: t(scope, '重试'),
        logs: t(scope, '查看日志'),
        quit: t(scope, '退出'),
        close: t(scope, '关闭'),
      },
    }
  }

  private publish(): void {
    this.revision++
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      try {
        this.win.webContents.send('startup-splash:changed', this.snapshot())
      } catch {
        this.painted = false
      }
    }
  }

  setPhase(phase: StartupPhase): void {
    this.phase = phase
    this.publish()
  }

  focus(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore()
      if (this.painted) this.win.show()
      this.win.focus()
    }
  }

  open(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('startup-splash-disposed'))
    if (this.painted && this.win && !this.win.isDestroyed()) {
      this.focus()
      return Promise.resolve()
    }
    if (this.openPromise) return this.openPromise
    this.win?.destroy()
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = Math.round(Math.min(1040, area.width * 0.84, (area.height * 0.84 * 1569) / 1080))
    const height = Math.round((width * 1080) / 1569)
    const win = new BrowserWindow({
      title: APPLICATION_NAME,
      icon: loadSystemIcon(256),
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/startupSplash.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    this.win = win
    applyWindowIdentity(win)
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.on('close', (event) => {
      if (!this.disposed) {
        event.preventDefault()
        this.actions.quit()
      }
    })
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.painted = false
      }
      this.rejectOpen?.(new Error('startup-splash-closed'))
    })
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve
      this.rejectOpen = reject
      this.openTimer = setTimeout(() => reject(new Error('startup-splash-paint-timeout')), 10_000)
      this.openTimer.unref()
    }).finally(() => {
      clearTimeout(this.openTimer)
      this.resolveOpen = undefined
      this.rejectOpen = undefined
      this.openPromise = null
    })
    win.webContents.on('render-process-gone', () => {
      this.painted = false
      if (this.rejectOpen) this.rejectOpen(new Error('startup-splash-renderer-gone'))
      else if (!this.disposed) this.showNativeFailure()
    })
    const entry = isPackagedRuntime
      ? path.join(process.resourcesPath, 'splash', 'index.html')
      : path.join(app.getAppPath(), 'electron/splash/index.html')
    void win
      .loadFile(entry)
      .catch((error: unknown) =>
        this.rejectOpen?.(error instanceof Error ? error : new Error(String(error))),
      )
    return this.openPromise
  }

  private readonly onPainted = (event: Electron.IpcMainEvent): void => {
    if (!this.trusted(event) || this.disposed) return
    this.painted = true
    this.win!.show()
    this.resolveOpen?.()
    this.publish()
  }

  private readonly onRenderFailed = (event: Electron.IpcMainEvent): void => {
    if (this.trusted(event)) this.rejectOpen?.(new Error('startup-splash-artwork-failed'))
  }

  private readonly onAction = (event: Electron.IpcMainEvent, action: unknown): void => {
    if (!this.trusted(event) || this.disposed) return
    if (action === 'quit') this.actions.quit()
    else if (action === 'retry' && this.phase === 'failed') this.actions.retry()
    else if (action === 'logs' && this.phase === 'failed') void this.openLogs()
  }

  fail(kind: StartupFailureKind, error: unknown): void {
    if (this.disposed) return
    this.failure = kind
    this.phase = 'failed'
    logger.error(
      'StartupSplash',
      t('electron.logs.startupSplash', '启动过渡失败（{0}）：{1}', [
        kind,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ]),
    )
    this.publish()
    if (!this.painted || !this.win || this.win.isDestroyed()) this.showNativeFailure()
  }

  /** 开屏自身损坏时也有原生重试与退出入口，不能留下看不见的常驻进程。 */
  private showNativeFailure(): void {
    if (this.nativeFailureVisible || this.disposed) return
    this.nativeFailureVisible = true
    const controller = new AbortController()
    this.nativeDialogController = controller
    const state = this.snapshot()
    void dialog
      .showMessageBox({
        type: 'error',
        title: APPLICATION_NAME,
        message: t('electron.ui.startupSplash', '开屏资源加载失败'),
        detail: t('electron.ui.startupSplash', '无法显示开屏资源。请重试或退出应用。'),
        buttons: [state.labels.retry, state.labels.quit],
        defaultId: 0,
        cancelId: 1,
        signal: controller.signal,
      })
      .then(({ response }) => {
        if (this.disposed || controller.signal.aborted) return
        if (response === 0) this.actions.retry()
        else this.actions.quit()
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          logger.error(
            'StartupSplash',
            t('electron.logs.startupSplash', '启动过渡失败（{0}）：{1}', ['dialog', String(error)]),
          )
          this.actions.quit()
        }
      })
      .finally(() => {
        this.nativeFailureVisible = false
        if (this.nativeDialogController === controller) this.nativeDialogController = undefined
      })
  }

  private async openLogs(): Promise<void> {
    try {
      const file = path.join(paths.logs, 'daemon-bootstrap.log')
      const target = fs.existsSync(file) ? file : paths.logs
      if (!fs.existsSync(target)) throw new Error('startup-log-unavailable')
      const error = await shell.openPath(target)
      if (error) throw new Error(error)
    } catch {
      if (!this.disposed)
        await dialog
          .showMessageBox({
            type: 'info',
            title: APPLICATION_NAME,
            message: t('electron.ui.startupSplash', '启动日志尚未生成，请稍后再试。'),
          })
          .catch(() => {
            /* 日志入口失败不再触发全局错误弹窗。 */
          })
    }
  }

  finish(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('startup-aborted'))
        return
      }
      if (
        !this.painted ||
        !this.win ||
        this.win.isDestroyed() ||
        this.win.webContents.isCrashed()
      ) {
        reject(new Error('startup-splash-lost'))
        return
      }
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('startup-aborted'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, 180)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.nativeDialogController?.abort()
    this.rejectOpen?.(new Error('startup-splash-disposed'))
    clearTimeout(this.openTimer)
    this.stopLocale()
    ipcMain.removeHandler('startup-splash:state')
    ipcMain.off('startup-splash:painted', this.onPainted)
    ipcMain.off('startup-splash:render-failed', this.onRenderFailed)
    ipcMain.off('startup-splash:action', this.onAction)
    this.win?.destroy()
    this.win = null
  }
}
