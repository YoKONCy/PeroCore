import { t as __t } from './i18n'
import { app, type BrowserWindow } from 'electron'
import { logger } from './logger'

type NativeHandle = number | bigint

interface WindowsIconApi {
  loadImage: (
    instance: NativeHandle,
    path: string,
    type: number,
    width: number,
    height: number,
    flags: number,
  ) => NativeHandle
  sendMessage: (
    window: NativeHandle,
    message: number,
    parameter: NativeHandle,
    value: NativeHandle,
  ) => NativeHandle
  destroyIcon: (icon: NativeHandle) => number
  getDpi: (window: NativeHandle) => number
  getMetric: (index: number, dpi: number) => number
  registerMessage: (name: string) => number
}

const WM_SETICON = 0x0080
const WM_GETICON = 0x007f
const IMAGE_ICON = 1
const LR_LOADFROMFILE = 0x0010
const windowRefreshers = new WeakMap<BrowserWindow, () => void>()
const iconHandles = new Map<string, NativeHandle>()
let windowsApi: WindowsIconApi | null | undefined

function getWindowsIconApi(): WindowsIconApi | null {
  if (windowsApi !== undefined) return windowsApi
  try {
    // 仅在 Windows 创建实际窗口时加载，复用项目现有的原生调用依赖。
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    windowsApi = {
      loadImage: user32.func(
        'uintptr_t __stdcall LoadImageW(uintptr_t instance, str16 path, uint type, int width, int height, uint flags)',
      ),
      sendMessage: user32.func(
        'intptr_t __stdcall SendMessageW(uintptr_t window, uint message, uintptr_t parameter, intptr_t value)',
      ),
      destroyIcon: user32.func('int __stdcall DestroyIcon(uintptr_t icon)'),
      getDpi: user32.func('uint __stdcall GetDpiForWindow(uintptr_t window)'),
      getMetric: user32.func('int __stdcall GetSystemMetricsForDpi(int index, uint dpi)'),
      registerMessage: user32.func('uint __stdcall RegisterWindowMessageW(str16 name)'),
    }
    app.once('will-quit', () => {
      // 自行加载的 HICON 归本模块所有；窗口销毁后再统一释放。
      for (const handle of iconHandles.values()) windowsApi?.destroyIcon(handle)
      iconHandles.clear()
    })
    return windowsApi
  } catch (error) {
    windowsApi = null
    logger.warn(
      'AppIdentity',
      __t('electron.logs.utils', 'Windows 原生窗口图标组件加载失败：{0}', [String(error)]),
    )
    return null
  }
}

function loadIcon(api: WindowsIconApi, path: string, width: number, height: number): NativeHandle {
  const key = `${path}:${width}x${height}`
  const cached = iconHandles.get(key)
  if (cached !== undefined) return cached
  const handle = api.loadImage(0, path, IMAGE_ICON, width, height, LR_LOADFROMFILE)
  if (!handle) throw new Error(`无法加载 ${width}×${height} 的 Windows 图标：${path}`)
  iconHandles.set(key, handle)
  return handle
}

/** 任务栏重启图标属性与 HWND 图标是两套设置，必须同时覆盖。 */
export function applyWindowsTaskbarIcon(window: BrowserWindow, iconPath: string): void {
  if (process.platform !== 'win32' || window.isDestroyed()) return
  const existingRefresh = windowRefreshers.get(window)
  if (existingRefresh) {
    existingRefresh()
    return
  }
  const api = getWindowsIconApi()
  if (!api) return
  let reportedFailure = false
  let reportedSuccess = false
  const refresh = () => {
    if (window.isDestroyed()) return
    try {
      const buffer = window.getNativeWindowHandle()
      const hwnd = buffer.length === 8 ? buffer.readBigUInt64LE() : buffer.readUInt32LE()
      if (!hwnd) throw new Error('窗口句柄为空')
      const dpi = api.getDpi(hwnd) || 96
      const big = loadIcon(api, iconPath, api.getMetric(11, dpi), api.getMetric(12, dpi))
      const small = loadIcon(api, iconPath, api.getMetric(49, dpi), api.getMetric(50, dpi))
      // WM_SETICON 返回的旧句柄可能属于 Electron，不能在这里释放。
      api.sendMessage(hwnd, WM_SETICON, 1, big)
      api.sendMessage(hwnd, WM_SETICON, 0, small)
      if (
        BigInt(api.sendMessage(hwnd, WM_GETICON, 1, 0)) !== BigInt(big) ||
        BigInt(api.sendMessage(hwnd, WM_GETICON, 0, 0)) !== BigInt(small)
      ) {
        throw new Error('窗口未保留已设置的大、小图标')
      }
      if (!reportedSuccess) {
        reportedSuccess = true
        logger.info(
          'AppIdentity',
          __t('electron.logs.utils', 'Windows 窗口大、小图标已设置并回读确认：窗口 {0}，{1}', [
            window.id,
            iconPath,
          ]),
        )
      }
    } catch (error) {
      if (reportedFailure) return
      reportedFailure = true
      logger.warn(
        'AppIdentity',
        __t('electron.logs.utils', 'Windows 窗口图标设置失败：{0}', [String(error)]),
      )
    }
  }

  // 重复设置身份时沿用同一组监听，避免每次显示窗口都累积回调。
  windowRefreshers.set(window, refresh)
  try {
    const taskbarCreated = api.registerMessage('TaskbarButtonCreated')
    if (taskbarCreated) window.hookWindowMessage(taskbarCreated, refresh)
    else
      logger.warn('AppIdentity', __t('electron.logs.utils', 'Windows 任务栏按钮重建消息注册失败'))
  } catch (error) {
    logger.warn(
      'AppIdentity',
      __t('electron.logs.utils', 'Windows 任务栏按钮重建监听失败：{0}', [String(error)]),
    )
  }
  window.on('show', refresh)
  window.on('restore', refresh)
  window.once('closed', () => {
    window.removeListener('show', refresh)
    window.removeListener('restore', refresh)
    // HWND 销毁时 Electron 自动释放消息钩子，不再访问已销毁的窗口。
    windowRefreshers.delete(window)
  })
  refresh()
}
