/**
 * Electron 客户端更新服务。
 *
 * 统一维护更新状态，并向 Launcher 暴露检查、下载、安装和 GitHub Release 公告。
 */
import { app, BrowserWindow } from 'electron'
import { logger } from '../utils/logger'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  progress: number
  message: string
  checkedAt?: string
}

export interface ReleaseNotice {
  tagName: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  prerelease: boolean
  cached: boolean
}

let updater: any = null
let initialized = false
let state: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  progress: 0,
  message: '尚未检查更新',
}

function broadcast(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('client-update-state', { ...state })
  })
}

function updateState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

function initUpdater(): any {
  if (initialized) return updater
  initialized = true
  if (!app.isPackaged || process.env.INFOS_EDITION === 'steam') {
    updateState({
      phase: 'idle',
      message: app.isPackaged ? 'Steam 版本由 Steam 管理更新' : '开发版本不使用安装包自动更新',
    })
    return null
  }

  try {
    updater = require('electron-updater').autoUpdater
    updater.logger = {
      info: (message: string) => logger.info('Updater', message),
      warn: (message: string) => logger.warn('Updater', message),
      error: (message: string) => logger.error('Updater', message),
    }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => {
      updateState({ phase: 'checking', progress: 0, message: '正在检查 GitHub Release…' })
    })
    updater.on('update-available', (info: { version: string }) => {
      updateState({
        phase: 'available',
        latestVersion: info.version,
        message: `发现新版本 ${info.version}`,
        checkedAt: new Date().toISOString(),
      })
    })
    updater.on('update-not-available', (info: { version?: string }) => {
      updateState({
        phase: 'up-to-date',
        latestVersion: info.version ?? app.getVersion(),
        progress: 100,
        message: '当前已是最新版本',
        checkedAt: new Date().toISOString(),
      })
    })
    updater.on('download-progress', (progress: { percent: number }) => {
      updateState({
        phase: 'downloading',
        progress: Math.round(progress.percent),
        message: `正在下载更新 ${Math.round(progress.percent)}%`,
      })
    })
    updater.on('update-downloaded', (info: { version: string }) => {
      updateState({
        phase: 'downloaded',
        latestVersion: info.version,
        progress: 100,
        message: '更新已下载，可安装并重启',
      })
    })
    updater.on('error', (error: Error) => {
      updateState({ phase: 'error', message: `更新失败：${error.message}` })
    })
    logger.info('Updater', '客户端更新服务已初始化')
  } catch (error) {
    updateState({ phase: 'error', message: `更新组件不可用：${String(error)}` })
    logger.warn('Updater', `更新组件初始化失败: ${String(error)}`)
  }
  return updater
}

export function setupUpdater(): void {
  const instance = initUpdater()
  if (!instance) return
  setTimeout(() => {
    void checkForUpdates().catch(() => undefined)
  }, 10_000)
}

export function getUpdateState(): UpdateState {
  initUpdater()
  return { ...state }
}

export async function checkForUpdates(): Promise<UpdateState> {
  const instance = initUpdater()
  if (!instance) return getUpdateState()
  await instance.checkForUpdates()
  return getUpdateState()
}

export async function downloadUpdate(): Promise<UpdateState> {
  const instance = initUpdater()
  if (!instance) return getUpdateState()
  await instance.downloadUpdate()
  return getUpdateState()
}

export function installUpdate(): boolean {
  const instance = initUpdater()
  if (!instance || state.phase !== 'downloaded') return false
  setImmediate(() => instance.quitAndInstall(false, true))
  return true
}

export async function getLatestRelease(): Promise<ReleaseNotice> {
  const cacheKey = 'launcher-release-cache.json'
  const { paths } = await import('../utils/env')
  const { readFile, writeFile, mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const cachePath = join(paths.cache, cacheKey)

  try {
    const response = await fetch('https://api.github.com/repos/YoKONCy/infOS/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'infOS-Launcher' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
    const release = (await response.json()) as Record<string, unknown>
    const notice: ReleaseNotice = {
      tagName: String(release.tag_name ?? ''),
      name: String(release.name ?? release.tag_name ?? '最新版本'),
      body: String(release.body ?? ''),
      publishedAt: String(release.published_at ?? ''),
      htmlUrl: String(release.html_url ?? 'https://github.com/YoKONCy/infOS/releases'),
      prerelease: Boolean(release.prerelease),
      cached: false,
    }
    await mkdir(paths.cache, { recursive: true })
    await writeFile(cachePath, JSON.stringify(notice), 'utf8')
    return notice
  } catch (error) {
    logger.warn('Updater', `获取 GitHub Release 失败，尝试读取缓存: ${String(error)}`)
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as ReleaseNotice
      return { ...cached, cached: true }
    } catch {
      throw error
    }
  }
}
