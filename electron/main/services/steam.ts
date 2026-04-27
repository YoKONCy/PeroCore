/**
 * @file Steam 集成
 * @description 延迟加载 steamworks.js，始终尝试连接 Steam。
 *              连接失败时优雅降级，不阻塞应用启动。
 *              开发模式下跳过 Overlay 注入，避免幽灵窗口。
 *
 * @platform ELECTRON
 * @module electron/main/services/steam
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from '../utils/logger'

// ─── 延迟加载 steamworks.js ──────────────────────────
// 不在模块顶层 require()，防止缺 steam_api64.dll 时 segfault
let steamworks: any = null
let steamLoadAttempted = false

function getSteamworksModuleName(): string {
  return ['steamworks', 'js'].join('.')
}

function loadSteamworks(): any {
  if (steamLoadAttempted) return steamworks
  steamLoadAttempted = true

  try {
    // 安全检查: 先确认 steam_api64.dll 存在
    const exeDir = path.dirname(process.execPath)
    const dllPath = path.join(exeDir, 'steam_api64.dll')
    const hasDll = fs.existsSync(dllPath)

    if (!hasDll && app.isPackaged) {
      logger.info('Steam', 'steam_api64.dll 未找到，跳过 Steamworks 加载 (非 Steam 版本)')
      return null
    }

    steamworks = require(getSteamworksModuleName())
  } catch (e) {
    logger.warn('Steam', `无法加载 steamworks.js (可能缺少 steam_api64.dll): ${e}`)
    steamworks = null
  }
  return steamworks
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let steamApi: any = null
let isInitialized = false

/** Steam 是否可用 (初始化成功后为 true) */
export const IS_STEAM = () => isInitialized

/** 初始化 Steam — 始终尝试连接，失败则优雅降级 */
export function initSteam(): 'ok' | 'not-available' | 'restarting' | 'failed' {
  if (isInitialized) return 'ok'

  // 检查是否显式禁用
  if (process.env.PERO_DISABLE_STEAM || process.env.IS_DOCKER || process.env.DOCKER_ENV) {
    logger.info('Steam', 'Steam 已被环境变量禁用')
    return 'not-available'
  }

  const sw = loadSteamworks()
  if (!sw) return 'not-available'

  const appId = 4457100

  // 生产环境: 检查是否需要通过 Steam 重启
  if (app.isPackaged) {
    const exePath = app.getPath('exe').toLowerCase()
    const isSteamLibrary = exePath.includes('steamapps')
    const hasAppIdFile =
      fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'steam_appid.txt')) ||
      fs.existsSync(path.join(process.cwd(), 'steam_appid.txt'))

    if (isSteamLibrary || hasAppIdFile) {
      try {
        if (sw.restartAppIfNecessary(appId)) {
          logger.info('Steam', '应用未通过 Steam 启动，正在请求 Steam 重启...')
          return 'restarting'
        }
      } catch (e) {
        logger.warn('Steam', `restartAppIfNecessary 失败: ${e}`)
      }
    } else {
      logger.info('Steam', '检测为非 Steam 环境启动，跳过强制重启逻辑')
    }
  }

  try {
    // 开发模式跳过 Overlay 注入，避免幽灵窗口
    if (app.isPackaged) {
      sw.electronEnableSteamOverlay()
    } else {
      logger.info('Steam', '开发模式，跳过 Overlay 注入')
    }

    // 初始化 Steamworks
    steamApi = sw.init(appId)
    isInitialized = true

    logger.info('Steam', '════════════════════════════════════════════')
    logger.info('Steam', '初始化成功')
    logger.info('Steam', `当前用户: ${steamApi.localplayer.getName()}`)
    logger.info('Steam', `Steam ID: ${steamApi.localplayer.getSteamId().steamId64}`)
    logger.info('Steam', '════════════════════════════════════════════')

    return 'ok'
  } catch (e: unknown) {
    if (String(e).includes('already initialized')) {
      isInitialized = true
      return 'ok'
    }
    logger.warn('Steam', '════════════════════════════════════════════')
    logger.warn('Steam', `初始化失败: ${e}`)
    logger.warn('Steam', 'Steam 是否正在运行？或当前用户未拥有此 AppID')
    logger.warn('Steam', '════════════════════════════════════════════')
    return 'failed'
  }
}

/** 获取 Steam 用户信息 */
export function getSteamUser(): { name: string; steamId: string } | null {
  if (!steamApi) return null
  try {
    return {
      name: steamApi.localplayer.getName(),
      steamId: steamApi.localplayer.getSteamId().steamId64.toString(),
    }
  } catch {
    return null
  }
}

/** 获取已订阅的 Workshop 物品 */
export function getSubscribedItems(): number[] {
  if (!steamApi) return []
  try {
    return steamApi.workshop.getSubscribedItems() ?? []
  } catch {
    return []
  }
}

/** 云存档状态 */
export function getCloudStatus(): { enabled: boolean } {
  if (!steamApi) return { enabled: false }
  try {
    return { enabled: steamApi.cloud.isEnabledForApp() ?? false }
  } catch {
    return { enabled: false }
  }
}

/** 上传到云存档 */
export async function uploadToCloud(): Promise<{ success: boolean; errors: string[] }> {
  if (!steamApi) return { success: false, errors: ['Steam 不可用'] }
  const { cloudSyncService } = await import('./cloudSync')
  const result = await cloudSyncService.uploadToCloud()
  return { success: result.success, errors: result.errors }
}

/** 从云存档下载 */
export async function downloadFromCloud(): Promise<{ success: boolean; errors: string[] }> {
  if (!steamApi) return { success: false, errors: ['Steam 不可用'] }
  const { cloudSyncService } = await import('./cloudSync')
  const result = await cloudSyncService.downloadFromCloud()
  return { success: result.success, errors: result.errors }
}
