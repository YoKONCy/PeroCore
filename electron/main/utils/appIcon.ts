import { app, nativeImage, type NativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger'
import { isPackagedRuntime } from './runtimeMode'

const iconsBySize = new Map<number, NativeImage>()

/** 系统界面使用固定的 Pero 图标；不与应用内品牌标志混用。 */
function systemIconRoots(): string[] {
  const appRoot = app.getAppPath()
  return [
    ...(isPackagedRuntime ? [process.resourcesPath] : []),
    path.join(appRoot, 'public'),
    path.join(appRoot, 'renderer'),
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../../../public'),
    process.resourcesPath,
  ]
}

/** Windows 的任务栏重启图标必须引用原版 ICO 文件，不引用界面 SVG。 */
export function systemIcoPath(): string | undefined {
  for (const name of ['system-icons/pero.ico', 'icon.ico'])
    for (const root of new Set(systemIconRoots())) {
      const iconPath = path.join(root, name)
      if (fs.existsSync(iconPath)) return iconPath
    }
  return undefined
}

export function loadSystemIcon(size: number): NativeImage | undefined {
  const cached = iconsBySize.get(size)
  if (cached && !cached.isEmpty()) return cached
  for (const name of ['system-icons/pero.png', 'Logo.png', 'icon.png']) {
    for (const root of new Set(systemIconRoots())) {
      const iconPath = path.join(root, name)
      if (!fs.existsSync(iconPath)) continue
      try {
        const image = nativeImage.createFromPath(iconPath)
        if (image.isEmpty()) continue
        // 统一交给窗口和托盘使用同一套角色资源。
        const resized = image.resize({ width: size, height: size, quality: 'best' })
        if (resized.isEmpty()) continue
        iconsBySize.set(size, resized)
        return resized
      } catch (error) {
        logger.warn('AppIcon', `系统图标读取失败，继续查找其他路径：${iconPath}；${String(error)}`)
      }
    }
  }
  logger.warn('AppIcon', '未找到可用的原版系统图标')
  return undefined
}
