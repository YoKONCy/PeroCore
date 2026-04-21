/**
 * @file 自动更新
 * @description 使用 electron-updater 从 GitHub Releases 检查更新
 * @platform ELECTRON
 * @module electron/main/services/updater
 */

import { logger } from '../utils/logger'

/** 设置自动更新 */
export function setupUpdater(): void {
  try {
    // 延迟导入 electron-updater，避免开发环境报错
    const { autoUpdater } = require('electron-updater')

    autoUpdater.logger = {
      info: (msg: string) => logger.info('Updater', msg),
      warn: (msg: string) => logger.warn('Updater', msg),
      error: (msg: string) => logger.error('Updater', msg),
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info: { version: string }) => {
      logger.info('Updater', `发现新版本: ${info.version}`)
    })

    autoUpdater.on('update-not-available', () => {
      logger.info('Updater', '当前已是最新版本')
    })

    autoUpdater.on('error', (err: Error) => {
      logger.error('Updater', `检查更新失败: ${err.message}`)
    })

    // 启动时延迟检查更新
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // 静默忽略网络错误
      })
    }, 10000)

    logger.info('Updater', '自动更新已配置')
  } catch (e: unknown) {
    logger.warn('Updater', `自动更新初始化失败 (开发环境正常): ${e}`)
  }
}
