/**
 * @file 系统托盘
 * @description 创建系统托盘图标和右键菜单
 * @platform ELECTRON
 * @module electron/main/services/tray
 */

import { app, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { windowManager } from '../windows/manager'
import { logger } from '../utils/logger'

let tray: Tray | null = null

/** 创建系统托盘 */
export function createTray(): void {
  const iconName = 'Logo.png'
  const candidates = [
    path.join(process.cwd(), 'public', iconName),
    path.join(process.cwd(), 'resources', iconName),
    path.join(process.resourcesPath, iconName),
    path.join(__dirname, '../../public', iconName),
  ]

  let iconPath = ''
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      iconPath = p
      break
    }
  }

  if (!iconPath) {
    logger.warn('Tray', '未找到托盘图标，跳过托盘创建')
    return
  }

  try {
    const icon = nativeImage.createFromPath(iconPath)
    tray = new Tray(icon)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开启动器',
        click: () => windowManager.createLauncherWindow(),
      },
      {
        label: '召唤桌宠',
        click: () => windowManager.createPetWindow(),
      },
      {
        label: '控制面板',
        click: () => windowManager.createDashboardWindow(),
      },
      { type: 'separator' },
      {
        label: '彻底退出',
        click: () => app.quit(),
      },
    ])

    tray.setToolTip('萌动链接：PeroperoChat！')
    tray.setContextMenu(contextMenu)

    // 单击托盘图标打开 Launcher
    tray.on('click', () => windowManager.createLauncherWindow())

    logger.info('Tray', '系统托盘已创建')
  } catch (e: unknown) {
    logger.error('Tray', `创建托盘失败: ${e}`)
  }
}

/** 销毁系统托盘 */
export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
