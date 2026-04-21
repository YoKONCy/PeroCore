/**
 * @file 运行环境与路径检测
 * @description— 路径永远不能硬编码
 *              支持三种模式: 开发环境 / 发行版(安装包+Steam) / 便携版
 * @platform ELECTRON
 * @module electron/main/utils/env
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

// ─── 便携模式检测 ──────────────────────────────────────────
// exe 同目录下存在 `.portable` 标记文件 → 便携模式
// 数据存储在 exe 同目录的 `data/` 中，不依赖 %APPDATA%
function detectPortableMode(exePath: string): boolean {
  try {
    const markerPath = path.join(path.dirname(exePath), '.portable')
    return fs.existsSync(markerPath)
  } catch {
    return false
  }
}

// ─── 环境标记 ────────────────────────────────────────────
export const isPackaged = app.isPackaged
export const isDev = !isPackaged
export const isPortable = isPackaged && detectPortableMode(app.getPath('exe'))

// ─── 用户数据根目录 ─────────────────────────────────────
function resolveUserData(): string {
  if (isPortable) {
    // 便携模式: exe 同级目录
    const dir = path.dirname(app.getPath('exe'))
    console.log(`[Env] 便携模式，数据目录: ${dir}`)
    return dir
  }

  if (isDev) {
    // 开发模式: 与后端共享 ~/.perocore 数据目录
    const devDir = path.join(app.getPath('home'), '.perocore')
    console.log(`[Env] 开发模式，数据目录: ${devDir}`)
    return devDir
  }

  // 标准发行模式 (Setup / Steam): %APPDATA%/萌动链接：PeroperoChat！/
  return app.getPath('userData')
}

const appUserData = resolveUserData()

// ─── 统一路径工厂 ───────────────────────────────────────
// 遵循
export const paths = {
  /** 用户数据根目录 */
  userData: appUserData,
  /** Electron 应用路径 */
  app: app.getAppPath(),
  /** 可执行文件路径 */
  exe: app.getPath('exe'),
  /** 资源目录 (生产环境: resources/) */
  resources: process.resourcesPath,
  /** 数据目录 */
  data: path.join(appUserData, 'data'),
  /** 日志目录 */
  logs: path.join(appUserData, 'data', 'logs'),
} as const

/**
 * 系统默认的用户数据目录 (%APPDATA%/...)
 * 无论当前模式如何，始终指向系统目录
 * 用于 Logger 的双写: 开发模式日志同时存在于项目目录 + 系统目录
 */
export const systemUserData = app.getPath('userData')
