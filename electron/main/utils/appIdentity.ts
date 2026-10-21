import { t as __t } from './i18n'
import { app, type BrowserWindow } from 'electron'
import { loadSystemIcon, systemIcoPath } from './appIcon'
import { logger } from './logger'
import { applyWindowsTaskbarIcon } from './windowsTaskbarIcon'
import { isPackagedRuntime } from './runtimeMode'

export const APPLICATION_NAME = '萌动链接：PeroperoChat！'
// 开发运行时不再复用已发布应用的归组身份，避免沿用旧窗口的任务栏图标。
export const WINDOWS_APP_ID = isPackagedRuntime
  ? 'com.infos.peroperochat'
  : 'com.infos.peroperochat.development'

/** Windows 参数引用，仅用于系统的任务栏重启命令。 */
function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

/** 窗口图标与 Windows 任务栏归组信息须分别设置。 */
export function applyWindowIdentity(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const icon = loadSystemIcon(256)
  if (icon) window.setIcon(icon)
  if (process.platform !== 'win32') return
  const executable = app.getPath('exe')
  const iconPath = systemIcoPath()
  const relaunchArgs = isPackagedRuntime ? [executable] : [executable, app.getAppPath()]
  try {
    window.setAppDetails({
      appId: WINDOWS_APP_ID,
      appIconPath: iconPath ?? executable,
      appIconIndex: 0,
      // Windows 要求重启命令和显示名称同时存在，否则会忽略这两项。
      relaunchCommand: relaunchArgs.map(quoteWindowsArgument).join(' '),
      relaunchDisplayName: APPLICATION_NAME,
    })
  } catch (error) {
    logger.warn(
      'AppIdentity',
      __t('electron.logs.utils', 'Windows 任务栏身份设置失败：{0}', [String(error)]),
    )
  }
  if (iconPath) applyWindowsTaskbarIcon(window, iconPath)
}
