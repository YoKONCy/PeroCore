/**
 * @file 3D 资产扫描与 asset:// 协议
 * @description 扫描本地和 Steam Workshop 的 3D 模型资产
 *              注册 asset:// 自定义协议用于安全加载本地文件
 *
 * @platform ELECTRON
 * @module electron/main/services/assets
 */

import path from 'node:path'
import fs from 'node:fs'
import { protocol, net } from 'electron'
import { logger } from '../utils/logger'
import { isDev, paths } from '../utils/env'

/** 资产信息 */
export interface AssetInfo {
  name: string
  path: string
  source: 'local' | 'workshop'
  workshopId?: string
  manifest?: Record<string, unknown>
}

/** 注册 asset:// 自定义协议 (必须在 app ready 后调用) */
export function registerAssetProtocol(): void {
  protocol.handle('asset', (request) => {
    // asset://path/to/file → 本地文件
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    return net.fetch(`file://${filePath}`)
  })
  logger.info('Assets', 'asset:// 协议已注册')
}

/** 扫描本地 3D 模型 */
export async function scan3DModels(): Promise<AssetInfo[]> {
  const results: AssetInfo[] = []

  // 扫描本地模型目录
  const localDir = isDev
    ? path.resolve(__dirname, '../../packages/frontend/public/models')
    : path.join(paths.resources, 'models')

  if (fs.existsSync(localDir)) {
    try {
      const entries = fs.readdirSync(localDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            path: path.join(localDir, entry.name),
            source: 'local',
          })
        }
      }
    } catch (e: unknown) {
      logger.error('Assets', `扫描本地模型失败: ${e}`)
    }
  }

  logger.info('Assets', `扫描到 ${results.length} 个 3D 模型`)
  return results
}

/** 获取模型加载路径 */
export function getModelLoadPath(model: AssetInfo): string {
  return model.path
}
