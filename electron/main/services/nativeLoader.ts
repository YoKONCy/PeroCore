/**
 * @file Native 渲染核心懒加载
 * @description 延迟加载 @perocore/render-core-runtime (.node 文件)
 *              关键安全改动: 不在模块顶层 require .node 文件，
 *              原生模块的 segfault 无法被 try/catch 捕获，
 *              会直接杀死主进程导致"静默失败"。
 *              改为在第一次实际调用时才加载，崩溃只影响单次 IPC 调用。
 *
 * @platform ELECTRON
 * @module electron/main/services/nativeLoader
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { logger } from '../utils/logger'
import { isDev } from '../utils/env'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let native: any = null
let loadAttempted = false

/** 懒加载 Native 渲染核心 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadNativeModule(): any {
  if (loadAttempted) return native
  loadAttempted = true

  try {
    if (isDev) {
      const runtimePath = path.resolve(process.cwd(), 'packages/native/render-core-runtime')
      native = require(runtimePath)
      logger.info('Native', 'Native 核心加载成功 (开发环境)')
    } else {
      // 生产环境: 搜索多个候选路径
      const nativePath = path.join(process.resourcesPath, 'native')
      const nativeFile = path.join(nativePath, 'pero-render-core.win32-x64-msvc.node')
      const fallbackPath = path.join(app.getAppPath(), '..', 'native')
      const fallbackFile = path.join(fallbackPath, 'pero-render-core.win32-x64-msvc.node')

      const candidates = [nativeFile, nativePath, fallbackFile, fallbackPath]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          native = require(candidate)
          logger.info('Native', `Native 核心加载成功: ${candidate}`)
          break
        }
      }

      if (!native) {
        logger.warn('Native', 'Native 核心在所有候选路径中均未找到，3D 渲染功能不可用')
      }
    }
  } catch (e: unknown) {
    logger.error('Native', `Native 核心加载失败: ${e}`)
    native = null
  }

  return native
}
